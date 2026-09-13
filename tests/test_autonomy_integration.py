"""In-memory seams for observed activity, associations, and check-in streaming."""

from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from app.accountability import initial_state
from app.chat_service import LocalChat
from app.proactive import ProactiveLoop
from app.tasks import apply_operations, initial_tasks, public_state

APPROVED = {"kind": "approved_study_context", "origin": "https://leetcode.com", "title": "private"}
OTHER = {"kind": "approved_study_context", "origin": "https://docs.python.org", "title": "private"}


class Chat:
    def __init__(self, directory, now):
        self.meta_path = Path(directory) / "meta.json"
        self.meta = {
            "session_id": "fixture-session",
            "accountability": initial_state(),
            "tasks": initial_tasks(),
        }
        self.meta["tasks"], _ = apply_operations(
            self.meta["tasks"],
            [
                {
                    "op": "add",
                    "temp_id": "new_one",
                    "title": "Practice",
                    "due_text": None,
                    "target_count": None,
                    "unit": None,
                }
            ],
            based_on_revision=0,
            request_id="seed",
            source={"kind": "human"},
            now=1,
            id_factory=lambda: "task-one",
        )
        self.native_lock, self.blocked, self.busy, self.now = asyncio.Lock(), False, False, now
        self.reply, self.changed_states, self.refresh_count, self.emit_preview = None, [], 0, False

    def save_meta(self):
        self.meta_path.write_text(json.dumps(self.meta))

    def changed(self):
        self.changed_states.append(None)

    async def refresh(self):
        self.refresh_count += 1

    def publish_check_in(self, publication, *, lookup=False):
        return {"event_id": publication["event_id"], "assistant_id": None if lookup else 4}

    async def command(self, args, **kwargs):
        callback = kwargs.get("on_preview")
        if args[0] == "--input" and callback and self.emit_preview:
            callback("Writing")
        path = Path(args[1])
        packet = json.loads(await asyncio.to_thread(path.read_text))
        event_id = path.stem.removeprefix("event-")
        return (
            0,
            json.dumps(
                {
                    "audit": {
                        "model": "gpt-5.6-luna",
                        "provider": "openai-codex",
                        "tool_schema_count": 0,
                        "persisted": False,
                    },
                    "assistant_id": None,
                    "provenance": {
                        "version": 1,
                        "task_revision": packet["task_state"]["revision"],
                        "sources": [
                            {"source": "conversation", "status": "used"},
                            {"source": "goals", "status": "used"},
                            {"source": "activity", "status": "used"},
                        ],
                    },
                    "decision": self.reply
                    or {"event_id": event_id, "decision": "quiet", "message": ""},
                }
            ),
            "",
        )


class AutonomyIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.clock = [1000.0]
        self.helper = Path(self.directory.name) / "helper"
        self.helper.touch()
        self.chat = Chat(self.directory.name, lambda: self.clock[0])
        self.loop = ProactiveLoop(self.chat, helper=self.helper, now=lambda: self.clock[0])
        self.loop.mode, self.loop.client_id, self.loop.lease_until = "active", "client", 2000

    async def asyncTearDown(self):
        await self.loop.close()
        self.directory.cleanup()

    def begin_event(self, event_id="event-1"):
        self.loop.update_context(APPROVED, self.clock[0])
        event = {
            "status": "running",
            "task_revision": self.chat.meta["tasks"]["revision"],
            "human_epoch": 0,
            "fingerprint": __import__("app.accountability", fromlist=["fingerprint"]).fingerprint(
                APPROVED
            ),
            "created_at": self.clock[0],
            "assistant_id": None,
            "observed_session_id": self.loop.ledger.snapshot(self.clock[0])["active_session"]["id"],
        }
        self.loop.state["events"][event_id] = event
        payload = {
            "session_id": "fixture-session",
            "event_id": event_id,
            "task_state": public_state(self.chat.meta["tasks"]),
            "human_epoch": 0,
            "observation": APPROVED,
        }
        return event, payload

    async def test_approved_samples_update_only_ledger_not_task_counts(self):
        before = deepcopy(self.chat.meta["tasks"])
        self.loop.update_context(APPROVED, self.clock[0])
        self.clock[0] += 5
        self.loop.update_context({**APPROVED, "title": "different"}, self.clock[0])
        active = self.loop.ledger.snapshot(self.clock[0])["active_session"]
        self.assertEqual(active["observed_seconds"], 5)
        self.assertEqual(self.chat.meta["tasks"], before)

    async def test_quiet_association_is_saved_without_visible_delivery(self):
        event, payload = self.begin_event()
        self.chat.reply = {
            "event_id": "event-1",
            "decision": "quiet",
            "message": "",
            "related_task_ids": ["task-one"],
        }
        await self.loop.decide(payload)
        session = self.loop.ledger.snapshot(self.clock[0])["recent_sessions"][0]
        self.assertEqual(event["status"], "quiet")
        self.assertEqual(session["related_task_ids"], ["task-one"])
        self.assertIsNone(self.loop.stream)

    async def test_invalid_related_ids_reject_inference(self):
        event, payload = self.begin_event()
        self.chat.reply = {
            "event_id": "event-1",
            "decision": "quiet",
            "message": "",
            "related_task_ids": ["not-a-task"],
        }
        await self.loop.decide(payload)
        session = self.loop.ledger.snapshot(self.clock[0])["recent_sessions"][0]
        self.assertEqual(event["status"], "quiet")
        self.assertNotIn("related_task_ids", session)

    async def test_background_message_becomes_visible_only_after_committed_publication(self):
        event, payload = self.begin_event()
        self.chat.emit_preview = True
        self.chat.reply = {
            "event_id": "event-1",
            "decision": "check_in",
            "message": "Still going?",
            "related_task_ids": [],
        }
        await self.loop.decide(payload)
        self.assertEqual(event["status"], "delivered")
        self.assertEqual(
            self.loop.stream,
            {
                "id": "event-1",
                "event_id": "event-1",
                "text": "Still going?",
                "status": "complete",
                "message_id": "4",
            },
        )
        self.assertEqual(len(self.chat.changed_states), 1)

    async def test_pause_source_or_task_change_discards_draft_before_delivery(self):
        for change in ("pause", "source", "task"):
            event, payload = self.begin_event(change)
            self.chat.emit_preview = True
            self.chat.reply = {
                "event_id": change,
                "decision": "check_in",
                "message": "Still going?",
                "related_task_ids": [],
            }
            original = self.chat.command

            async def command(args, *, _change=change, _original=original, **kwargs):
                callback = kwargs.get("on_preview")
                if args[0] == "--input" and callback:
                    callback("Writing")
                if args[0] == "--input":
                    if _change == "pause":
                        self.loop.stop("paused", "test")
                    elif _change == "source":
                        self.loop.update_context(OTHER, self.clock[0])
                    else:
                        self.chat.meta["tasks"]["revision"] += 1
                return await _original(args, **kwargs)

            self.chat.command = command
            await self.loop.decide(payload)
            self.assertEqual(event["status"], "stale")
            self.assertIsNone(self.loop.stream)
            self.chat.command = original
            self.loop.mode, self.loop.client_id, self.loop.lease_until = "active", "client", 2000


class CommitMetaLedgerTests(unittest.IsolatedAsyncioTestCase):
    async def test_commit_meta_rebind_preserves_activity_journal_after_task_commit(self):
        directory = tempfile.TemporaryDirectory()
        path = Path(directory.name) / "pointer.json"
        with patch("app.chat_service.check_config"):
            chat = LocalChat(meta_path=path)
        try:
            chat.proactive.ledger.observe(APPROVED, 100)
            before = deepcopy(chat.meta["activity_journal"])
            candidate = deepcopy(chat.meta)
            candidate["tasks"], _ = apply_operations(
                candidate["tasks"],
                [
                    {
                        "op": "add",
                        "temp_id": "new_one",
                        "title": "Read",
                        "due_text": None,
                        "target_count": None,
                        "unit": None,
                    }
                ],
                based_on_revision=candidate["tasks"]["revision"],
                request_id="commit",
                source={"kind": "human"},
                now=2,
                id_factory=lambda: "task-one",
            )
            chat.commit_meta(candidate)
            self.assertIs(chat.proactive.ledger.journal, chat.meta["activity_journal"])
            self.assertEqual(chat.meta["activity_journal"], before)
        finally:
            await chat.close()
            directory.cleanup()
