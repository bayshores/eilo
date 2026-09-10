import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.briefing import Briefing, MAX_CALLS, MAX_CONTEXT, MAX_THREADS, SourceTurn
from app.context_tools import ReadTools, validate_bridge


class FakeMail:
    def __init__(self):
        self.permission = "enabled"
        self.accounts = [{"id": "mail_" + "a" * 24, "email": "mail@example.com", "sub": "mail-sub", "enabled": True, "state": "connected"}]
        self.checked_ids = []
        self.get_calls = []
        self.calendar_ok = False

    def permission_stamp(self):
        return self.permission

    def snapshot(self):
        return {"accounts": [{key: value for key, value in account.items() if key != "sub"} for account in self.accounts],
                "calendar": {"available": True, "enabled": self.calendar_ok, "selected_count": 1, "account_label": "calendar@example.com"}}

    def account(self, identity):
        return next((account for account in self.accounts if account["id"] == identity), None)

    async def checked(self, identity):
        self.checked_ids.append(identity)

    async def get(self, identity, url, params=None):
        self.get_calls.append((identity, url, params))
        return {}

    def calendar_enabled(self):
        return self.calendar_ok


class FakeCalendar:
    def __init__(self):
        self.data = {"selected_ids": ["cal"], "calendars": [{"id": "cal", "name": "Calendar"}]}

    async def _get(self, url, params=None):
        return {}


class FakeChat:
    def __init__(self):
        self.calendar = FakeCalendar()
        self.meta = {}
        self.saved = []
        self.change_count = 0
        self.busy = False
        self.task = None
        self.reply_stream = {"active": True}

    def save_meta(self):
        self.saved.append(json.loads(json.dumps(self.meta)))

    def changed(self):
        self.change_count += 1


class FakeOwner:
    def __init__(self):
        self.chat = FakeChat()
        self.mail = FakeMail()
        self.current = None


class _SocketDouble:
    def getsockname(self):
        return ("127.0.0.1", 49153)


class LocalSiteDouble:
    def __init__(self, runner, host, port):
        self._server = type("Server", (), {"sockets": [_SocketDouble()]})()
        runner._reg_site(self)

    async def start(self):
        return None

    async def stop(self):
        return None


