"""Synthetic service tests for manual chat compaction."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.chat_catalog import CatalogError
from app.chat_service import LocalChat
from app.runtime_contract import MODEL, PROVIDER


class ChatCompactionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(
            dir=Path(__file__).resolve().parents[1] / ".tmp"  # noqa: ASYNC240
        )
        self.path = Path(self.directory.name) / "pointer.json"
        self.config_patch = patch("app.chat_service.check_config")
        self.config_patch.start()
        self.chat = LocalChat(meta_path=self.path)
        self.chat.meta.update(started=True, session_id="session-one")
        self.chat.save_meta()
        self.session_id = "session-one"
        self.result_status = "compressed"
        self.compress_calls = 0
        self.compress_started = asyncio.Event()
        self.release = asyncio.Event()

        async def command(arguments, **kwargs):
            if arguments[0] == "--compress-chat":
                self.compress_calls += 1
                self.compress_started.set()
                await self.release.wait()
                return (
                    0,
                    json.dumps({"session_id": self.session_id, "status": self.result_status}),
                    "",
                )
            if arguments[0] == "--read-chat":
                return 0, json.dumps(self.record()), ""
            raise AssertionError(arguments)

        self.chat.command = command

    async def asyncTearDown(self):
        await self.chat.close()
        self.config_patch.stop()
        self.directory.cleanup()

    def record(self):
        return {
            "id": self.session_id,
            "title": self.chat.meta["title"],
            "model": MODEL,
            "billing_provider": PROVIDER,
            "billing_mode": "subscription_included",
            "tool_call_count": 0,
            "messages": [],
            "chat_context": {"can_compress": True},
        }

    def body(self, **changes):
        return {
            "action": "compress",
            "request_id": "context_request_001",
            "conversation_id": self.chat.meta["session_id"],
            "based_on_revision": self.chat.revision,
            **changes,
        }

    async def finish(self):
        self.release.set()
        await self.chat.task

    async def test_rejects_unknown_fields_stale_revision_and_wrong_chat(self):
        invalid_cases = [
            self.body(extra=True),
            self.body(based_on_revision="stale"),
            self.body(conversation_id="other-chat"),
        ]
        for body in invalid_cases:
            with self.subTest(body=body), self.assertRaises(CatalogError):
                await self.chat.compress_context(body)
        self.assertEqual(self.compress_calls, 0)

    async def test_duplicate_request_does_not_launch_again_while_busy(self):
        accepted = await self.chat.compress_context(self.body())
        self.assertEqual(accepted["chat_context"]["status"], "compressing")
        await self.compress_started.wait()

        duplicate = await self.chat.compress_context(self.body())
        self.assertEqual(duplicate["chat_context"]["status"], "compressing")
        self.assertEqual(self.compress_calls, 1)

        await self.finish()
        self.assertEqual(self.chat.snapshot()["chat_context"]["status"], "compressed")

    async def test_rejects_busy_pending_and_publication(self):
        self.chat.task = asyncio.create_task(asyncio.sleep(10))
        with self.assertRaises(CatalogError):
            await self.chat.compress_context(self.body())
        self.chat.task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await self.chat.task
        self.chat.task = None

        for key in ("pending", "pending_turn", "pending_publication"):
            self.chat.meta[key] = {"receipt": key} if key != "pending" else True
            with self.subTest(key=key), self.assertRaises(CatalogError):
                await self.chat.compress_context(self.body())
            self.chat.meta[key] = None if key != "pending" else False

    async def test_success_refreshes_rotated_session_and_records_noop_or_failed_status(self):
        self.session_id = "session-two"
        original_request = self.body()
        await self.chat.compress_context(original_request)
        await self.finish()
        self.assertEqual(self.chat.meta["session_id"], "session-two")
        await self.chat.compress_context(original_request)
        self.assertEqual(self.compress_calls, 1)
        self.assertEqual(self.chat.snapshot()["chat_context"]["status"], "compressed")

        for status in ("unchanged", "failed"):
            self.result_status = status
            self.release = asyncio.Event()
            await self.chat.compress_context(self.body(request_id="context_request_" + status))
            await self.finish()
            self.assertEqual(self.chat.snapshot()["chat_context"]["status"], status)

    async def test_running_receipt_becomes_interrupted_on_initialize_without_replay(self):
        self.chat.meta["context_compaction"] = {
            "request_id": "context_request_001",
            "status": "compressing",
            "source": "manual",
        }
        self.chat.meta["started"] = False
        self.chat.save_meta()
        await self.chat.close()

        restored = LocalChat(meta_path=self.path)
        calls = []

        async def command(arguments, **kwargs):
            calls.append(arguments)
            return 0, "", ""

        restored.command = command
        try:
            await restored.initialize()
            self.assertEqual(restored.meta["context_compaction"]["status"], "interrupted")
            self.assertFalse(any(arguments[0] == "--compress-chat" for arguments in calls))
        finally:
            await restored.close()
