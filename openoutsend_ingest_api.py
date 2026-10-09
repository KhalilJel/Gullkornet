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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

MAX_BODY_BYTES = 2_000_000
MAX_RECORDS = 100
INGEST_PATH = "/v1/leads"
TOKEN_ENV = "OPENOUTREACH_INGEST_TOKEN"
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
            self._respond(200, {"ok": True, "service": "openoutsend-ingest"})
            return
        self._respond(404, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:
        if self.path != INGEST_PATH:
            self._respond(404, {"error": "NOT_FOUND"})
            return

        token = os.environ.get(TOKEN_ENV)
        if not token:
            self._respond(503, {"error": "INGEST_NOT_CONFIGURED"})
            return
        if not authorized(self.headers.get("Authorization"), token):
            self._respond(401, {"error": "UNAUTHORIZED"})
            return

        content_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if content_type not in {"application/x-ndjson", "application/ndjson"}:
            self._respond(415, {"error": "NDJSON_REQUIRED"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._respond(400, {"error": "INVALID_CONTENT_LENGTH"})
            return
        if content_length <= 0 or content_length > MAX_BODY_BYTES:
            self._respond(413 if content_length > MAX_BODY_BYTES else 400, {"error": "INVALID_BODY_SIZE"})
            return

        body = self.rfile.read(content_length)
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


def main() -> None:
    if not os.environ.get(TOKEN_ENV, "").strip():
        raise SystemExit(f"{TOKEN_ENV} must be configured; refusing to start an unauthenticated ingest API")

    check = subprocess.run(["outsend", "check"], capture_output=True, text=True, timeout=45, check=False)
    if check.returncode != 0:
        raise SystemExit("OpenOutSend runtime check failed; ingest API will not start")

    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), IngestHandler)
    print(f"OpenOutSend ingest API listening on port {port}; send endpoint is not exposed")
    server.serve_forever()


if __name__ == "__main__":
    main()
