"""Read-only inventory of mirrored inbound content. No deletion or sending capability."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

POLICY_DAYS = 30
COUNT_FIELDS = ("total", "with_content", "processed_older_than_policy", "pending_older_than_policy", "invalid_dates")


def inventory(connection, table: str, mailbox_id: int, now: datetime) -> dict[str, int]:
    """A single SELECT; never fetch message content into Python or trust a sender's Date header.

    Older processed messages still require review of the canonical copy and preservation
    of reply/suppression evidence. They are NOT automatically safe to delete.
    Django SQLite datetimes are stored in UTC when USE_TZ is enabled (checked by caller).
    """
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table):
        raise ValueError("UNSUPPORTED_TABLE")
    if type(mailbox_id) is not int or mailbox_id <= 0 or now.tzinfo is None:
        raise ValueError("INVALID_INVENTORY_CONTEXT")
    now = now.astimezone(timezone.utc)
    cutoff = (now - timedelta(days=POLICY_DAYS)).isoformat()
    has_content = "(length(COALESCE(raw, X'')) > 0 OR length(COALESCE(body_text, '')) > 0)"
    old = "julianday(recorded_at) <= julianday(?)"
    processed = "(julianday(processed_at) IS NOT NULL AND julianday(processed_at) <= julianday(?))"
    # table is model metadata, validated above; all data values are bound parameters.
    sql = f'''SELECT COUNT(*),
      COALESCE(SUM(CASE WHEN {has_content} THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN {old} AND {processed} AND {has_content} THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN {old} AND processed_at IS NULL AND {has_content} THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN julianday(recorded_at) IS NULL OR julianday(recorded_at) > julianday(?)
        OR (processed_at IS NOT NULL AND (julianday(processed_at) IS NULL OR julianday(processed_at) > julianday(?)))
        THEN 1 ELSE 0 END), 0)
      FROM "{table}" WHERE mailbox_id = ? AND direction = 'in' '''
    cursor = connection.cursor()
    try:
        row = cursor.execute(sql, (cutoff, now.isoformat(), cutoff, now.isoformat(), now.isoformat(), mailbox_id)).fetchone()
    finally:
        cursor.close()
    if row is None or len(row) != len(COUNT_FIELDS):
        raise RuntimeError("INVALID_INVENTORY_RESULT")
    return dict(zip(COUNT_FIELDS, (int(value) for value in row)))


def mailbox_inventory(address: str, now: datetime | None = None) -> dict[str, int]:
    import django
    django.setup()
    from django.conf import settings
    from django.db import connections
    from cold_outreach.emails.models import Mailbox, Message

    db = connections["default"]
    if db.vendor != "sqlite" or not settings.USE_TZ:
        raise RuntimeError("UNSUPPORTED_INVENTORY_DATABASE")
    mailbox_id = Mailbox.objects.filter(from_address__iexact=address).values_list("pk", flat=True).first()
    if mailbox_id is None:
        raise RuntimeError("INVENTORY_MAILBOX_NOT_CONFIGURED")
    db.ensure_connection()
    return inventory(db.connection, Message._meta.db_table, mailbox_id, now or datetime.now(timezone.utc))
