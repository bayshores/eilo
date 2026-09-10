"""Request-lifecycle regressions without model calls or access to the user's session."""
import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.server import ChatError, LocalChat, MODEL, PROVIDER


class PendingRequestTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / ".tmp")
        self.path = Path(self.directory.name) / "pointer.json"
        self.config_patch = patch("app.server.check_config")
        self.config_patch.start()
        self.chat = LocalChat(meta_path=self.path)
        self.release = asyncio.Event()
        self.native_calls = 0
        self.records = []
        self.return_code = 0
        self.request = None
        self.command_calls = []

        async def command(arguments, **kwargs):
            self.command_calls.append((arguments, kwargs))
            if arguments[0] == "--resolve-title":
                return 0, json.dumps({"session_id": "fixture_session" if self.records else None,
                                      "session_title": arguments[1]}), ""
            if arguments[0] == "--input":
                self.request_started.set()
                self.native_calls += 1
                self.request = json.loads(Path(arguments[1]).read_text())
                await self.release.wait()
                if self.return_code:
                    return self.return_code, "", ""
                for row in self.records[0]["messages"]:
                    row.setdefault("display_metadata", {})["request_id"] = self.request["request_id"]
                assistant_id = self.records[0]["messages"][-1]["id"]
                return 0, json.dumps({"session_id": "fixture_session", "request_id": self.request["request_id"],
                                      "assistant_id": assistant_id, "user_id": self.records[0]["messages"][-2]["id"],
                                      "proposal": {"request_id": self.request["request_id"], "based_on_revision": 0,
                                                   "kind": "chat", "reply": self.records[0]["messages"][-1]["content"],
                                                   "operations": []},
                                      "audit": {"model": MODEL, "provider": PROVIDER, "tool_schema_count": 4}}), ""
            if arguments[0] == "--finalize":
                publication = json.loads(Path(arguments[1]).read_text())
                assistant = self.records[0]["messages"][-1]
                assistant["display_metadata"].update({"published": True, "public_reply": publication["public_reply"],
                                                        "disposition": publication["disposition"]})
                return 0, json.dumps({"session_id": publication["session_id"], "request_id": publication["request_id"],
                                      "assistant_id": publication["assistant_id"], "published": True}), ""
            return 0, "\n".join(json.dumps(record) for record in self.records), ""

        self.request_started = asyncio.Event()
        self.chat.command = command

    async def asyncTearDown(self):
        await self.chat.close()
        self.config_patch.stop()
        self.directory.cleanup()

    def native_record(self, messages):
        return {"id": "fixture_session", "title": self.chat.meta["title"], "model": MODEL,
                "billing_provider": PROVIDER, "billing_mode": "subscription_included",
                "tool_call_count": 0, "messages": messages}

    async def finish(self, messages):
        converted = [dict(message) for message in messages]
        user, assistant = converted[-2:]
        user["display_metadata"] = {"lane": "eilo_human", "request_id": self.request["request_id"] if self.request else "pending"}
        assistant["display_kind"] = "eilo_human_proposal"
        assistant["display_metadata"] = {"request_id": self.request["request_id"] if self.request else "pending", "assistant_id": assistant["id"]}
        self.records = [self.native_record(converted)]
        self.release.set()
        await self.chat.task

    async def test_accepted_message_visible_before_native_work_and_after_reload(self):
        state = await self.chat.send("Benign pending test", "request_pending_001")
        self.assertEqual(state["status"], "busy")
        self.assertEqual(state["messages"], [])
        self.assertEqual(state["pending_message"], {
            "request_id": "request_pending_001", "text": "Benign pending test", "status": "accepted"})
        self.assertEqual(self.native_calls, 0)
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved["pending_message"]["text"], "Benign pending test")
        # A page reload reads the same service snapshot; no prompt is replayed.
        self.assertEqual(self.chat.snapshot()["pending_message"], state["pending_message"])
        self.assertEqual((await self.chat.send("Benign pending test", "request_pending_001"))["pending_message"], state["pending_message"])
        await self.finish([{"id": 1, "role": "user", "content": "Benign pending test"},
                           {"id": 2, "role": "assistant", "content": "Received."}])
        state = self.chat.snapshot()
        self.assertEqual(state["status"], "ready")
        self.assertIsNone(state["pending_message"])
        self.assertEqual([m["role"] for m in state["messages"]], ["user", "assistant"])
        self.assertIsNone(json.loads(self.path.read_text())["pending_message"])
        await self.chat.send("Benign pending test", "request_pending_001")
        self.assertEqual(self.native_calls, 1)

    async def test_repeated_text_reconciles_only_after_the_native_anchor(self):
        self.chat.messages = [{"id": "1", "role": "user", "text": "Repeated text"},
                              {"id": "2", "role": "assistant", "text": "Earlier reply"}]
        await self.chat.send("Repeated text", "request_repeated_001")
        self.chat.reconcile_pending()
        self.assertIsNotNone(self.chat.meta["pending_message"])
        await self.finish([{"id": 1, "role": "user", "content": "Repeated text"},
                           {"id": 2, "role": "assistant", "content": "Earlier reply"},
                           {"id": 3, "role": "user", "content": "Repeated text"},
                           {"id": 4, "role": "assistant", "content": "New reply"}])
        self.assertIsNone(self.chat.meta["pending_message"])
        self.assertEqual(len(self.chat.messages), 4)

    async def test_failure_before_acceptance_does_not_create_pending_or_native_call(self):
        before = self.path.read_bytes()
        with patch("app.server.check_config", side_effect=ChatError("Fixture configuration rejection")):
            with self.assertRaises(ChatError):
                await self.chat.send("Keep this draft", "request_rejected_001")
        self.assertEqual(self.path.read_bytes(), before)
        self.assertIsNone(self.chat.snapshot()["pending_message"])
        self.assertEqual(self.native_calls, 0)

    async def test_failed_native_reply_retains_accurately_labeled_display_receipt(self):
        self.return_code = 1
        await self.chat.send("Accepted but not saved", "request_failed_001")
        self.release.set()
        await self.chat.task
        state = self.chat.snapshot()
        self.assertEqual(state["status"], "error")
        self.assertTrue(state["can_send"])
        self.assertEqual(state["pending_message"]["status"], "failed")
        self.assertEqual(state["messages"], [])
        self.assertEqual(self.native_calls, 1)

    async def test_failed_first_turn_resolves_title_and_recovers_saved_user_without_replay(self):
        self.return_code = 1
        self.records = [self.native_record([
            {"id": 1, "role": "user", "content": "Keep this first message",
             "display_metadata": {"lane": "eilo_human", "request_id": "request_first_turn_001"}},
        ])]
        await self.chat.send("Keep this first message", "request_first_turn_001")
        self.release.set()
        await self.chat.task
        self.assertEqual(self.chat.meta["session_id"], "fixture_session")
        self.assertEqual(self.chat.messages, [{"id": "1", "role": "user", "text": "Keep this first message"}])
        self.assertEqual(self.native_calls, 1)
        self.assertTrue(any(call[0] == ["--resolve-title", self.chat.meta["title"]]
                            and call[1].get("launcher") == "hermes-human" for call in self.command_calls))
        self.assertTrue(any(call[0][:6] == ["sessions", "export", "--format", "jsonl", "--redact", "--yes"]
                            and call[0][6:8] == ["--session-id", "fixture_session"] for call in self.command_calls))

    async def test_interrupted_restart_retains_pending_receipt_without_replay(self):
        await self.chat.send("Interrupted fixture", "request_interrupted_001")
        await asyncio.wait_for(self.request_started.wait(), 2)
        await self.chat.close()
        restored = LocalChat(meta_path=self.path)
        restored.command = self.chat.command
        await restored.initialize()
        state = restored.snapshot()
        self.assertEqual(state["pending_message"]["status"], "interrupted")
        self.assertEqual(state["status"], "error")
        self.assertTrue(state["can_send"])
        self.assertEqual(self.native_calls, 1)
        await restored.close()

    async def test_source_cancel_stops_work_without_changing_tasks_or_replaying(self):
        before = json.dumps(self.chat.meta['tasks'], sort_keys=True)
        await self.chat.send('Check the fictional inbox', 'request_cancel_tools_001')
        await asyncio.wait_for(self.request_started.wait(), 2)
        turn = self.chat.briefing.current
        turn.touched = True
        turn.step('read', 'Read relevant emails', 'running')
        state = await self.chat.briefing.cancel('request_cancel_tools_001')
        self.assertEqual(state['workflow_run']['status'], 'cancelled')
        self.assertFalse(state['workflow_run']['can_cancel'])
        self.assertIsNone(self.chat.meta['pending_turn'])
        self.assertIsNone(self.chat.briefing.current)
        self.assertEqual(json.dumps(self.chat.meta['tasks'], sort_keys=True), before)
        self.assertEqual(self.native_calls, 1)

    async def test_cancel_cannot_target_a_different_request(self):
        from app.google_calendar import CalendarError
        await self.chat.send('Check the fictional inbox', 'request_cancel_tools_002')
        await asyncio.wait_for(self.request_started.wait(), 2)
        with self.assertRaises(CalendarError):
            await self.chat.briefing.cancel('wrong_request')
        self.assertTrue(self.chat.busy)

    async def test_long_poll_wakes_for_acceptance_and_native_completion(self):
        waiting = asyncio.create_task(self.chat.wait_for_state(self.chat.revision))
        await asyncio.sleep(0)
        accepted = await self.chat.send("Wake the display", "request_wakeup_001")
        update = await asyncio.wait_for(waiting, 1)
        self.assertEqual(update["revision"], accepted["revision"])
        self.assertEqual(update["pending_message"]["text"], "Wake the display")
        waiting = asyncio.create_task(self.chat.wait_for_state(accepted["revision"]))
        await asyncio.sleep(0)
        await self.finish([{"id": 1, "role": "user", "content": "Wake the display"},
                           {"id": 2, "role": "assistant", "content": "Received."}])
        update = await asyncio.wait_for(waiting, 1)
        self.assertNotEqual(update["revision"], accepted["revision"])
        self.assertEqual(update["status"], "ready")
        self.assertIsNone(update["pending_message"])


if __name__ == "__main__":
    unittest.main()
