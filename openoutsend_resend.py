"""Resend HTTPS transport for the OpenOutSend runtime.

This module is intentionally small: OpenOutSend remains the owner of drafts,
suppression, pacing, mailbox state, IMAP reply detection and send bookkeeping.
This module replaces only the SMTP delivery/check edge when
OUTSEND_MAIL_TRANSPORT=resend.
"""
from __future__ import annotations

import hashlib
import json
import os
from email.message import EmailMessage
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

RESEND_API = "https://api.resend.com"
TIMEOUT_SECONDS = 15


class ResendTransportError(RuntimeError):
    pass


def _api_key() -> str:
    key = (os.environ.get("RESEND_API_KEY") or "").strip()
    if not key:
        raise ResendTransportError("RESEND_API_KEY is required for Resend transport")
    return key


def _request(path: str, *, method: str = "GET", payload: dict | None = None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        f"{RESEND_API}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {_api_key()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "gullkornet-openoutsend-resend/1",
        },
    )
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read()
            return response.status, json.loads(raw.decode("utf-8") or "{}")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
        except json.JSONDecodeError:
            detail = raw
        if isinstance(detail, dict):
            detail = detail.get("message") or detail.get("name") or detail
        raise ResendTransportError(f"Resend HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise ResendTransportError(f"Resend connection failed: {exc.reason}") from exc


def verify_sender(from_address: str) -> tuple[bool, str]:
    """Validate the Resend key and the sender's verified domain without sending."""
    from_address = from_address.strip().lower()
    if "@" not in from_address:
        return False, "invalid sender address"

    domain = from_address.rsplit("@", 1)[1]
    try:
        status, payload = _request("/domains")
    except ResendTransportError as exc:
        return False, str(exc)

    if status != 200:
        return False, f"Resend returned HTTP {status}"

    domains = payload.get("data", []) if isinstance(payload, dict) else []
    for item in domains:
        if not isinstance(item, dict):
            continue
        if str(item.get("name", "")).lower() != domain:
            continue
        if str(item.get("status", "")).lower() != "verified":
            return False, f"Resend domain {domain} is not verified"
        capabilities = item.get("capabilities") or {}
        if str(capabilities.get("sending", "")).lower() != "enabled":
            return False, f"Resend sending is not enabled for {domain}"
        return True, "ok"

    return False, f"Resend has no verified sending domain for {domain}"


def deliver(email_message: EmailMessage) -> tuple[int, bytes]:
    """Send one OpenOutSend message through Resend and return SMTP-like acceptance data."""
    from_address = (email_message.get("From") or "").strip()
    to_address = (email_message.get("To") or "").strip()
    bcc_address = (email_message.get("Bcc") or "").strip()
    subject = email_message.get("Subject") or ""
    message_id = email_message.get("Message-ID") or ""

    if not from_address or not to_address:
        raise ResendTransportError("Resend transport requires From and To")

    payload: dict[str, object] = {
        "from": from_address,
        "to": [to_address],
        "subject": subject,
        "text": email_message.get_body(preferencelist=("plain",)).get_content()
        if email_message.get_body(preferencelist=("plain",)) is not None
        else email_message.get_content(),
    }

    if bcc_address:
        payload["bcc"] = [bcc_address]

    headers: dict[str, str] = {}
    for name, value in email_message.items():
        if name.lower() in {
            "from", "to", "bcc", "cc", "subject",
            "content-type", "content-transfer-encoding", "mime-version",
        }:
            continue
        headers[name] = str(value)
    if headers:
        payload["headers"] = headers

    idempotency_material = "|".join([
        message_id,
        from_address,
        to_address,
        subject,
        str(payload.get("text", "")),
    ]).encode("utf-8")
    idempotency_key = "openoutsend-" + hashlib.sha256(idempotency_material).hexdigest()
    
    status, response = _request(
        "/emails",
        method="POST",
        payload=payload,
    )
    # The transport API needs the idempotency key on the actual request. The helper
    # above intentionally handles ordinary GET/POST requests, so retry the POST here
    # with the required header using the same payload.
    request = Request(
        f"{RESEND_API}/emails",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {_api_key()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "gullkornet-openoutsend-resend/1",
            "Idempotency-Key": idempotency_key,
        },
    )
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response_obj:
            status = response_obj.status
            response = json.loads(response_obj.read().decode("utf-8") or "{}")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
        except json.JSONDecodeError:
            detail = raw
        if isinstance(detail, dict):
            detail = detail.get("message") or detail.get("name") or detail
        raise ResendTransportError(f"Resend HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise ResendTransportError(f"Resend connection failed: {exc.reason}") from exc

    email_id = response.get("id") if isinstance(response, dict) else None
    if status != 200 or not isinstance(email_id, str) or not email_id:
        raise ResendTransportError(f"Resend returned an unexpected response: {response!r}")

    return status, f"resend-email-id={email_id}".encode("utf-8")


def enabled() -> bool:
    return (os.environ.get("OUTSEND_MAIL_TRANSPORT") or "smtp").strip().lower() == "resend"


def install() -> None:
    """Install the transport only when explicitly selected by environment."""
    if not enabled():
        return

    from cold_outreach.emails import sender, smtp

    def verify_auth(host: str, port: int, username: str, password: str):
        return verify_sender(username)

    def deliver_from_sender(mailbox, email_message, row):
        from cold_outreach.emails.delivery_policy import record_acceptance, record_failure

        try:
            status, response = deliver(email_message)
            record_acceptance(row, status, response)
        except Exception as exc:
            record_failure(row, exc)
            raise

    smtp.verify_auth = verify_auth
    sender._deliver = deliver_from_sender

    from cold_outreach import first_run
    original_check_ready = first_run.check_ready

    def check_ready(*, agent_draft_active: bool = False):
        original_check_ready(agent_draft_active=agent_draft_active)
        from cold_outreach.emails.models import Mailbox

        mailbox = Mailbox.objects.order_by("pk").first()
        if mailbox is None:
            raise first_run.OutsendError("Resend transport selected but no mailbox is configured")
        ok, reason = verify_sender(mailbox.from_address)
        if not ok:
            raise first_run.OutsendError(f"Resend transport check failed: {reason}")

    first_run.check_ready = check_ready
