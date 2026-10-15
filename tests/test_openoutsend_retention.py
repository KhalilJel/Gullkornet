import json
import os
import sqlite3
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import openoutsend_ingest_api as api
import openoutsend_retention as retention


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("CREATE TABLE messages (mailbox_id INTEGER, direction TEXT, recorded_at TEXT, processed_at TEXT, raw BLOB, body_text TEXT)")
        self.now = datetime(2026, 10, 15, 12, tzinfo=timezone.utc)

    def tearDown(self):
        self.db.close()

    def add(self, days, *, mailbox=1, direction="in", pending=False, raw=b"private raw", body="private text", date=None, processed=None):
        self.db.execute("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)", (
            mailbox, direction, date or (self.now - timedelta(days=days)).isoformat(),
            None if pending else processed or self.now.isoformat(), raw, body))

    def test_inventory_uses_storage_clock_scopes_mailbox_and_never_writes(self):
        self.add(30)  # exact boundary
        self.add(31, pending=True)
        self.add(29)
        self.add(31, raw=None, body="")  # already content-free
        self.add(90, mailbox=2)
        self.add(90, direction="out")
        self.add(0, date="invalid private date")
        self.add(-1)
        self.add(31, processed="invalid private date")
        self.db.commit()
        before = self.db.total_changes
        # SQLite itself denies everything except reads/functions, independently of implementation claims.
        allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION}
        self.db.set_authorizer(lambda action, *args: sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY)
        result = retention.inventory(self.db, "messages", 1, self.now)
        self.assertEqual(result, {"total": 7, "with_content": 6, "processed_older_than_policy": 1,
            "pending_older_than_policy": 1, "invalid_dates": 3})
        self.assertEqual(self.db.total_changes, before)
        self.assertNotIn("private", json.dumps(result))

    def test_empty_is_zero_but_schema_failures_are_not_a_successful_empty_inventory(self):
        self.assertTrue(all(value == 0 for value in retention.inventory(self.db, "messages", 1, self.now).values()))
        with self.assertRaises(sqlite3.OperationalError):
            retention.inventory(self.db, "missing_table", 1, self.now)
        with self.assertRaises(ValueError):
            retention.inventory(self.db, "messages; DROP TABLE messages", 1, self.now)
        with self.assertRaises(ValueError):
            retention.inventory(self.db, "messages", 1, self.now.replace(tzinfo=None))


class InventoryEndpointTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), api.IngestHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}{api.RETENTION_STATUS_PATH}"
        self.env = patch.dict(os.environ, {api.TOKEN_ENV: "test-ingest-token", api.REPLY_STATUS_TOKEN_ENV: "r" * 40})
        self.env.start()
        self.ready = patch.object(api, "_reply_monitor_ready", return_value="configured-mailbox")
        self.ready.start()

    def tearDown(self):
        self.ready.stop()
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, body=b"{}", token=None):
        return urlopen(Request(self.url, data=body, headers={"Authorization": "Bearer " + (token or "r" * 40),
            "Content-Type": "application/json"}, method="POST"), timeout=3)

    def test_read_only_token_can_read_counts_but_cannot_request_execution(self):
        counts = dict.fromkeys(retention.COUNT_FIELDS, 0)
        with patch.object(retention, "mailbox_inventory", return_value=counts) as collect:
            with self.request() as response:
                data = json.loads(response.read())
            self.assertEqual(data["counts"], counts)
            self.assertFalse(data["ttl_enabled"])
            self.assertFalse(data["send_triggered"])
            self.assertFalse(data["data_changed"])
            self.assertEqual(data["policy_days"], 30)
            collect.assert_called_once_with("configured-mailbox")
            collect.reset_mock()
            for body in [b'{"execute":true}', b'{"mailbox":"other"}', b'[]', b'null', b'bad JSON']:
                with self.assertRaises(HTTPError) as caught:
                    self.request(body)
                self.assertEqual(caught.exception.code, 400)
            collect.assert_not_called()

    def test_unauthorized_and_oversized_requests_do_not_access_database(self):
        with patch.object(retention, "mailbox_inventory") as collect:
            with self.assertRaises(HTTPError) as caught:
                self.request(token="wrong")
            self.assertEqual(caught.exception.code, 401)
            with self.assertRaises(HTTPError) as caught:
                self.request(b" " * 1025)
            self.assertEqual(caught.exception.code, 413)
            collect.assert_not_called()

    def test_inventory_failure_never_leaks_content_or_fakes_zero(self):
        with patch.object(retention, "mailbox_inventory", side_effect=RuntimeError("private mailbox details")):
            with self.assertRaises(HTTPError) as caught:
                self.request()
            self.assertEqual(caught.exception.code, 503)
            self.assertEqual(json.loads(caught.exception.read()), {"error": "RETENTION_INVENTORY_UNAVAILABLE"})
        with patch.object(api, "_reply_monitor_ready", return_value=None), patch.object(retention, "mailbox_inventory") as collect:
            # The real readiness function emits the HTTP error; no lookup is allowed if it returns None.
            handler = type("Handler", (), {"_respond": lambda *args: None})()
            api._handle_retention_status(handler, b"{}")
            collect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
