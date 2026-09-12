"""Focused public status and independent check-in-permission coverage."""

from __future__ import annotations

import asyncio
import contextlib
import json
import tempfile
import unittest
from pathlib import Path

from app.accountability import MAX_CALLS_HOUR, fingerprint, initial_state
from app.proactive import ProactiveLoop
from app.tasks import apply_operations, initial_tasks, public_state

APPROVED = {"kind": "approved_study_context", "origin": "https://leetcode.com", "title": "private"}


class StatusChat:
    def __init__(self, directory):
        self.meta_path = Path(directory) / "meta.json"
        self.meta = {
            "session_id": "fixture-session",
            "accountability": initial_state(),
            "tasks": initial_tasks(),
        }
        self.native_lock = asyncio.Lock()
        self.blocked = self.busy = False
        self.changed_count = 0

    def add_open_task(self):
        self.meta["tasks"], _ = apply_operations(
            self.meta["tasks"],
            [
                {
                    "op": "add",
                    "temp_id": "new_task",
                    "title": "private task",
                    "due_text": None,
                    "target_count": None,
                    "unit": None,
                }
            ],
            based_on_revision=0,
            request_id="fixture",
            source={"kind": "human"},
            now=1,
            id_factory=lambda: "private-task",
        )

    def save_meta(self):
        self.meta_path.write_text(json.dumps(self.meta))

    def changed(self):
        self.changed_count += 1

    async def refresh(self):
        pass

    def publish_check_in(self, publication, *, lookup=False):
        return {"event_id": publication["event_id"], "assistant_id": None if lookup else 7}

    async def command(self, args, **kwargs):
        path = Path(args[1])
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
                    "decision": {"event_id": event_id, "decision": "quiet", "message": ""},
                }
            ),
            "",
        )


class ProactiveStatusTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.clock = [1_000.0]
        self.helper = Path(self.directory.name) / "helper"
        self.helper.touch()
        self.chat = StatusChat(self.directory.name)
        self.chat.add_open_task()
        self.loop = ProactiveLoop(self.chat, helper=self.helper, now=lambda: self.clock[0])
        self.loop.mode, self.loop.client_id, self.loop.lease_until = (
            "active",
            "client-123456",
            2_000,
        )

    async def asyncTearDown(self):
        await self.loop.close()
        self.directory.cleanup()

    def test_status_gate_projection_uses_actual_rules_and_never_promises_outreach(self):
        self.assertEqual(self.loop.snapshot()["check_ins"]["phase"], "awaiting_observation")
        self.loop.latest, self.loop.last_observation_at, self.loop.stable_since = APPROVED, 990, 990
        self.assertEqual(self.loop.snapshot()["check_ins"]["eligible_at"], 1035)
        self.loop.stable_since = 1
        self.loop.state.update(
            last_human_at=950, last_decision_at=900, call_times=[999] * MAX_CALLS_HOUR
        )
        status = self.loop.snapshot()["check_ins"]
        self.assertEqual((status["phase"], status["eligible_at"]), ("human_grace", 4599))
        self.loop.state.update(last_human_at=1, last_decision_at=1, call_times=[])
        self.assertEqual(
            (
                self.loop.snapshot()["check_ins"]["phase"],
                self.loop.snapshot()["check_ins"]["eligible_at"],
            ),
            ("eligible", None),
        )
        self.assertEqual(
            status["rules"],
            {
                "stable_seconds": 45,
                "human_grace_seconds": 120,
                "cooldown_seconds": 300,
                "max_per_hour": 3,
                "max_per_day": 8,
            },
        )

    def test_phase_priority_table(self):
        cases = [
            ("off", lambda: self.loop.state.__setitem__("check_ins_enabled", False)),
            ("activity_off", lambda: setattr(self.loop, "mode", "off")),
            ("activity_paused", lambda: setattr(self.loop, "mode", "paused")),
            ("on_break", lambda: self.chat.meta["tasks"].__setitem__("break_active", True)),
            ("no_goals", lambda: self.chat.meta["tasks"].__setitem__("tasks", [])),
            ("no_conversation", lambda: self.chat.meta.__setitem__("session_id", None)),
            ("unavailable", lambda: setattr(self.chat, "blocked", True)),
        ]
        for expected, configure in cases:
            self.loop.state["check_ins_enabled"] = True
            self.loop.mode, self.loop.client_id, self.loop.lease_until = (
                "active",
                "client-123456",
                2_000,
            )
            self.chat.blocked = False
            self.chat.meta["session_id"] = "fixture-session"
            self.chat.meta["tasks"] = initial_tasks()
            self.chat.add_open_task()
            configure()
            self.assertEqual(self.loop.snapshot()["check_ins"]["phase"], expected)

    async def test_pause_invalidates_running_event_without_stopping_collection_or_lease(self):
        event = {
            "status": "running",
            "task_revision": self.chat.meta["tasks"]["revision"],
            "human_epoch": self.loop.state["human_epoch"],
            "fingerprint": fingerprint(APPROVED),
            "created_at": 999,
        }
        self.loop.latest, self.loop.last_observation_at = APPROVED, 999
        self.loop.state["events"]["private-event"] = event
        self.loop.event_id = "private-event"
        never = asyncio.Event()
        self.loop.event_task = asyncio.create_task(never.wait())
        before = (self.loop.mode, self.loop.client_id, self.loop.lease_until)
        self.loop.control("pause_check_ins", "client-123456")
        self.assertEqual(event["status"], "stale")
        self.assertFalse(self.loop.current(event))
        self.assertEqual((self.loop.mode, self.loop.client_id, self.loop.lease_until), before)
        self.assertTrue(self.loop.active())
        with contextlib.suppress(asyncio.CancelledError):
            await self.loop.event_task

    def test_history_is_bounded_content_free_and_omits_unknown_records(self):
        for index in range(35):
            self.loop.state["events"][f"secret-{index}"] = {
                "status": "delivered",
                "created_at": index + 1,
                "finished_at": index + 1.5,
                "fingerprint": "secret-fingerprint",
                "title": "private title",
            }
        self.loop.state["events"]["orphan"] = {"status": "running", "created_at": 99}
        self.loop.state["events"]["unknown"] = {"status": "made_up", "created_at": 100}
        status = self.loop.snapshot()["check_ins"]
        self.assertEqual(len(status["history"]), 30)
        self.assertEqual(status["history"][0]["outcome"], "stale")
        public = json.dumps(status)
        self.assertNotIn("secret-", public)
        self.assertNotIn("secret-fingerprint", public)
        self.assertNotIn("private title", public)
        self.assertNotIn("made_up", public)
        self.assertIsNone(self.loop._timestamp(float("inf")))
        self.assertIsNone(self.loop._timestamp(True))
        self.assertIsNone(self.loop._timestamp(0))

    async def test_terminal_event_records_finished_at(self):
        self.loop.latest, self.loop.last_observation_at = APPROVED, 999
        event = {
            "status": "running",
            "task_revision": self.chat.meta["tasks"]["revision"],
            "human_epoch": self.loop.state["human_epoch"],
            "fingerprint": fingerprint(APPROVED),
            "created_at": 999,
            "assistant_id": None,
        }
        self.loop.state["events"]["event-finished"] = event
        payload = {
            "session_id": "fixture-session",
            "event_id": "event-finished",
            "task_state": public_state(self.chat.meta["tasks"]),
            "human_epoch": event["human_epoch"],
            "observation": APPROVED,
        }
        await self.loop.decide(payload)
        self.assertEqual((event["status"], event["finished_at"]), ("quiet", self.clock[0]))


if __name__ == "__main__":
    unittest.main()
