import asyncio
import hashlib
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from unittest import mock

from aiohttp import web
from multidict import MultiDict

from app.google_calendar import CalendarError
from app.google_mail import GoogleMail, MAIL_SCOPE, SCOPES, TOKEN_URL


CLIENT_ID = "1234-local_test.apps.googleusercontent.com"


class TestStore:
    def __init__(self, value=None):
        self.available = True
        self.value = value
        self.writes = []
        self.deletes = 0

    async def read(self):
        return self.value

    async def write(self, value):
        self.writes.append(value)
        self.value = value

    async def delete(self):
        self.deletes += 1
        self.value = None


class TestStores:
    def __init__(self):
        self.values = {}

    def __call__(self, identity):
        return self.values.setdefault(identity, TestStore())


class CalendarDouble:
    def __init__(self):
        self.data = {"state": "connected", "selected_ids": ["selected"], "account": {"sub": "calendar-sub", "email": "calendar@example.com"}}

    def config(self):
        return {"client_id": CLIENT_ID}


class RequestDouble:
    def __init__(self, host, query):
        self.host = host
        self.query = MultiDict(query)


class _SocketDouble:
    def getsockname(self):
        return ("127.0.0.1", 49152)


class LocalSiteDouble:
    """Avoid binding a TCP port while preserving the runner address used in OAuth."""
    def __init__(self, runner, host, port):
        self._server = type("Server", (), {"sockets": [_SocketDouble()]})()
        runner._reg_site(self)

    async def start(self):
        return None

    async def stop(self):
        return None


