"""Local record-control transactions; no initialization, Hermes, or network work."""
import asyncio
from copy import deepcopy
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

from app.server import LocalChat
from app.tasks import TaskConflict, TaskError


LEETCODE = {"kind": "approved_study_context", "origin": "https://leetcode.com"}
DOCS = {"kind": "approved_study_context", "origin": "https://docs.python.org"}


class RecordTransactionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / ".tmp")
        self.path = Path(self.directory.name) / "pointer.json"
        self.chat = LocalChat(meta_path=self.path)
        self.chat.meta["session_id"] = "fixture_session"
        self.chat.save_meta()

    async def asyncTearDown(self):
        await self.chat.close()
        self.directory.cleanup()

    def record(self, observation=LEETCODE):
        now = time.time()
        self.chat.proactive.ledger.observe(observation, now)
        return self.chat.proactive.ledger.snapshot(now)["active_session"]["id"]

    async def control(self, action, session_id, request_id, revision=0, conversation_id="fixture_session"):
        return await self.chat.control_activity_records(action, session_id, request_id, revision, conversation_id)

    async def test_durable_write_failure_keeps_ledger_tasks_and_native_messages(self):
        session_id = self.record()
        before_ledger = deepcopy(self.chat.meta["activity_journal"])
        before_tasks = deepcopy(self.chat.meta["tasks"])
        self.chat.native_record = {"messages": [{"id": 1, "role": "user", "content": "private"}]}
        before_native = deepcopy(self.chat.native_record)
        with patch("app.server.write_private", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                await self.control("trash", session_id, "record_write_failure_001")
        self.assertEqual(self.chat.meta["activity_journal"], before_ledger)
        self.assertEqual(self.chat.meta["tasks"], before_tasks)
        self.assertEqual(self.chat.native_record, before_native)

    async def test_busy_pending_and_wrong_conversation_reject_without_preemption(self):
        session_id = self.record()
        calls = []
        self.chat.proactive.on_human = lambda *args: calls.append(args)
        self.chat.task = asyncio.create_task(asyncio.sleep(60))
        try:
            with self.assertRaises(TaskConflict):
                await self.control("trash", session_id, "record_busy_reject_001")
        finally:
            self.chat.task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await self.chat.task
            self.chat.task = None
        self.chat.meta["pending_publication"] = {"request_id": "pending"}
        with self.assertRaises(TaskConflict):
            await self.control("trash", session_id, "record_pending_reject_001")
        self.chat.meta["pending_publication"] = None
        with self.assertRaises(TaskConflict):
            await self.control("trash", session_id, "record_wrong_conversation_001", conversation_id="other")
        self.assertEqual(calls, [])

    async def test_invalid_and_stale_controls_do_not_preempt(self):
        session_id = self.record()
        calls = []
        self.chat.proactive.on_human = lambda *args: calls.append(args)
        self.chat.proactive.wait_for_preempted_event = AsyncMock()
        with self.assertRaises(TaskError):
            await self.control("trash", "missing", "record_invalid_reject_001")
        with self.assertRaises(TaskConflict):
            await self.control("trash", session_id, "record_stale_reject_001", revision=1)
        self.assertEqual(calls, [])
        self.chat.proactive.wait_for_preempted_event.assert_not_awaited()

    async def test_duplicate_receipt_does_not_repeat_human_epoch(self):
        session_id = self.record()
        before = self.chat.meta["accountability"]["human_epoch"]
        await self.control("trash", session_id, "record_duplicate_001")
        after_first = self.chat.meta["accountability"]["human_epoch"]
        await self.control("trash", session_id, "record_duplicate_001")
        self.assertEqual(after_first, before + 1)
        self.assertEqual(self.chat.meta["accountability"]["human_epoch"], after_first)

    async def test_replanning_keeps_sample_arriving_while_preemption_settles(self):
        session_id = self.record()
        original = deepcopy(next(item for item in self.chat.meta["activity_journal"]["sessions"] if item["id"] == session_id))

        async def settling():
            self.chat.proactive.ledger.observe(LEETCODE, time.time())

        self.chat.proactive.wait_for_preempted_event = settling
        await self.control("trash", session_id, "record_settling_sample_001")
        saved = next(item for item in self.chat.meta["activity_journal"]["sessions"] if item["id"] == session_id)
        self.assertEqual(saved["sample_count"], original["sample_count"] + 1)
        self.assertEqual(saved["end"], saved["last_seen"])

    async def test_trashed_record_cannot_stop_unrelated_active_record(self):
        first = self.record(LEETCODE)
        now = time.time()
        self.chat.proactive.ledger.observe(DOCS, now)
        second = self.chat.proactive.ledger.snapshot(now)["active_session"]["id"]
        result = await self.control("trash", first, "record_unrelated_active_001")
        self.assertEqual(result["accountability"]["observed_activity"]["active_session"]["id"], second)

    async def test_task_wrong_conversation_rejects_before_add_or_human_epoch(self):
        before = deepcopy(self.chat.meta["tasks"])
        epoch = self.chat.meta["accountability"]["human_epoch"]
        with self.assertRaises(TaskConflict):
            await self.chat.control_tasks(
                [{"op": "add", "temp_id": "new_one", "title": "Do not add", "due_text": None,
                  "target_count": None, "unit": None}],
                "task_wrong_conversation_001", 0, conversation_id="other")
        self.assertEqual(self.chat.meta["tasks"], before)
        self.assertEqual(self.chat.meta["accountability"]["human_epoch"], epoch)


if __name__ == "__main__":
    unittest.main()
