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
        self.assertEqual(payload, {"ok": True, "service": "openoutsend-ingest"})

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