class GoogleMailTests(unittest.TestCase):
    def run_async(self, coroutine):
        return asyncio.run(coroutine)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.stores = TestStores()
        self.calendar = CalendarDouble()
        self.calls = []
        self.site_patch = mock.patch("app.google_mail.web.TCPSite", LocalSiteDouble)
        self.site_patch.start()

        async def transport(method, url, **kwargs):
            self.calls.append((method, url, kwargs))
            raise AssertionError("this test must not contact a provider")

        self.mail = GoogleMail(self.root, self.calendar, store_factory=self.stores, transport=transport)

    def tearDown(self):
        self.run_async(self.mail.close())
        self.site_patch.stop()
        self.tmp.cleanup()

    def body(self, action, **values):
        return {"action": action, "based_on_revision": self.mail.data["revision"], **values}

    def test_no_model_consent_means_no_connection_and_calendar_is_not_silently_enabled(self):
        with self.assertRaisesRegex(CalendarError, "Allow relevant email excerpts"):
            self.run_async(self.mail.control(self.body("connect_gmail", allow_model=False)))
        self.assertIsNone(self.mail.flow)
        self.assertEqual(self.stores.values, {})
        self.assertFalse(self.mail.calendar_enabled())
        self.assertIsNone(self.mail.data["calendar_sub"])

    def test_revision_conflict_is_rejected_before_any_source_change(self):
        stale = {"action": "connect_gmail", "based_on_revision": 99, "allow_model": True}
        with self.assertRaises(CalendarError) as caught:
            self.run_async(self.mail.control(stale))
        self.assertEqual(caught.exception.code, "conflict")
        self.assertIsNone(self.mail.flow)
        self.assertEqual(self.mail.data["revision"], 0)

    def test_calendar_model_consent_requires_its_own_explicit_control(self):
        self.assertFalse(self.mail.calendar_enabled())
        result = self.run_async(self.mail.control(self.body("set_calendar_enabled", enabled=True)))
        self.assertTrue(result["calendar"]["enabled"])
        self.assertEqual(self.mail.data["calendar_sub"], "calendar-sub")
        result = self.run_async(self.mail.control(self.body("set_calendar_enabled", enabled=False)))
        self.assertFalse(result["calendar"]["enabled"])
        self.assertIsNone(self.mail.data["calendar_sub"])

    def test_gmail_oauth_has_only_mail_scope_state_and_s256_pkce(self):
        result = self.run_async(self.mail.control(self.body("connect_gmail", allow_model=True)))
        flow = self.mail.flow
        query = parse_qs(urlsplit(result["authorization_url"]).query)
        self.assertEqual(set(query["scope"][0].split()), set(SCOPES))
        self.assertEqual(set(SCOPES), {"openid", "email", MAIL_SCOPE})
        self.assertFalse(any("calendar" in scope for scope in query["scope"][0].split()))
        self.assertEqual(query["state"], [flow["state"]])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        expected = hashlib.sha256(flow["verifier"].encode()).digest()
        self.assertEqual(query["code_challenge"], [__import__("base64").urlsafe_b64encode(expected).decode().rstrip("=")])

    def test_denied_or_mismatched_callback_never_writes_keychain(self):
        self.run_async(self.mail.control(self.body("connect_gmail", allow_model=True)))
        flow = self.mail.flow
        denied = RequestDouble(flow["host"], [("state", flow["state"]), ("error", "access_denied")])
        with self.assertRaises(web.HTTPSeeOther):
            self.run_async(self.mail.callback(denied))
        self.assertEqual(sum(len(store.writes) for store in self.stores.values.values()), 0)
        self.run_async(self.mail.end_flow())
        self.run_async(self.mail.control(self.body("connect_gmail", allow_model=True)))
        flow = self.mail.flow
        response = self.run_async(self.mail.callback(RequestDouble(flow["host"], [("state", "wrong"), ("code", "x")])))
        self.assertEqual(response.status, 400)
        self.assertEqual(sum(len(store.writes) for store in self.stores.values.values()), 0)

    def test_local_remove_deletes_only_mail_credentials_without_calendar_mutation_or_revocation(self):
        identity = "mail_" + "a" * 24
        self.mail.data["accounts"] = [{"id": identity, "sub": "mail-sub", "email": "mail@example.com", "enabled": True, "state": "connected"}]
        self.stores(identity).value = {"saved": "mail-token"}
        calendar_before = dict(self.calendar.data)
        self.run_async(self.mail.control(self.body("remove_gmail", account_id=identity)))
        self.assertEqual(self.stores(identity).deletes, 1)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.calendar.data, calendar_before)
        self.assertEqual(self.mail.data["accounts"], [])

    def test_disabled_source_blocks_reads_and_disable_during_refresh_prevents_keychain_write(self):
        identity = "mail_" + "b" * 24
        self.mail.data["accounts"] = [{"id": identity, "sub": "mail-sub", "email": "mail@example.com", "enabled": True, "state": "connected"}]
        self.stores(identity).value = {"access_token": "old", "refresh_token": "refresh", "expires_at": 1,
                                      "client_id": CLIENT_ID, "sub": "mail-sub", "scopes": list(SCOPES)}
        started, release = asyncio.Event(), asyncio.Event()

        async def delayed_transport(method, url, **kwargs):
            self.calls.append((method, url, kwargs))
            if method == "POST" and url == TOKEN_URL:
                started.set()
                await release.wait()
                return {"access_token": "new", "expires_in": 3600, "token_type": "Bearer"}
            raise AssertionError("the disabled request must not reach Gmail")

        self.mail.transport = delayed_transport

        async def scenario():
            reading = asyncio.create_task(self.mail.get(identity, "https://gmail.googleapis.com/gmail/v1/users/me/threads"))
            await started.wait()
            await self.mail.control(self.body("set_mail_enabled", account_id=identity, enabled=False))
            release.set()
            with self.assertRaises(CalendarError) as caught:
                await reading
            self.assertEqual(caught.exception.code, "not_enabled")

        self.run_async(scenario())
        self.assertEqual(self.stores(identity).writes, [])
        self.assertFalse(self.mail.account(identity)["enabled"])
        with self.assertRaises(CalendarError) as caught:
            self.run_async(self.mail.get(identity, "https://gmail.googleapis.com/gmail/v1/users/me/threads"))
        self.assertEqual(caught.exception.code, "not_enabled")


if __name__ == "__main__":
    unittest.main()
