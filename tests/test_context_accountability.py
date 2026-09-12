"""Modern capture through real context/task orchestration, with an inert native boundary."""

import asyncio
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet

from app.chat_service import LocalChat
from app.context_capture import ContextCapture
from app.context_service import ContextService
from app.proactive import ProactiveLoop
from app.runtime_contract import MODEL, PROVIDER, visible_messages

ROOT = Path(__file__).resolve().parents[1]


class ContextAccountabilityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / ".tmp")
        self.directory = Path(self.temp.name)
        self.now = 1000.0
        self.key = Fernet.generate_key()
        self.chat = LocalChat(meta_path=self.directory / "meta.json")
        self.chat.meta.update(session_id="fixture-session", started=True)
        self.chat.proactive = ProactiveLoop(
            self.chat, helper=self.directory / "unused", now=lambda: self.now
        )
        self.chat.context = ContextService(
            self.directory / "context",
            clock=lambda: self.now,
            key_provider=lambda **_: self.key,
            changed=self.chat.context_changed,
        )
        self.chat.context_capture = ContextCapture(
            self.directory / "context", self.chat.context, self.directory / "unused"
        )
        self.native, self.calls = [], []
        self.decision = "check_in"
        self.hold = None
        self.crash_after_append = False
        self.chat.command = self.command
        self.chat.publish_check_in = self.publish_check_in
        self.chat.refresh = self.refresh
        await self.chat.control_tasks(
            [
                {
                    "op": "add",
                    "temp_id": "new_brief",
                    "title": "Write the project brief",
                    "due_text": None,
                    "target_count": None,
                    "unit": None,
                }
            ],
            "create-fixture-task",
            0,
        )
        self.chat.proactive.state["last_human_at"] = 0
        await self.configure()

    async def asyncTearDown(self):
        if self.hold:
            self.hold.set()
        await self.chat.close()
        self.temp.cleanup()

    async def configure(self, **changes):
        context = self.chat.context
        await context.command(
            {
                "action": "configure",
                "request_id": f"policy-{context.state['revision']}",
                "based_on_revision": context.state["revision"],
                "enabled": True,
                "browser_enabled": True,
                "desktop_enabled": True,
                "text_enabled": True,
                "ai_enabled": True,
                "visuals_enabled": False,
                "excluded_bundle_ids": [],
                "excluded_domains": [],
                **changes,
            }
        )

    async def sample(self, source="browser", title="Project brief"):
        context = self.chat.context
        value = {
            "schema_version": 1,
            "id": f"{source}-{self.now}",
            "source_id": source,
            "session_id": context.session_id,
            "policy_epoch": context.state["policy_epoch"],
            "captured_at": self.now,
            "kind": "browser" if source == "browser" else "text",
            "bundle_id": "com.google.Chrome" if source == "browser" else "com.example.editor",
            "app_name": "Chrome" if source == "browser" else "Editor",
            "title": title,
            "text": "PRIVATE FIXTURE BODY must stay out of the check-in prompt",
        }
        if source == "browser":
            value["origin"] = "https://example.test"
        callback = (
            self.chat.context_capture._on_browser_event
            if source == "browser"
            else self.chat.context_capture._on_desktop_event
        )
        await callback(value)
        await asyncio.sleep(0)

    async def settle(self, source="browser", title="Project brief", seconds=50):
        for _ in range(seconds // 5):
            await self.sample(source, title)
            self.now += 5
        if not self.hold:
            await self.chat.proactive.wait_for_preempted_event()

    async def command(self, args, **kwargs):
        self.calls.append(args[0])
        value = json.loads(Path(args[1]).read_text())
        if args[0] == "--input":
            self.assertNotIn("PRIVATE FIXTURE BODY", json.dumps(value))
            if self.hold:
                try:
                    await self.hold.wait()
                except asyncio.CancelledError:
                    # Even a cancellation-resistant provider must not publish stale text.
                    await self.hold.wait()
            return (
                0,
                json.dumps(
                    {
                        "audit": {
                            "model": MODEL,
                            "provider": PROVIDER,
                            "tool_schema_count": 0,
                            "persisted": False,
                        },
                        "assistant_id": None,
                        "decision": {
                            "event_id": value["event_id"],
                            "decision": self.decision,
                            "message": "How is the brief going?"
                            if self.decision != "quiet"
                            else "",
                        },
                    }
                ),
                "",
            )

    def publish_check_in(self, value, *, lookup=False):
        self.calls.append("--find-publication" if lookup else "--publish")
        matches = [
            row for row in self.native if row["display_metadata"]["event_id"] == value["event_id"]
        ]
        if not lookup and not matches:
            saved = json.loads(self.chat.meta_path.read_text())
            self.assertEqual(
                saved["accountability"]["events"][value["event_id"]]["status"], "publishing"
            )
            row = {
                "id": len(self.native) + 1,
                "role": "assistant",
                "display_kind": "eilo_decision",
                "display_metadata": {"event_id": value["event_id"]},
                "content": json.dumps(value["decision"]),
            }
            self.native.append(row)
            matches = [row]
            if self.crash_after_append:
                raise OSError("simulated lost append receipt")
        return {
            "event_id": value["event_id"],
            "assistant_id": matches[0]["id"] if matches else None,
        }

    async def refresh(self):
        self.chat.messages = visible_messages(
            {"messages": self.native}, self.chat.proactive.state["events"]
        )

    async def test_capture_requires_separate_checkin_consent_then_delivers_once(self):
        before = deepcopy(self.chat.meta["tasks"])
        await self.settle()
        self.assertEqual(self.calls, [])
        self.assertFalse(self.chat.proactive.snapshot()["check_ins"]["enabled"])
        self.chat.proactive.control("enable_check_ins", "fixture-user")
        await self.settle(seconds=100)
        self.assertEqual(self.calls, ["--input", "--publish"])
        self.assertEqual(len(self.chat.messages), 1)
        self.assertEqual(self.chat.messages[0]["origin"], "check_in")
        self.assertEqual(
            self.chat.proactive.snapshot()["check_ins"]["notification_event_ids"],
            [self.chat.messages[0]["event_id"]],
        )
        self.assertEqual(self.chat.meta["tasks"], before)
        self.assertFalse(self.chat.proactive.active(), "No page lease was started")

    async def test_desktop_quiet_result_never_enters_conversation(self):
        self.chat.proactive.control("enable_check_ins", "fixture-user")
        self.decision = "quiet"
        await self.settle("desktop")
        self.assertEqual(self.calls, ["--input"])
        self.assertEqual(self.native, [])
        self.assertEqual(
            next(iter(self.chat.proactive.state["events"].values()))["status"], "quiet"
        )

    async def test_published_checkin_survives_native_row_identity_change(self):
        self.chat.proactive.control("enable_check_ins", "fixture-user")
        await self.settle()
        event = next(iter(self.chat.proactive.state["events"].values()))
        self.native[0]["id"] = 99
        self.native[0]["display_metadata"].update(
            publication_version=2,
            task_revision=event["task_revision"],
            human_epoch=event["human_epoch"],
        )
        await self.refresh()
        self.assertEqual(self.chat.messages[0]["id"], "99")
        self.native[0]["display_metadata"]["human_epoch"] += 1
        await self.refresh()
        self.assertEqual(self.chat.messages, [])

    async def test_revocation_while_inference_runs_drops_even_late_result(self):
        self.chat.proactive.control("enable_check_ins", "fixture-user")
        self.hold = asyncio.Event()
        await self.settle()
        self.assertEqual(self.calls, ["--input"])
        self.assertIsNone(
            self.chat.proactive.stream, "A background draft is not a delivered check-in"
        )
        await self.configure(ai_enabled=False)
        self.hold.set()
        await self.chat.proactive.wait_for_preempted_event()
        self.assertEqual(self.native, [])
        self.assertEqual(
            next(iter(self.chat.proactive.state["events"].values()))["status"], "stale"
        )
        self.assertIsNone(self.chat.context.conversation_context())

    async def test_response_break_resume_and_context_change_control_next_check(self):
        self.chat.proactive.control("enable_check_ins", "fixture-user")
        await self.settle()
        self.chat.proactive.on_human(
            "This is relevant research; I'm taking a break now.", "reply-fixture"
        )
        await self.chat.control_tasks(
            [{"op": "break", "active": True}], "break-fixture", self.chat.meta["tasks"]["revision"]
        )
        first = next(iter(self.chat.proactive.state["events"].values()))
        self.assertEqual(first["response_request_id"], "reply-fixture")
        self.assertEqual(self.chat.proactive.snapshot()["check_ins"]["notification_event_ids"], [])
        await self.settle(title="Research references", seconds=400)
        self.assertEqual(len(self.native), 1)
        await self.chat.control_tasks(
            [{"op": "break", "active": False}],
            "resume-fixture",
            self.chat.meta["tasks"]["revision"],
        )
        await self.settle(title="Research references", seconds=115)
        self.assertEqual(len(self.native), 1, "Human grace applies after resume")
        self.decision = "quiet"
        await self.settle(title="Research references", seconds=20)
        self.assertEqual(len(self.native), 1)
        self.assertEqual(self.calls.count("--input"), 2)

    async def test_uncertain_append_is_reconciled_after_restart_without_replay(self):
        self.chat.proactive.control("enable_check_ins", "fixture-user")
        self.crash_after_append = True
        await self.settle()
        self.assertEqual(len(self.native), 1)
        saved = json.loads(self.chat.meta_path.read_text())
        self.assertEqual(
            next(iter(saved["accountability"]["events"].values()))["status"], "publishing"
        )
        self.chat.meta = saved
        self.chat.proactive = ProactiveLoop(
            self.chat, helper=self.directory / "unused", now=lambda: self.now
        )
        await self.chat.proactive.recover_publications()
        await self.chat.proactive.recover_publications()
        self.assertEqual(self.calls, ["--input", "--publish", "--find-publication"])
        self.assertEqual(len(self.native), 1)
        self.assertEqual(len(self.chat.messages), 1, "The exact recovered append stays visible")
        event = next(iter(self.chat.proactive.state["events"].values()))
        self.assertEqual(event["recovery_outcome"], "native_found")
        self.assertEqual(self.chat.proactive.snapshot()["check_ins"]["notification_event_ids"], [])
        await self.settle(seconds=400)
        self.assertEqual(len(self.native), 1)

    async def test_context_chat_projection_is_scoped_and_survives_restart(self):
        await self.settle()
        projection = self.chat.context.conversation_context()
        self.assertEqual(projection["recent_activity"][0]["duration_seconds"], 45)
        self.assertNotIn("PRIVATE FIXTURE BODY", json.dumps(projection))
        self.chat.context.close()
        self.chat.context = ContextService(
            self.directory / "context", key_provider=lambda **_: self.key, clock=lambda: self.now
        )
        await self.chat.context.start()
        self.assertEqual(self.chat.context.conversation_context(), projection)
        await self.configure(excluded_domains=["example.test"])
        self.assertIsNone(self.chat.context.conversation_context())

    async def test_failed_candidate_write_never_starts_inference(self):
        self.chat.proactive.control("enable_check_ins", "fixture-user")
        await self.sample()
        self.now += 45
        with patch.object(self.chat, "save_meta", side_effect=OSError("disk full")):
            await self.sample()
        self.assertEqual(self.calls, [])
