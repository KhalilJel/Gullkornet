import contextlib
import io
import json
import os
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import openoutsend_ingest_api as api


class IngestApiTests(unittest.TestCase):
    def test_parse_valid_jsonl_and_normalize(self):
        records, normalized = api.parse_jsonl(b'{"lead_id":"lead-1","email":"hello@example.no"}\n')
        self.assertEqual(len(records), 1)
        self.assertIn('"lead_id":"lead-1"', normalized)
        self.assertTrue(normalized.endswith("\n"))

    def test_parse_rejects_missing_id_invalid_email_and_duplicates(self):
        cases = [
            (b'{"email":"hello@example.no"}\n', "LEAD_ID_REQUIRED"),
            (b'{"lead_id":"1","email":"not-an-email"}\n', "VALID_EMAIL_REQUIRED"),
            (b'{"lead_id":"1","email":"hello@example.no"}\n{"lead_id":"1","email":"hello@example.no"}\n', "DUPLICATE_LEAD_ID_IN_BATCH"),
        ]
        for body, expected in cases:
            with self.subTest(expected=expected):
                with self.assertRaisesRegex(ValueError, expected):
                    api.parse_jsonl(body)

    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), api.IngestHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, body=None, token=None, content_type="application/x-ndjson"):
        headers = {}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        if body is not None:
            headers["Content-Type"] = content_type
        request = Request(self.base_url + path, data=body, headers=headers, method="POST" if body is not None else "GET")
        return urlopen(request, timeout=3)

    def test_health_endpoint_does_not_expose_configuration(self):
        with self.request("/health") as response:
            payload = json.loads(response.read())
        self.assertEqual(payload["ok"], True)
        self.assertEqual(payload["service"], "openoutsend-ingest")
        self.assertIn("reply_monitor", payload)
        self.assertNotIn("mailbox", json.dumps(payload).lower())
        self.assertNotIn("password", json.dumps(payload).lower())

    def test_unauthorized_request_never_invokes_outsend(self):
        body = b'{"lead_id":"lead-1","email":"hello@example.no"}\n'
        with patch.dict(os.environ, {api.TOKEN_ENV: "secret-test-token"}), patch.object(api.subprocess, "run") as run:
            with self.assertRaises(HTTPError) as error:
                self.request(api.INGEST_PATH, body=body, token="wrong")
            self.assertEqual(error.exception.code, 401)
            run.assert_not_called()

    def test_authorized_ingest_calls_only_outsend_without_send_arguments(self):
        body = b'{"lead_id":"lead-1","email":"hello@example.no","company":"Example AS"}\n'
        completed = type("Completed", (), {"returncode": 0, "stdout": "", "stderr": ""})()
        with patch.dict(os.environ, {api.TOKEN_ENV: "secret-test-token"}), patch.object(api.subprocess, "run", return_value=completed) as run:
            with self.request(api.INGEST_PATH, body=body, token="secret-test-token") as response:
                payload = json.loads(response.read())
            self.assertEqual(payload, {"accepted": 1, "mode": "ingest_only", "send_triggered": False})
            run.assert_called_once()
            args, kwargs = run.call_args
            self.assertEqual(args[0], ["outsend"])
            self.assertEqual(kwargs["input"], body.decode())
            self.assertNotIn("send", args[0])

    def test_wrong_content_type_is_rejected(self):
        body = b'{"lead_id":"lead-1","email":"hello@example.no"}\n'
        with patch.dict(os.environ, {api.TOKEN_ENV: "secret-test-token"}):
            with self.assertRaises(HTTPError) as error:
                self.request(api.INGEST_PATH, body=body, token="secret-test-token", content_type="application/json")
            self.assertEqual(error.exception.code, 415)


if __name__ == "__main__":
    unittest.main()


class ReplyMonitorTests(unittest.TestCase):
    def setUp(self):
        api._update_reply_monitor_state(
            status="disabled", last_check_at=None, last_success_at=None,
            last_counts=None, last_error_code=None
        )
        self.env = patch.dict(os.environ, {
            api.REPLY_MONITOR_ENABLED_ENV: "true",
            api.REPLY_MONITOR_MAILBOX_ENV: "jelassi@cideamarketing.com",
            "OUTSEND_MAILBOX_ADDRESS": "jelassi@cideamarketing.com",
        })
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_mailbox_mismatch_blocks_monitor_without_connecting(self):
        os.environ["OUTSEND_MAILBOX_ADDRESS"] = "jelassi@smartsvar.no"
        probe = unittest.mock.Mock()
        runner = unittest.mock.Mock()
        state = api.run_reply_monitor_once(mailbox_probe=probe, mail_pass_runner=runner)
        self.assertEqual(state["status"], "blocked_mailbox_mismatch")
        self.assertEqual(state["last_error_code"], "REPLY_MONITOR_MAILBOX_MISMATCH")
        probe.assert_not_called()
        runner.assert_not_called()

    def test_successful_monitor_only_runs_read_and_classification_pass(self):
        probe = unittest.mock.Mock()
        runner = unittest.mock.Mock(return_value=(2, 3, 1))
        state = api.run_reply_monitor_once(mailbox_probe=probe, mail_pass_runner=runner)
        self.assertEqual(state["status"], "running")
        self.assertEqual(state["last_counts"], {"mirrored": 2, "classified": 3, "projected": 1})
        probe.assert_called_once_with("jelassi@cideamarketing.com")
        runner.assert_called_once_with()

    def test_monitor_fails_closed_on_imap_or_processing_error(self):
        probe = unittest.mock.Mock(side_effect=RuntimeError("sensitive mailbox details"))
        state = api.run_reply_monitor_once(mailbox_probe=probe, mail_pass_runner=unittest.mock.Mock())
        self.assertEqual(state["status"], "degraded")
        self.assertEqual(state["last_error_code"], "RuntimeError")
        self.assertNotIn("sensitive mailbox details", json.dumps(state))

    def test_monitor_disabled_never_calls_mailbox_or_mail_pass(self):
        os.environ[api.REPLY_MONITOR_ENABLED_ENV] = "false"
        probe = unittest.mock.Mock()
        runner = unittest.mock.Mock()
        state = api.run_reply_monitor_once(mailbox_probe=probe, mail_pass_runner=runner)
        self.assertEqual(state["status"], "disabled")
        probe.assert_not_called()
        runner.assert_not_called()


    def test_monitor_startup_reports_safe_mismatch_status(self):
        os.environ["OUTSEND_MAILBOX_ADDRESS"] = "jelassi@smartsvar.no"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            api.start_reply_monitor()
        self.assertIn("reply-monitor startup status=blocked_mailbox_mismatch", output.getvalue())
        self.assertNotIn("smartsvar.no", output.getvalue())
        self.assertNotIn("cideamarketing.com", output.getvalue())
