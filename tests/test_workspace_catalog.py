"""Workspace controller boundaries, with native records fully controlled in-process."""
from __future__ import annotations

import asyncio
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


CORE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CORE))

from app.chat_catalog import CatalogError, import_sessions, snapshot_catalog  # noqa: E402
from app.server import ChatError, LocalChat, MODEL, PROVIDER  # noqa: E402


class WorkspaceCatalogControllerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "pointer.json"
        self.config = patch("app.server.check_config")
        self.config.start()
        self.chat = LocalChat(meta_path=self.path)
        self.calls = []
        self.resolve_ok = True
        self.export_ok = True
        self.record = {
            "id": "native-old", "title": self.chat.meta["title"], "model": MODEL,
            "billing_provider": PROVIDER, "billing_mode": "subscription_included",
            "tool_call_count": 0, "messages": [],
        }

        async def command(arguments, **kwargs):
            self.calls.append((arguments, kwargs))
            if arguments[0] == "--resolve-title":
                title = arguments[1]
                return (0, json.dumps({"session_id": "native-old" if self.resolve_ok else None,
                                       "session_title": title if self.resolve_ok else "wrong-title"}), "")
            if arguments[:6] == ["sessions", "export", "--format", "jsonl", "--redact", "--yes"]:
                return (0 if self.export_ok else 1,
                        json.dumps(self.record) if self.export_ok else "", "")
            return 0, "", ""

        self.chat.command = command
        # Seed a started, selected conversation without calling a model.
        self.chat.meta.update(started=True, session_id="native-old", accepted_requests=["request-old"],
                              source_settings={"gmail": True}, activity_marker={"state": "paused"})
        self.chat.changed()

    async def asyncTearDown(self):
        await self.chat.close()
        self.config.stop()
        self.directory.cleanup()

    def body(self, action, **values):
        return {"action": action, "based_on_revision": snapshot_catalog(self.chat.meta)["revision"], **values}

    async def make_second_chat(self):
        first = snapshot_catalog(self.chat.meta)["active_chat_id"]
        await self.chat.control_catalog(self.body("new_chat"))
        return first, snapshot_catalog(self.chat.meta)["active_chat_id"]

    async def test_new_chat_then_switch_back_preserves_global_goals_activity_and_source_state(self):
        original_goals = deepcopy(self.chat.meta["tasks"])
        original_activity = deepcopy(self.chat.meta["accountability"])
        original_sources = deepcopy(self.chat.meta["source_settings"])
        first, second = await self.make_second_chat()
        self.assertNotEqual(first, second)
        self.assertIsNone(self.chat.meta["session_id"])
        self.assertFalse(self.chat.meta["started"])
        await self.chat.control_catalog(self.body("switch_chat", chat_id=first))
        self.assertEqual(self.chat.meta["session_id"], "native-old")
        self.assertEqual(self.chat.meta["accepted_requests"], ["request-old"])
        self.assertEqual(self.chat.meta["tasks"], original_goals)
        self.assertEqual(self.chat.meta["accountability"], original_activity)
        self.assertEqual(self.chat.meta["source_settings"], original_sources)
        self.assertTrue(any(call[0] == ["--resolve-title", self.record["title"]] and call[1].get("launcher") == "hermes-human"
                            for call in self.calls))
        self.assertTrue(any(call[0][:6] == ["sessions", "export", "--format", "jsonl", "--redact", "--yes"]
                            and call[0][6:] == ["--session-id", "native-old", "-"] for call in self.calls))

    async def test_failed_destination_read_does_not_change_current_pointer_or_visible_messages(self):
        first, second = await self.make_second_chat()
        self.chat.messages = [{"id": "keep", "role": "assistant", "text": "Current chat stays."}]
        self.resolve_ok = False
        with self.assertRaises(ChatError):
            await self.chat.control_catalog(self.body("switch_chat", chat_id=first))
        self.assertEqual(snapshot_catalog(self.chat.meta)["active_chat_id"], second)
        self.assertEqual(self.chat.messages, [{"id": "keep", "role": "assistant", "text": "Current chat stays."}])

    async def test_pending_and_busy_state_refuse_chat_switches(self):
        first, _second = await self.make_second_chat()
        self.chat.meta["pending"] = True
        with self.assertRaises(CatalogError) as pending:
            await self.chat.control_catalog(self.body("switch_chat", chat_id=first))
        self.assertEqual(pending.exception.status, 409)
        self.chat.meta["pending"] = False
        gate = asyncio.Event()
        self.chat.task = asyncio.create_task(gate.wait())
        with self.assertRaises(CatalogError) as busy:
            await self.chat.control_catalog(self.body("switch_chat", chat_id=first))
        self.assertEqual(busy.exception.status, 409)
        self.chat.task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await self.chat.task
        self.chat.task = None

    async def test_metadata_actions_do_not_read_or_change_native_conversation(self):
        first, second = await self.make_second_chat()
        self.calls.clear()
        await self.chat.control_catalog(self.body("rename_chat", chat_id=second, name="Research"))
        await self.chat.control_catalog(self.body("pin_chat", chat_id=second, pinned=True))
        await self.chat.control_catalog(self.body("create_project", name="School"))
        project = snapshot_catalog(self.chat.meta)["projects"][0]["id"]
        await self.chat.control_catalog(self.body("move_chat", chat_id=second, project_id=project))
        await self.chat.control_catalog(self.body("switch_chat", chat_id=first))
        self.calls.clear()
        await self.chat.control_catalog(self.body("archive_chat", chat_id=second, archived=True))
        self.assertEqual(self.calls, [])

    async def test_multiple_chats_require_explicit_active_chat_id_for_send(self):
        _first, second = await self.make_second_chat()
        with self.assertRaises(CatalogError) as missing:
            await self.chat.send("No network call", "request-workspace-001")
        self.assertEqual(missing.exception.status, 409)
        with self.assertRaises(CatalogError) as wrong:
            await self.chat.send("No network call", "request-workspace-002", chat_id="chat-not-active")
        self.assertEqual(wrong.exception.status, 409)
        self.assertEqual(snapshot_catalog(self.chat.meta)["active_chat_id"], second)


