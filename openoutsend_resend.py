"""Resend HTTPS transport used by the OpenOutSend runtime.

OpenOutSend remains responsible for drafts, suppression, pacing, mailbox state,
IMAP reply detection and send bookkeeping. This module owns only the HTTPS
delivery/check edge when OUTSEND_MAIL_TRANSPORT=resend.
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


def enabled() -> bool:
    return (os.environ.get("OUTSEND_MAIL_TRANSPORT") or "smtp").strip().lower() == "resend"


def _api_key() -> str:
    key = (os.environ.get("RESEND_API_KEY") or "").strip()
    if not key:
        raise ResendTransportError("RESEND_API_KEY is required for Resend transport")
    return key


def _request(path: str, *, method: str = "GET", payload: dict | None = None, idempotency_key: str | None = None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "gullkornet-openoutsend-resend/1",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    request = Request(f"{RESEND_API}{path}", data=body, method=method, headers=headers)
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
    """Validate the Resend key and sender domain without sending."""
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
    """Send one OpenOutSend message through Resend."""
    from_address = (email_message.get("From") or "").strip()
    to_address = (email_message.get("To") or "").strip()
    bcc_address = (email_message.get("Bcc") or "").strip()
    subject = email_message.get("Subject") or ""
    message_id = email_message.get("Message-ID") or ""

    if not from_address or not to_address:
        raise ResendTransportError("Resend transport requires From and To")

    plain_part = email_message.get_body(preferencelist=("plain",))
    text = plain_part.get_content() if plain_part is not None else email_message.get_content()

    payload: dict[str, object] = {
        "from": from_address,
        "to": [to_address],
        "subject": subject,
        "text": text,
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
        text,
    ]).encode("utf-8")
    idempotency_key = "openoutsend-" + hashlib.sha256(idempotency_material).hexdigest()

    status, response = _request(
        "/emails",
        method="POST",
        payload=payload,
        idempotency_key=idempotency_key,
    )
    email_id = response.get("id") if isinstance(response, dict) else None
    if status != 200 or not isinstance(email_id, str) or not email_id:
        raise ResendTransportError(f"Resend returned an unexpected response: {response!r}")

    return status, f"resend-email-id={email_id}".encode("utf-8")
