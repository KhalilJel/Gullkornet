"""Authenticated, ingest-only HTTP bridge for the OpenOutSend JSONL pipe.

This process exposes no send endpoint. Every accepted request is passed to the
existing `outsend` stdin interface, which stores/upserts leads and exits.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

MAX_BODY_BYTES = 2_000_000
MAX_RECORDS = 100
INGEST_PATH = "/v1/leads"
REPLY_STATUS_PATH = "/v1/reply-status"
RETENTION_STATUS_PATH = "/v1/retention-status"
TOKEN_ENV = "OPENOUTREACH_INGEST_TOKEN"
# Read-only credential for POST /v1/reply-status. It can never authorize ingest, so GitHub Actions
# can hold it without holding the ingest token.
REPLY_STATUS_TOKEN_ENV = "OPENOUTREACH_REPLY_STATUS_TOKEN"
MIN_REPLY_STATUS_TOKEN_LENGTH = 32
REPLY_MONITOR_ENABLED_ENV = "OPENOUTREACH_REPLY_MONITOR_ENABLED"
REPLY_MONITOR_MAILBOX_ENV = "GULLKORNET_REPLY_MONITOR_MAILBOX"
REPLY_MONITOR_INTERVAL_ENV = "OPENOUTREACH_REPLY_MONITOR_INTERVAL_SECONDS"
DEFAULT_REPLY_MONITOR_INTERVAL = 300
_REPLY_MONITOR_LOCK = threading.Lock()
_REPLY_MONITOR_STOP = threading.Event()
_REPLY_MONITOR_STATE: dict[str, Any] = {
    "status": "disabled",
    "last_check_at": None,
    "last_success_at": None,
    "last_counts": None,
    "last_error_code": None,
}
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def parse_jsonl(body: bytes) -> tuple[list[dict[str, Any]], str]:
    if not body or len(body) > MAX_BODY_BYTES:
        raise ValueError("INVALID_BODY_SIZE")
    try:
        decoded = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("INVALID_UTF8") from exc

    records: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for line in decoded.splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError("INVALID_JSONL") from exc
        if not isinstance(record, dict):
            raise ValueError("INVALID_RECORD")
        lead_id = record.get("lead_id")
        email = record.get("email")
        if not isinstance(lead_id, str) or not lead_id.strip():
            raise ValueError("LEAD_ID_REQUIRED")
        if not isinstance(email, str) or not EMAIL_PATTERN.fullmatch(email.strip()):
            raise ValueError("VALID_EMAIL_REQUIRED")
        lead_id = lead_id.strip()
        if lead_id in seen_ids:
            raise ValueError("DUPLICATE_LEAD_ID_IN_BATCH")
        seen_ids.add(lead_id)
        records.append(record)
        if len(records) > MAX_RECORDS:
            raise ValueError("TOO_MANY_RECORDS")

    if not records:
        raise ValueError("EMPTY_BATCH")
    canonical = "".join(json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n" for record in records)
    return records, canonical


def authorized(header: str | None, token: str | None) -> bool:
    if not token or not token.strip() or not header:
        return False
    prefix = "Bearer "
    if not header.startswith(prefix):
        return False
    supplied = header[len(prefix):].strip()
    return bool(supplied) and hmac.compare_digest(supplied, token.strip())



def reply_status_authorized(header: str | None) -> bool:
    """Reply-status accepts the read-only token, and still the ingest token for existing callers."""
    return (authorized(header, os.environ.get(TOKEN_ENV))
            or authorized(header, os.environ.get(REPLY_STATUS_TOKEN_ENV)))


def validate_reply_status_token() -> None:
    """Refuse to start with a reply-status token that is weak or equal to the ingest token."""
    reply_token = os.environ.get(REPLY_STATUS_TOKEN_ENV, "").strip()
    if not reply_token:
        return
    if len(reply_token) < MIN_REPLY_STATUS_TOKEN_LENGTH:
        raise SystemExit(f"{REPLY_STATUS_TOKEN_ENV} must be at least {MIN_REPLY_STATUS_TOKEN_LENGTH} characters")
    if hmac.compare_digest(reply_token, os.environ.get(TOKEN_ENV, "").strip()):
        raise SystemExit(f"{REPLY_STATUS_TOKEN_ENV} must differ from {TOKEN_ENV}")


def reply_monitor_state() -> dict[str, Any]:
    """Return a safe snapshot; never expose mailbox addresses or credentials."""
    with _REPLY_MONITOR_LOCK:
        return dict(_REPLY_MONITOR_STATE)


def _update_reply_monitor_state(**values: Any) -> None:
    with _REPLY_MONITOR_LOCK:
        _REPLY_MONITOR_STATE.update(values)



# Shared mailbox providers; an address there does not identify a business.
# Keep in sync with FREEMAIL_DOMAINS in src/domain/email-domain.ts.
FREEMAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "hotmail.com", "hotmail.no", "outlook.com", "outlook.no",
    "live.com", "live.no", "msn.com", "yahoo.com", "yahoo.no", "icloud.com", "me.com",
    "mac.com", "aol.com", "protonmail.com", "proton.me", "online.no", "getmail.no",
    "broadpark.no", "frisurf.no", "start.no", "c2i.net", "altibox.no", "lyse.net",
})
CIDEA_DOMAINS = frozenset({"cideamarketing.com"})


def business_reply_domain(sender_email: str, own_address: str) -> str | None:
    """Domain whose mail also counts as a reply from this business, if any.

    A colleague answering from another address at the same company must block
    outreach too. Freemail domains and CIDEA's own domain are never widened.
    """
    domain = sender_email.strip().lower().rsplit("@", 1)[-1].rstrip(".")
    own_domain = own_address.strip().lower().rsplit("@", 1)[-1]
    if (not domain or "." not in domain or domain in FREEMAIL_DOMAINS
            or domain in CIDEA_DOMAINS or domain == own_domain):
        return None
    return domain


def search_folders_for_sender(client: Any, sender_email: str, domain: str | None = None) -> bool:
    """Search every selectable IMAP folder read-only; any search error fails closed."""
    folders = client.list_folders()
    if not folders:
        raise RuntimeError("REPLY_MAILBOX_HAS_NO_FOLDERS")
    checked = 0
    for flags, _delimiter, name in folders:
        flag_values = {
            flag.decode("utf-8", errors="ignore").lower() if isinstance(flag, bytes)
            else str(flag).lower()
            for flag in (flags or [])
        }
        if "\\noselect" in flag_values:
            continue
        if not name:
            continue
        client.select_folder(name, readonly=True)
        checked += 1
        if client.search(["FROM", sender_email]):
            return True
        if domain and client.search(["FROM", "@" + domain]):
            return True
    if checked == 0:
        raise RuntimeError("REPLY_MAILBOX_HAS_NO_SELECTABLE_FOLDERS")
    return False


def recipient_has_replied(sender_email: str, expected_address: str) -> bool:
    """Search all selectable folders for any message from a recipient or their business, read-only."""
    if not EMAIL_PATTERN.fullmatch(sender_email.strip()):
        raise ValueError("VALID_EMAIL_REQUIRED")
    import django

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cold_outreach.settings")
    django.setup()
    from cold_outreach.emails.models import Mailbox
    from cold_outreach.emails.sync import _connect

    mailbox = Mailbox.objects.filter(from_address__iexact=expected_address).first()
    if mailbox is None:
        raise RuntimeError("REPLY_MONITOR_MAILBOX_NOT_CONFIGURED")
    with _connect(mailbox) as client:
        return search_folders_for_sender(
            client, sender_email.strip(), business_reply_domain(sender_email, expected_address)
        )


def reply_monitor_healthy(state: dict[str, Any], now: datetime | None = None) -> bool:
    """Require a recent successful monitor pass; stale health must never authorize sending."""
    if state.get("status") != "running" or not state.get("last_success_at") or state.get("last_error_code"):
        return False
    try:
        last_success = datetime.fromisoformat(str(state["last_success_at"]))
        if last_success.tzinfo is None:
            return False
        interval = int(os.environ.get(REPLY_MONITOR_INTERVAL_ENV, str(DEFAULT_REPLY_MONITOR_INTERVAL)))
        if interval < 60 or interval > 3600:
            interval = DEFAULT_REPLY_MONITOR_INTERVAL
    except (TypeError, ValueError, OverflowError):
        return False
    current = now or datetime.now(timezone.utc)
    age_seconds = (current - last_success.astimezone(timezone.utc)).total_seconds()
    return -30 <= age_seconds <= interval * 3


REPLY_STATUS_BATCH_MAX = 500


def _address_text(address: Any) -> str | None:
    mailbox = getattr(address, "mailbox", None)
    host = getattr(address, "host", None)
    if not mailbox or not host:
        return None
    if isinstance(mailbox, bytes):
        mailbox = mailbox.decode("utf-8", errors="ignore")
    if isinstance(host, bytes):
        host = host.decode("utf-8", errors="ignore")
    return f"{mailbox}@{host}".strip().lower().rstrip(".")


def collect_mailbox_senders(client: Any) -> tuple[set[str], set[str]]:
    """Every From/Sender address (and its domain) in every selectable folder, read-only.

    One pass per folder instead of one IMAP search per recipient, so many recipients can be
    checked with one connection. Any folder or fetch error raises (fails closed).
    """
    folders = client.list_folders()
    if not folders:
        raise RuntimeError("REPLY_MAILBOX_HAS_NO_FOLDERS")
    addresses: set[str] = set()
    domains: set[str] = set()
    checked = 0
    for flags, _delimiter, name in folders:
        flag_values = {
            flag.decode("utf-8", errors="ignore").lower() if isinstance(flag, bytes)
            else str(flag).lower()
            for flag in (flags or [])
        }
        if "\\noselect" in flag_values or not name:
            continue
        client.select_folder(name, readonly=True)
        checked += 1
        ids = list(client.search(["ALL"]))
        for start in range(0, len(ids), 500):
            for data in client.fetch(ids[start:start + 500], ["ENVELOPE"]).values():
                envelope = data.get(b"ENVELOPE") if isinstance(data, dict) else None
                if envelope is None:
                    raise RuntimeError("REPLY_ENVELOPE_MISSING")
                for address in tuple(getattr(envelope, "from_", None) or ()) + tuple(getattr(envelope, "sender", None) or ()):
                    text = _address_text(address)
                    if text and "@" in text:
                        addresses.add(text)
                        domains.add(text.rsplit("@", 1)[1])
    if checked == 0:
        raise RuntimeError("REPLY_MAILBOX_HAS_NO_SELECTABLE_FOLDERS")
    return addresses, domains


def replied_from_senders(emails: list[str], addresses: set[str], domains: set[str], expected_address: str) -> dict[str, bool]:
    """Same rule as search_folders_for_sender: the address itself, or another address at the business domain."""
    result: dict[str, bool] = {}
    for email in emails:
        normalized = email.strip().lower()
        domain = business_reply_domain(normalized, expected_address)
        result[normalized] = normalized in addresses or (domain is not None and domain in domains)
    return result


def recipients_have_replied(emails: list[str], expected_address: str) -> dict[str, bool]:
    """Batch variant of recipient_has_replied: one connection, one read of the senders."""
    for email in emails:
        if not EMAIL_PATTERN.fullmatch(email.strip()):
            raise ValueError("VALID_EMAIL_REQUIRED")
    import django

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cold_outreach.settings")
    django.setup()
    from cold_outreach.emails.models import Mailbox
    from cold_outreach.emails.sync import _connect

    mailbox = Mailbox.objects.filter(from_address__iexact=expected_address).first()
    if mailbox is None:
        raise RuntimeError("REPLY_MONITOR_MAILBOX_NOT_CONFIGURED")
    with _connect(mailbox) as client:
        addresses, domains = collect_mailbox_senders(client)
    return replied_from_senders(emails, addresses, domains, expected_address)


def _handle_reply_status(handler: "IngestHandler", body: bytes) -> None:
    """Authenticated reply check. Any monitor/IMAP failure returns unavailable, never false."""
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        handler._respond(400, {"error": "INVALID_JSON"})
        return
    batch = payload.get("emails") if isinstance(payload, dict) else None
    if isinstance(batch, list):
        _handle_reply_status_batch(handler, batch)
        return
    if not isinstance(payload, dict) or not isinstance(payload.get("email"), str):
        handler._respond(400, {"error": "VALID_EMAIL_REQUIRED"})
        return
    email = payload["email"].strip()
    if not EMAIL_PATTERN.fullmatch(email):
        handler._respond(400, {"error": "VALID_EMAIL_REQUIRED"})
        return
    if os.environ.get(REPLY_MONITOR_ENABLED_ENV, "").strip().lower() != "true":
        handler._respond(503, {"error": "REPLY_MONITOR_DISABLED"})
        return
    configured = os.environ.get(REPLY_MONITOR_MAILBOX_ENV, "").strip().lower()
    actual = os.environ.get("OUTSEND_MAILBOX_ADDRESS", "").strip().lower()
    state = reply_monitor_state()
    if not configured or configured != actual or configured != "jelassi@cideamarketing.com":
        handler._respond(503, {"error": "REPLY_MONITOR_MAILBOX_MISMATCH"})
        return
    if not reply_monitor_healthy(state):
        handler._respond(503, {"error": "REPLY_MONITOR_UNHEALTHY"})
        return
    try:
        replied = recipient_has_replied(email, configured)
    except Exception as exc:
        handler._respond(503, {"error": "REPLY_LOOKUP_FAILED", "failure_type": type(exc).__name__})
        return
    handler._respond(200, {"replied": replied, "mode": "read_only_reply_check", "send_triggered": False})


def _reply_monitor_ready(handler: "IngestHandler") -> str | None:
    """The configured mailbox when lookups may run; otherwise responds 503 and returns None."""
    if os.environ.get(REPLY_MONITOR_ENABLED_ENV, "").strip().lower() != "true":
        handler._respond(503, {"error": "REPLY_MONITOR_DISABLED"})
        return None
    configured = os.environ.get(REPLY_MONITOR_MAILBOX_ENV, "").strip().lower()
    actual = os.environ.get("OUTSEND_MAILBOX_ADDRESS", "").strip().lower()
    if not configured or configured != actual or configured != "jelassi@cideamarketing.com":
        handler._respond(503, {"error": "REPLY_MONITOR_MAILBOX_MISMATCH"})
        return None
    if not reply_monitor_healthy(reply_monitor_state()):
        handler._respond(503, {"error": "REPLY_MONITOR_UNHEALTHY"})
        return None
    return configured


def _handle_reply_status_batch(handler: "IngestHandler", batch: list[Any]) -> None:
    """{"emails": [...]} -> {"replied_by_email": {email: bool}}. Any failure answers 503, never a partial false."""
    if not batch or len(batch) > REPLY_STATUS_BATCH_MAX:
        handler._respond(400, {"error": "BATCH_SIZE_INVALID", "max": REPLY_STATUS_BATCH_MAX})
        return
    if not all(isinstance(item, str) and EMAIL_PATTERN.fullmatch(item.strip()) for item in batch):
        handler._respond(400, {"error": "VALID_EMAIL_REQUIRED"})
        return
    configured = _reply_monitor_ready(handler)
    if configured is None:
        return
    try:
        replied = recipients_have_replied([item.strip() for item in batch], configured)
    except Exception as exc:
        handler._respond(503, {"error": "REPLY_LOOKUP_FAILED", "failure_type": type(exc).__name__})
        return
    handler._respond(200, {"replied_by_email": replied, "mode": "read_only_reply_check", "send_triggered": False})


def _probe_reply_mailbox(expected_address: str) -> None:
    """Verify that the configured IMAP mailbox matches the Cidea sender and is readable."""
    import django

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cold_outreach.settings")
    django.setup()
    from cold_outreach.emails.models import Mailbox
    from cold_outreach.emails.sync import _connect

    mailbox = Mailbox.objects.filter(from_address__iexact=expected_address).first()
    if mailbox is None:
        raise RuntimeError("REPLY_MONITOR_MAILBOX_NOT_CONFIGURED")
    with _connect(mailbox) as client:
        client.select_folder("INBOX", readonly=True)


def run_reply_monitor_once(
    mailbox_probe=None,
    mail_pass_runner=None,
) -> dict[str, Any]:
    """Read/classify inbound mail only. Never invokes the OpenOutSend send command."""
    now = datetime.now(timezone.utc).isoformat()
    if os.environ.get(REPLY_MONITOR_ENABLED_ENV, "").strip().lower() != "true":
        _update_reply_monitor_state(
            status="disabled", last_check_at=now, last_error_code=None
        )
        return reply_monitor_state()

    configured = os.environ.get(REPLY_MONITOR_MAILBOX_ENV, "").strip().lower()
    actual = os.environ.get("OUTSEND_MAILBOX_ADDRESS", "").strip().lower()
    if not configured or not actual:
        _update_reply_monitor_state(
            status="blocked_configuration", last_check_at=now,
            last_error_code="REPLY_MONITOR_MAILBOX_CONFIG_REQUIRED"
        )
        return reply_monitor_state()
    if configured != actual:
        _update_reply_monitor_state(
            status="blocked_mailbox_mismatch", last_check_at=now,
            last_error_code="REPLY_MONITOR_MAILBOX_MISMATCH"
        )
        return reply_monitor_state()

    try:
        (mailbox_probe or _probe_reply_mailbox)(configured)
        if mail_pass_runner is None:
            import django
            os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cold_outreach.settings")
            django.setup()
            from cold_outreach.emails.mail_pass import run_mail_pass
            mail_pass_runner = run_mail_pass
        mirrored, classified, projected = mail_pass_runner()
        completed = datetime.now(timezone.utc).isoformat()
        _update_reply_monitor_state(
            status="running", last_check_at=completed, last_success_at=completed,
            last_counts={"mirrored": mirrored, "classified": classified, "projected": projected},
            last_error_code=None
        )
    except Exception as exc:
        # Never write exception text to logs or health responses; providers can include
        # addresses, hostnames, and other mailbox details in exception messages.
        _update_reply_monitor_state(
            status="degraded", last_check_at=datetime.now(timezone.utc).isoformat(),
            last_error_code=type(exc).__name__
        )
    return reply_monitor_state()


def _reply_monitor_loop() -> None:
    try:
        interval = int(os.environ.get(REPLY_MONITOR_INTERVAL_ENV, str(DEFAULT_REPLY_MONITOR_INTERVAL)))
    except ValueError:
        interval = DEFAULT_REPLY_MONITOR_INTERVAL
    if interval < 60 or interval > 3600:
        interval = DEFAULT_REPLY_MONITOR_INTERVAL
    while not _REPLY_MONITOR_STOP.is_set():
        state = run_reply_monitor_once()
        print("reply-monitor status=" + str(state.get("status")) +
              " error=" + str(state.get("last_error_code") or "none"))
        _REPLY_MONITOR_STOP.wait(interval)


def start_reply_monitor() -> None:
    """Start an optional read-only IMAP sync loop after the HTTP listener is prepared."""
    if os.environ.get(REPLY_MONITOR_ENABLED_ENV, "").strip().lower() != "true":
        _update_reply_monitor_state(
            status="disabled", last_error_code=None
        )
        print("reply-monitor startup status=disabled")
        return
    expected = os.environ.get(REPLY_MONITOR_MAILBOX_ENV, "").strip().lower()
    actual = os.environ.get("OUTSEND_MAILBOX_ADDRESS", "").strip().lower()
    if not expected or not actual:
        _update_reply_monitor_state(
            status="blocked_configuration",
            last_error_code="REPLY_MONITOR_MAILBOX_CONFIG_REQUIRED"
        )
        print("reply-monitor startup status=blocked_configuration")
        return
    if expected != actual:
        _update_reply_monitor_state(
            status="blocked_mailbox_mismatch",
            last_error_code="REPLY_MONITOR_MAILBOX_MISMATCH"
        )
        print("reply-monitor startup status=blocked_mailbox_mismatch")
        return
    _update_reply_monitor_state(status="starting", last_error_code=None)
    print("reply-monitor startup status=starting")
    threading.Thread(target=_reply_monitor_loop, name="reply-monitor", daemon=True).start()


def _handle_retention_status(handler: "IngestHandler", body: bytes) -> None:
    # No execute flag, custom query, mailbox selector or data fields are accepted.
    try:
        if json.loads(body) != {}:
            raise ValueError("EMPTY_OBJECT_REQUIRED")
    except (ValueError, UnicodeDecodeError):
        handler._respond(400, {"error": "EMPTY_OBJECT_REQUIRED"})
        return
    configured = _reply_monitor_ready(handler)
    if configured is None:
        return
    try:
        from openoutsend_retention import COUNT_FIELDS, POLICY_DAYS, mailbox_inventory
        raw_counts = mailbox_inventory(configured)
        counts = {key: raw_counts[key] for key in COUNT_FIELDS}
        if any(type(value) is not int or value < 0 for value in counts.values()):
            raise ValueError("INVALID_COUNTS")
    except Exception:
        handler._respond(503, {"error": "RETENTION_INVENTORY_UNAVAILABLE"})
        return
    handler._respond(200, {"mode": "read_only_retention_inventory", "policy_days": POLICY_DAYS,
        "ttl_enabled": False, "send_triggered": False, "data_changed": False, "counts": counts})


class IngestHandler(BaseHTTPRequestHandler):
    server_version = "OpenOutSendIngest/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        # Avoid logging headers, payloads, email addresses or credentials.
        print("openoutsend-ingest " + (fmt % args))

    def _respond(self, status: int, payload: dict[str, Any]) -> None:
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._respond(200, {"ok": True, "service": "openoutsend-ingest", "reply_monitor": reply_monitor_state()})
            return
        self._respond(404, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:
        if self.path not in {INGEST_PATH, REPLY_STATUS_PATH, RETENTION_STATUS_PATH}:
            self._respond(404, {"error": "NOT_FOUND"})
            return

        if self.path in {REPLY_STATUS_PATH, RETENTION_STATUS_PATH}:
            if not (os.environ.get(TOKEN_ENV, "").strip() or os.environ.get(REPLY_STATUS_TOKEN_ENV, "").strip()):
                self._respond(503, {"error": "INGEST_NOT_CONFIGURED"})
                return
            if not reply_status_authorized(self.headers.get("Authorization")):
                self._respond(401, {"error": "UNAUTHORIZED"})
                return
        else:
            # Ingest authentication is unchanged: only the ingest token is accepted.
            token = os.environ.get(TOKEN_ENV)
            if not token:
                self._respond(503, {"error": "INGEST_NOT_CONFIGURED"})
                return
            if not authorized(self.headers.get("Authorization"), token):
                self._respond(401, {"error": "UNAUTHORIZED"})
                return

        content_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if self.path in {REPLY_STATUS_PATH, RETENTION_STATUS_PATH}:
            if content_type != "application/json":
                self._respond(415, {"error": "JSON_REQUIRED"})
                return
        elif content_type not in {"application/x-ndjson", "application/ndjson"}:
            self._respond(415, {"error": "NDJSON_REQUIRED"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._respond(400, {"error": "INVALID_CONTENT_LENGTH"})
            return
        body_limit = 1024 if self.path == RETENTION_STATUS_PATH else MAX_BODY_BYTES
        if content_length <= 0 or content_length > body_limit:
            self._respond(413 if content_length > body_limit else 400, {"error": "INVALID_BODY_SIZE"})
            return

        body = self.rfile.read(content_length)
        if self.path == RETENTION_STATUS_PATH:
            _handle_retention_status(self, body)
            return
        if self.path == REPLY_STATUS_PATH:
            _handle_reply_status(self, body)
            return

        try:
            records, canonical = parse_jsonl(body)
        except ValueError as exc:
            self._respond(400, {"error": str(exc)})
            return

        try:
            result = subprocess.run(
                ["outsend"],
                input=canonical,
                text=True,
                capture_output=True,
                timeout=45,
                check=False,
            )
        except subprocess.TimeoutExpired:
            self._respond(504, {"error": "OPENOUTSEND_INGEST_TIMEOUT"})
            return
        except OSError:
            self._respond(503, {"error": "OPENOUTSEND_UNAVAILABLE"})
            return

        if result.returncode != 0:
            self._respond(502, {"error": "OPENOUTSEND_INGEST_FAILED"})
            return

        self._respond(200, {
            "accepted": len(records),
            "mode": "ingest_only",
            "send_triggered": False,
        })


def run_startup_acceptance_test(base_url: str, token: str) -> None:
    if os.environ.get("OPENOUTREACH_STARTUP_ACCEPTANCE_TEST", "").strip().lower() != "true":
        return

    import urllib.request

    payload = b'{"lead_id":"phase9-synthetic-acceptance","email":"acceptance@example.invalid","company":"Phase 9 Synthetic Acceptance"}\n'
    request = urllib.request.Request(
        base_url + INGEST_PATH,
        data=payload,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/x-ndjson",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response_body = response.read().decode("utf-8")
            result = json.loads(response_body)
    except Exception as exc:
        raise SystemExit("Synthetic acceptance test failed") from exc

    if result != {"accepted": 1, "mode": "ingest_only", "send_triggered": False}:
        raise SystemExit("Synthetic acceptance test returned an unexpected response")
    print("Synthetic acceptance test passed: accepted=1; mode=ingest_only; send_triggered=false")

    # Wait for the read-only IMAP monitor to complete one successful pass. If it
    # is unavailable, the acceptance fails closed; no reply result is guessed.
    deadline = time.monotonic() + 45
    health_payload: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(base_url + "/health", timeout=5) as response:
                candidate = json.loads(response.read().decode("utf-8"))
            state = candidate.get("reply_monitor", {}) if isinstance(candidate, dict) else {}
            if (
                state.get("status") == "running"
                and state.get("last_success_at")
                and state.get("last_error_code") is None
            ):
                health_payload = candidate
                break
        except Exception:
            pass
        time.sleep(1)
    if health_payload is None:
        raise SystemExit("Reply monitor did not become healthy during synthetic acceptance")

    reply_request = urllib.request.Request(
        base_url + REPLY_STATUS_PATH,
        data=json.dumps({"email": "phase11-acceptance@example.invalid"}).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(reply_request, timeout=10) as response:
            reply_result = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise SystemExit("Synthetic reply-status acceptance failed") from exc
    if (
        not isinstance(reply_result, dict)
        or not isinstance(reply_result.get("replied"), bool)
        or reply_result.get("mode") != "read_only_reply_check"
        or reply_result.get("send_triggered") is not False
    ):
        raise SystemExit("Synthetic reply-status acceptance returned an unexpected response")
    print("Synthetic reply-status acceptance passed; mode=read_only_reply_check; send_triggered=false")

    # Optional one-time check of the approved Phase 11 pilot recipient. The address
    # is supplied only as a Railway runtime variable during acceptance and is never
    # printed to logs or stored by this code.
    pilot_email = os.environ.get("OPENOUTREACH_REPLY_ACCEPTANCE_EMAIL", "").strip().lower()
    if pilot_email:
        if not EMAIL_PATTERN.fullmatch(pilot_email):
            raise SystemExit("Configured pilot reply acceptance address is invalid")
        pilot_request = urllib.request.Request(
            base_url + REPLY_STATUS_PATH,
            data=json.dumps({"email": pilot_email}).encode("utf-8"),
            headers={
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(pilot_request, timeout=10) as response:
                pilot_result = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            raise SystemExit("Pilot reply-status acceptance failed") from exc
        if (
            not isinstance(pilot_result, dict)
            or not isinstance(pilot_result.get("replied"), bool)
            or pilot_result.get("mode") != "read_only_reply_check"
            or pilot_result.get("send_triggered") is not False
        ):
            raise SystemExit("Pilot reply-status acceptance returned an unexpected response")
        print("Pilot recipient reply lookup completed; replied=" + str(pilot_result["replied"]).lower())


def main() -> None:
    if not os.environ.get(TOKEN_ENV, "").strip():
        raise SystemExit(f"{TOKEN_ENV} must be configured; refusing to start an unauthenticated ingest API")

    validate_reply_status_token()

    check = subprocess.run(["outsend", "check"], capture_output=True, text=True, timeout=45, check=False)
    if check.returncode != 0:
        raise SystemExit("OpenOutSend runtime check failed; ingest API will not start")

    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), IngestHandler)
    print(f"OpenOutSend ingest API listening on port {port}; send endpoint is not exposed")

    start_reply_monitor()
    if os.environ.get("OPENOUTREACH_STARTUP_ACCEPTANCE_TEST", "").strip().lower() == "true":
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run_startup_acceptance_test(f"http://127.0.0.1:{port}", os.environ[TOKEN_ENV].strip())
        finally:
            server.shutdown()
            thread.join(timeout=2)
    server.serve_forever()


if __name__ == "__main__":
    main()
