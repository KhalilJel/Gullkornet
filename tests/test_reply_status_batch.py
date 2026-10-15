import json
import os
import sys
import threading
import unittest
import unittest.mock
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import openoutsend_ingest_api as api  # noqa: E402


def addr(mailbox: str, host: str) -> SimpleNamespace:
    return SimpleNamespace(mailbox=mailbox.encode(), host=host.encode())


class FakeClient:
    """Two folders; INBOX has a reply from a colleague at salong.no and a freemail sender."""

    def __init__(self, fail_fetch: bool = False):
        self.fail_fetch = fail_fetch
        self.selected: list[tuple[bytes, bool]] = []

    def __enter__(self): return self
    def __exit__(self, *exc): return False

    def list_folders(self):
        return [([], b"/", b"INBOX"), ([b"\\Noselect"], b"/", b"[Gmail]"), ([], b"/", b"Sent")]

    def select_folder(self, name, readonly):
        self.selected.append((name, readonly))

    def search(self, criteria):
        assert criteria == ["ALL"]
        return [1, 2] if self.selected[-1][0] == b"INBOX" else [3]

    def fetch(self, ids, items):
        assert items == ["ENVELOPE"]
        if self.fail_fetch:
            raise TimeoutError("private mailbox detail")
        data = {
            1: SimpleNamespace(from_=(addr("kari", "Salong.no"),), sender=None),
            2: SimpleNamespace(from_=(addr("owner", "gmail.com"),), sender=None),
            3: SimpleNamespace(from_=(addr("jelassi", "cideamarketing.com"),), sender=None),
        }
        return {i: {b"ENVELOPE": data[i]} for i in ids}


class ReplyStatusBatchLogicTests(unittest.TestCase):
    def test_collects_senders_from_every_selectable_folder_read_only(self):
        client = FakeClient()
        addresses, domains = api.collect_mailbox_senders(client)
        self.assertEqual(addresses, {"kari@salong.no", "owner@gmail.com", "jelassi@cideamarketing.com"})
        self.assertEqual([name for name, _ in client.selected], [b"INBOX", b"Sent"])
        self.assertTrue(all(readonly for _, readonly in client.selected))

    def test_same_rule_as_single_lookup_address_or_business_domain_never_freemail(self):
        addresses, domains = api.collect_mailbox_senders(FakeClient())
        result = api.replied_from_senders(
            ["post@salong.no", "owner@gmail.com", "other@gmail.com", "post@ukjent.no"],
            addresses, domains, "jelassi@cideamarketing.com")
        self.assertEqual(result, {
            "post@salong.no": True,       # colleague at the same business answered
            "owner@gmail.com": True,      # the address itself answered
            "other@gmail.com": False,     # freemail domain is never widened
            "post@ukjent.no": False,
        })

    def test_fails_closed_on_fetch_error(self):
        with self.assertRaises(TimeoutError):
            api.collect_mailbox_senders(FakeClient(fail_fetch=True))

    def test_fails_closed_without_selectable_folders(self):
        client = FakeClient()
        client.list_folders = lambda: [([b"\\Noselect"], b"/", b"X")]
        with self.assertRaises(RuntimeError):
            api.collect_mailbox_senders(client)

    def test_recipients_have_replied_uses_one_connection(self):
        connections = []

        def connect(_mailbox):
            connections.append(1)
            return FakeClient()

        mailbox_model = unittest.mock.Mock()
        mailbox_model.objects.filter.return_value.first.return_value = object()
        fake_modules = {
            "django": unittest.mock.Mock(),
            "cold_outreach": unittest.mock.Mock(),
            "cold_outreach.emails": unittest.mock.Mock(),
            "cold_outreach.emails.models": unittest.mock.Mock(Mailbox=mailbox_model),
            "cold_outreach.emails.sync": unittest.mock.Mock(_connect=connect),
        }
        with patch.dict(sys.modules, fake_modules):
            result = api.recipients_have_replied(["post@salong.no", "a@b.no", "c@d.no"], "jelassi@cideamarketing.com")
        self.assertEqual(connections, [1])
        self.assertEqual(result, {"post@salong.no": True, "a@b.no": False, "c@d.no": False})


class ReplyStatusBatchEndpointTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), api.IngestHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        self.env = patch.dict(os.environ, {
            api.TOKEN_ENV: "secret-test-token",
            api.REPLY_MONITOR_ENABLED_ENV: "true",
            api.REPLY_MONITOR_MAILBOX_ENV: "jelassi@cideamarketing.com",
            "OUTSEND_MAILBOX_ADDRESS": "jelassi@cideamarketing.com",
        })
        self.env.start()
        api._update_reply_monitor_state(
            status="running",
            last_check_at=datetime.now(timezone.utc).isoformat(),
            last_success_at=datetime.now(timezone.utc).isoformat(),
            last_counts={"mirrored": 0, "classified": 0, "projected": 0},
            last_error_code=None,
        )

    def tearDown(self):
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def post(self, payload):
        request = Request(
            self.base_url + api.REPLY_STATUS_PATH,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": "Bearer secret-test-token", "Content-Type": "application/json"},
            method="POST",
        )
        return urlopen(request, timeout=3)

    def test_batch_answers_per_address_without_send_capability(self):
        with patch.object(api, "recipients_have_replied", return_value={"a@b.no": True, "c@d.no": False}) as lookup:
            with self.post({"emails": ["a@b.no", "c@d.no"]}) as response:
                payload = json.loads(response.read())
        self.assertEqual(payload, {
            "replied_by_email": {"a@b.no": True, "c@d.no": False},
            "mode": "read_only_reply_check",
            "send_triggered": False,
        })
        lookup.assert_called_once_with(["a@b.no", "c@d.no"], "jelassi@cideamarketing.com")

    def test_batch_fails_closed_on_lookup_error_without_leaking_details(self):
        with patch.object(api, "recipients_have_replied", side_effect=TimeoutError("private mailbox detail")):
            with self.assertRaises(HTTPError) as caught:
                self.post({"emails": ["a@b.no"]})
        self.assertEqual(caught.exception.code, 503)
        self.assertNotIn("private", caught.exception.read().decode())

    def test_batch_rejects_invalid_or_oversized_input(self):
        with patch.object(api, "recipients_have_replied") as lookup:
            for payload in ({"emails": []}, {"emails": ["not-an-email"]}, {"emails": ["a@b.no"] * (api.REPLY_STATUS_BATCH_MAX + 1)}):
                with self.assertRaises(HTTPError) as caught:
                    self.post(payload)
                self.assertEqual(caught.exception.code, 400)
            lookup.assert_not_called()

    def test_batch_fails_closed_when_monitor_is_unhealthy(self):
        api._update_reply_monitor_state(status="degraded", last_error_code="TimeoutError")
        with patch.object(api, "recipients_have_replied") as lookup:
            with self.assertRaises(HTTPError) as caught:
                self.post({"emails": ["a@b.no"]})
        self.assertEqual(caught.exception.code, 503)
        lookup.assert_not_called()


if __name__ == "__main__":
    unittest.main()