class SessionImportTests(unittest.TestCase):
    def test_read_only_session_listing_filters_titles_and_exposes_no_messages(self):
        class SessionDB:
            opened = []
            def __init__(self, *, read_only):
                self.read_only = read_only
                self.closed = False
                SessionDB.opened.append(self)
            def list_sessions_rich(self, **kwargs):
                self.kwargs = kwargs
                return [
                    {"id": "good", "title": "eilo-ui-" + "a" * 32, "started_at": 1, "last_active": 2, "message_count": 3, "messages": ["must-not-cross"]},
                    {"id": "other", "title": "ordinary-chat", "started_at": 1, "last_active": 2, "message_count": 99},
                ]
            def close(self): self.closed = True

        module = types.ModuleType("hermes_state")
        module.SessionDB = SessionDB
        prior = sys.modules.get("hermes_state")
        sys.modules["hermes_state"] = module
        try:
            from app.human_driver import list_eilo_sessions
            result = list_eilo_sessions()
        finally:
            if prior is None:
                sys.modules.pop("hermes_state", None)
            else:
                sys.modules["hermes_state"] = prior
        self.assertEqual(result["sessions"][0]["id"], "good")
        self.assertEqual(len(result["sessions"]), 1)
        self.assertNotIn("messages", result["sessions"][0])
        self.assertTrue(SessionDB.opened[0].read_only)
        self.assertTrue(SessionDB.opened[0].closed)
        self.assertEqual(SessionDB.opened[0].kwargs["source"], "cli")

    def test_import_rows_never_replaces_current_or_copies_messages(self):
        meta = LocalChat.fresh_meta()
        meta["tasks"]["tasks"] = [{"id": "task", "title": "Preserve"}]
        imported = import_sessions(meta, [{"id": "old", "title": "eilo-ui-" + "c" * 32,
                                           "created_at": "2026-09-01T00:00:00Z", "updated_at": "2026-09-02T00:00:00Z",
                                           "message_count": 7}])
        self.assertEqual(imported["tasks"]["tasks"][0]["title"], "Preserve")
        self.assertEqual(snapshot_catalog(imported)["active_chat_id"], snapshot_catalog(meta)["active_chat_id"])
        older = [row for row in imported["chat_catalog"]["chats"] if row["conversation"]["session_id"] == "old"][0]
        self.assertNotIn("messages", older)


if __name__ == "__main__":
    unittest.main()