class BriefingTests(unittest.TestCase):
    def run_async(self, coroutine):
        return asyncio.run(coroutine)

    def setUp(self):
        self.owner = FakeOwner()
        self.turn = SourceTurn(self.owner, "request-1")
        self.owner.current = self.turn
        self.account = self.owner.mail.accounts[0]["id"]

    def tearDown(self):
        self.run_async(self.turn.close())

    def test_undiscovered_thread_id_is_blocked_without_provider_read(self):
        result = self.run_async(self.turn.read("eilo_read_mail", {"account_id": self.account, "thread_id": "not-discovered"}))
        self.assertEqual(result["receipt"]["status"], "unavailable")
        self.assertIsNone(result["data"])
        self.assertEqual(self.owner.mail.get_calls, [])
        self.assertEqual(self.turn.run["steps"][0]["status"], "failed")

    def test_search_window_and_read_budgets_are_bounded(self):
        searches = []

        async def fake_search(request, query, *, max_threads, page_token=None):
            searches.append((query, max_threads))
            return {"thread_ids": ["t"], "nextPageToken": None, "has_more": False}

        with mock.patch("app.briefing.search_threads", fake_search):
            result = self.run_async(self.turn.read("eilo_search_mail", {"account_id": self.account, "days": 90, "query": "deadline"}))
        self.assertEqual(result["receipt"]["status"], "ok")
        self.assertIn("after:", searches[0][0])
        self.assertIn("-in:spam -in:trash", searches[0][0])
        self.assertEqual(searches[0][1], 30)
        with self.assertRaises(Exception):
            self.run_async(self.turn.read("eilo_search_mail", {"account_id": self.account, "days": 91}))

        self.turn.discovered[self.account] = {f"t{index}" for index in range(MAX_THREADS + 1)}
        async def fake_thread(request, thread_id, *, max_messages, max_chars):
            return {"id": thread_id, "messages": [], "truncated": False}
        with mock.patch("app.briefing.read_thread", fake_thread):
            for index in range(MAX_THREADS):
                self.assertEqual(self.run_async(self.turn.read("eilo_read_mail", {"account_id": self.account, "thread_id": f"t{index}"}))["receipt"]["status"], "ok")
            limited = self.run_async(self.turn.read("eilo_read_mail", {"account_id": self.account, "thread_id": f"t{MAX_THREADS}"}))
        self.assertEqual(limited["receipt"]["status"], "unavailable")
        self.assertEqual(self.turn.thread_reads, MAX_THREADS)

    def test_call_and_context_budgets_and_whole_thread_excerpt_limit(self):
        for _ in range(MAX_CALLS):
            self.run_async(self.turn.read("eilo_sources", {}))
        with self.assertRaisesRegex(Exception, "limit"):
            self.run_async(self.turn.read("eilo_sources", {}))

        another = SourceTurn(self.owner, "request-2")
        accepted = another.pack({"value": "x" * (MAX_CONTEXT - 100)}, "large")
        self.assertEqual(accepted["receipt"]["status"], "ok")
        limited = another.pack({"value": "x" * 200}, "overflow")
        self.assertEqual(limited["receipt"]["status"], "limited")
        self.assertIsNone(limited["data"])

        per_thread = SourceTurn(self.owner, "request-3")
        per_thread.discovered[self.account] = {"thread"}
        async def long_thread(request, thread_id, *, max_messages, max_chars):
            self.assertEqual((max_messages, max_chars), (8, 6000))
            return {"id": thread_id, "messages": [
                {"id": "old", "thread_id": thread_id, "excerpt": "a" * 5000, "truncated": False},
                {"id": "new", "thread_id": thread_id, "excerpt": "b" * 5000, "truncated": False},
            ], "truncated": False}
        with mock.patch("app.briefing.read_thread", long_thread):
            read = self.run_async(per_thread.read("eilo_read_mail", {"account_id": self.account, "thread_id": "thread"}))
        excerpts = [message["excerpt"] for message in read["data"]["messages"]]
        self.assertEqual(sum(map(len, excerpts)), 6500)
        self.assertTrue(read["data"]["truncated"])
        self.assertTrue(read["data"]["messages"][0]["truncated"])

    def test_permission_change_invalidates_turn_and_prevents_returning_fetched_data(self):
        async def revoked_search(request, query, *, max_threads, page_token=None):
            self.owner.mail.permission = "disabled"
            return {"thread_ids": ["private"], "nextPageToken": None, "has_more": False}
        with mock.patch("app.briefing.search_threads", revoked_search):
            result = self.run_async(self.turn.read("eilo_search_mail", {"account_id": self.account}))
        self.assertEqual(result["receipt"]["status"], "unavailable")
        self.assertIsNone(result["data"])
        self.assertTrue(self.turn.had_gaps)

        self.turn.touched = True
        self.owner.mail.permission = "still-disabled"
        Briefing.sources_changed(self.owner)
        self.assertTrue(self.turn.invalidated)
        self.assertIsNone(self.owner.chat.reply_stream)

    def test_workflow_reports_real_failure_and_never_persists_raw_mail(self):
        raw = "PRIVATE EMAIL BODY " * 100
        self.turn.discovered[self.account] = {"t"}
        async def successful_thread(request, thread_id, *, max_messages, max_chars):
            return {"id": thread_id, "messages": [{"id": "m", "thread_id": thread_id, "excerpt": raw, "truncated": False}], "truncated": False}
        with mock.patch("app.briefing.read_thread", successful_thread):
            result = self.run_async(self.turn.read("eilo_read_mail", {"account_id": self.account, "thread_id": "t"}))
        self.assertEqual(result["receipt"]["status"], "ok")
        snapshot = self.owner.chat.meta["workflow_run"]
        self.assertNotIn(raw, json.dumps(snapshot))
        self.assertEqual(snapshot["steps"][-1]["status"], "completed")

        failed = SourceTurn(self.owner, "request-failed")
        async def unavailable(*args, **kwargs):
            raise RuntimeError("transport")
        with mock.patch("app.briefing.search_threads", unavailable):
            failed_result = self.run_async(failed.read("eilo_search_mail", {"account_id": self.account}))
        self.assertEqual(failed_result["receipt"]["status"], "unavailable")
        failed.finish()
        self.assertEqual(failed.run["status"], "partial")
        self.assertEqual(failed.run["steps"][0]["status"], "failed")


class ContextToolsTests(unittest.TestCase):
    def test_bridge_rejects_non_loopback_and_per_instance_keeps_raw_data_ephemeral(self):
        for capability in (
            {"url": "http://localhost:8123/read", "token": "a" * 43},
            {"url": "https://127.0.0.1:8123/read", "token": "a" * 43},
            {"url": "http://127.0.0.1:8123/other", "token": "a" * 43},
        ):
            with self.assertRaises(ValueError):
                validate_bridge(capability)

        capability = {"url": "http://127.0.0.1:8123/read", "token": "a" * 43}
        tools = ReadTools(capability, "Base policy. ")
        raw_excerpt = "secret excerpt from an email"

        class Response:
            def read(self, limit):
                return json.dumps({"receipt": {"status": "ok", "source_id": "S1", "detail": "Email thread read"}, "data": {"excerpt": raw_excerpt}}).encode()
            def __enter__(self): return self
            def __exit__(self, *args): return False
        class Opener:
            def open(self, request, timeout): return Response()
        class Agent:
            def __init__(self):
                self.ephemeral_system_prompt = "before"
                self._dump_api_request_debug = lambda *args: "unchanged-other"
        agent, other = Agent(), Agent()
        with mock.patch("app.context_tools.urllib.request.build_opener", return_value=Opener()):
            tools.attach(agent)
            receipt = json.loads(tools.handler("eilo_read_mail", {"account_id": "x", "thread_id": "y"}))
        self.assertEqual(receipt, {"status": "ok", "source_id": "S1", "detail": "Email thread read"})
        self.assertNotIn(raw_excerpt, json.dumps(receipt))
        self.assertIn(raw_excerpt, agent.ephemeral_system_prompt)
        self.assertEqual(other._dump_api_request_debug(), "unchanged-other")
        self.assertIsNone(agent._dump_api_request_debug())
        tools.close()
        self.assertEqual(tools.sources, {})
        self.assertNotIn(raw_excerpt, agent.ephemeral_system_prompt)


if __name__ == "__main__":
    unittest.main()
