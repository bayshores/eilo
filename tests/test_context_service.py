from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet

from app.context_service import ContextError, ContextService
from app.runtime_contract import MODEL, PROVIDER


class Clock:
    def __init__(self):
        self.value = 1_000.0

    def __call__(self):
        return self.value


class ContextServiceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.clock, self.key_calls = Clock(), []
        self.tasks = [{"id": "task-1", "title": "Do not mutate", "status": "open"}]
        self.service = ContextService(
            Path(self.temporary.name),
            clock=self.clock,
            key_provider=self._key,
            get_tasks=lambda: self.tasks,
        )

    def tearDown(self):
        self.service.close()
        self.temporary.cleanup()

    def _key(self, *, create=False):
        self.key_calls.append(create)
        return Fernet.generate_key()

    def _run(self, body):
        return asyncio.run(self.service.command(body))

    def _configure(self, **changes):
        body = {
            "request_id": f"configure-{self.service.state['revision']}",
            "based_on_revision": self.service.state["revision"],
            "action": "configure",
            "enabled": True,
            "desktop_enabled": True,
            "browser_enabled": True,
            "text_enabled": True,
            "visuals_enabled": False,
            "ai_enabled": False,
            "excluded_bundle_ids": [],
            "excluded_domains": [],
        }
        body.update(changes)
        return self._run(body)

    def test_off_constructor_and_snapshot_do_not_request_key(self):
        self.assertEqual(self.service.snapshot()["analysis"]["status"], "off")
        self.assertEqual(self.key_calls, [])
        self._configure(enabled=False)
        self.assertEqual(self.key_calls, [])
        self._run(
            {
                "request_id": "adaptive",
                "based_on_revision": self.service.state["revision"],
                "action": "set_mode",
                "mode": "adaptive",
            }
        )
        self.assertEqual(self.key_calls, [True])

    def test_browser_registration_required_health_is_published(self):
        self.service.set_capture_health("browser", "registration_required")
        self.assertEqual(
            self.service.snapshot()["capture_status"]["browser"]["status"],
            "registration_required",
        )

    def test_event_revocation_timestamp_and_dedupe(self):
        self._configure()
        policy = self.service.collector_policy("desktop")
        event = {
            "schema_version": 1,
            "id": "event-1",
            "source_id": "desktop",
            "session_id": policy["session_id"],
            "policy_epoch": policy["policy_epoch"],
            "captured_at": self.clock.value,
            "kind": "text",
            "bundle_id": "com.example.editor",
            "app_name": "Editor",
            "title": "Editor",
            "text": "source text",
        }
        self.assertTrue(asyncio.run(self.service.ingest(event))["accepted"])
        self.assertEqual(asyncio.run(self.service.ingest(event))["reason"], "duplicate")
        event["id"], event["captured_at"] = "event-2", self.clock.value - 61
        with self.assertRaises(ContextError):
            asyncio.run(self.service.ingest(event))
        event["captured_at"], event["policy_epoch"] = self.clock.value, policy["policy_epoch"] - 1
        self.assertEqual(asyncio.run(self.service.ingest(event))["reason"], "withheld")

    def test_forget_removes_cached_composition_and_never_mutates_tasks(self):
        self._configure()
        policy = self.service.collector_policy("desktop")
        asyncio.run(
            self.service.ingest(
                {
                    "schema_version": 1,
                    "id": "event-1",
                    "source_id": "desktop",
                    "session_id": policy["session_id"],
                    "policy_epoch": policy["policy_epoch"],
                    "captured_at": self.clock.value,
                    "kind": "app",
                    "bundle_id": "com.example.editor",
                    "app_name": "Editor",
                    "title": "Editor",
                    "text": "",
                }
            )
        )
        ids = self.service.store.find_ids(kind="observation")
        self._run(
            {
                "request_id": "forget",
                "based_on_revision": self.service.state["revision"],
                "action": "forget",
                "ids": ids,
            }
        )
        self.assertEqual(self.service.store.find_ids(kind="observation"), [])
        self.assertEqual(self.tasks, [{"id": "task-1", "title": "Do not mutate", "status": "open"}])

    def test_human_resume_accepts_valid_driver_receipt_without_mutating_tasks(self):
        async def analyze(request):
            evidence = request["evidence"][0]["id"]
            return {
                "request_id": request["request_id"],
                "policy_epoch": request["policy_epoch"],
                "proposal": {
                    "title": "Presentation draft",
                    "summary": "Drafting the examples section.",
                    "return_point": "Continue with the next example.",
                    "confidence": "explicit",
                    "evidence_ids": [evidence],
                    "task_ids": [],
                    "components": [
                        {
                            "id": "resume",
                            "kind": "resume",
                            "title": "Resume",
                            "emphasis": "primary",
                            "text": "Continue examples.",
                        },
                        {
                            "id": "note",
                            "kind": "note",
                            "title": "Note",
                            "emphasis": "normal",
                            "text": "Keep the draft concise.",
                        },
                    ],
                },
                "audit": {
                    "model": MODEL,
                    "provider": PROVIDER,
                    "tool_schema_count": 0,
                    "persisted": False,
                },
            }

        self.service.analyze = analyze
        self._configure(ai_enabled=True)
        self._run(
            {
                "request_id": "adaptive-mode",
                "based_on_revision": self.service.state["revision"],
                "action": "set_mode",
                "mode": "adaptive",
            }
        )
        self.service.on_human("draft the presentation examples")

        async def finish():
            self.service.resume_after_human()
            await self.service.job

        asyncio.run(finish())
        snapshot = self.service.snapshot()
        self.assertEqual(snapshot["current_work_context"]["title"], "Presentation draft")
        self.assertEqual(
            [item["kind"] for item in snapshot["home_composition"]["components"]],
            ["resume", "note"],
        )
        self.assertEqual(self.tasks, [{"id": "task-1", "title": "Do not mutate", "status": "open"}])

    def test_cancel_resistant_analyzer_result_is_ignored_after_ai_is_disabled(self):
        gate = asyncio.Event()

        async def analyze(request):
            try:
                await gate.wait()
            except asyncio.CancelledError:
                await gate.wait()
            evidence = request["evidence"][0]["id"]
            return {
                "request_id": request["request_id"],
                "policy_epoch": request["policy_epoch"],
                "proposal": {
                    "title": "Late",
                    "summary": "Late result.",
                    "return_point": "",
                    "confidence": "explicit",
                    "evidence_ids": [evidence],
                    "task_ids": [],
                    "components": [
                        {"id": "resume", "kind": "resume", "title": "Resume", "emphasis": "primary"}
                    ],
                },
                "audit": {
                    "model": MODEL,
                    "provider": PROVIDER,
                    "tool_schema_count": 0,
                    "persisted": False,
                },
            }

        self.service.analyze = analyze
        self._configure(ai_enabled=True)
        self._run(
            {
                "request_id": "adaptive-mode",
                "based_on_revision": self.service.state["revision"],
                "action": "set_mode",
                "mode": "adaptive",
            }
        )
        self.service.on_human("resume the draft")

        async def cancel_then_release():
            self.service.resume_after_human()
            job = self.service.job
            await asyncio.sleep(0)
            await self.service.command(
                {
                    "request_id": "disable-ai",
                    "based_on_revision": self.service.state["revision"],
                    "action": "configure",
                    "enabled": True,
                    "desktop_enabled": True,
                    "browser_enabled": True,
                    "text_enabled": True,
                    "visuals_enabled": False,
                    "ai_enabled": False,
                    "excluded_bundle_ids": [],
                    "excluded_domains": [],
                }
            )
            gate.set()
            await job

        asyncio.run(cancel_then_release())
        self.assertIsNone(self.service.snapshot()["home_composition"])
        self.assertEqual(len(self.service.state["call_times"]), 1)


if __name__ == "__main__":
    unittest.main()
