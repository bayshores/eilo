"""End-to-end context behavior with synthetic intent and an injected model."""

import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from cryptography.fernet import Fernet

from app.context_service import ContextService
from app.runtime_contract import MODEL, PROVIDER


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.key = Fernet.generate_key()
        self.now = 1000.0
        self.title = "Draft a project brief"
        self.tasks = [{"id": "goal-1", "title": "An unrelated commitment", "status": "open"}]
        self.original_tasks = deepcopy(self.tasks)
        self.service = ContextService(
            Path(self.temp.name),
            key_provider=lambda **_: self.key,
            clock=lambda: self.now,
            get_tasks=lambda: self.tasks,
            analyze=self.analyze,
            settle_seconds=0,
        )
        await self.command("set_mode", mode="adaptive")
        await self.command("configure", **{**self.service.snapshot()["policy"], "ai_enabled": True})

    async def asyncTearDown(self):
        await self.service.aclose()
        self.temp.cleanup()

    async def command(self, action, **fields):
        revision = self.service.state["revision"]
        return await self.service.command(
            {
                "request_id": f"command-{revision}",
                "based_on_revision": revision,
                "action": action,
                **fields,
            }
        )

    async def analyze(self, request):
        return {
            "request_id": request["request_id"],
            "policy_epoch": request["policy_epoch"],
            "audit": {
                "model": MODEL,
                "provider": PROVIDER,
                "persisted": False,
                "tool_schema_count": 0,
            },
            "proposal": {
                "title": self.title,
                "summary": "The user is drafting a brief.",
                "return_point": "The opening paragraph",
                "confidence": "explicit",
                "evidence_ids": [request["evidence"][0]["id"]],
                "task_ids": [],
                "components": [
                    {
                        "id": "resume",
                        "kind": "resume",
                        "title": "Return point",
                        "emphasis": "primary",
                        "text": "The opening paragraph",
                    },
                    {
                        "id": "note",
                        "kind": "note",
                        "title": "Notes",
                        "emphasis": "normal",
                        "text": "",
                    },
                ],
            },
        }

    async def intent(self, text):
        self.service.on_human(text)
        self.service.resume_after_human()
        job = self.service.job
        self.assertIsNotNone(job)
        await job
        self.now += 1
        snapshot = self.service.snapshot()
        self.assertEqual(snapshot["analysis"]["status"], "ready")
        return snapshot

    async def test_pins_undo_chosen_notes_and_correction(self):
        first = await self.intent("I am writing a project brief.")
        components = first["home_composition"]["components"]
        pin, note = components[0]["id"], components[1]["id"]
        await self.command("pin", component_id=pin)
        await self.command("note", component_id=note, text="My chosen note")
        self.title = "Compare train routes"
        second = await self.intent("I am comparing train routes now.")
        self.assertEqual(second["home_composition"]["components"][0], components[0])
        restored = await self.command("undo")
        self.assertEqual(restored["home_composition"]["title"], first["home_composition"]["title"])
        self.assertEqual(restored["home_composition"]["components"][1]["text"], "My chosen note")
        corrected = await self.command(
            "correct", title="Write the garden proposal", return_point="Finish the opening"
        )
        self.assertEqual(corrected["current_work_context"]["title"], "Write the garden proposal")
        self.assertEqual(
            corrected["home_composition"]["components"][0]["text"], "Finish the opening"
        )
        forgotten = await self.command("forget")
        self.assertIsNone(forgotten["current_work_context"])
        self.assertIsNone(forgotten["home_composition"])
        self.assertEqual(self.service.store.list("note")[0]["payload"]["text"], "My chosen note")
        self.assertEqual(self.tasks, self.original_tasks)

    async def test_budget_and_malformed_response_leave_last_good_view(self):
        first = await self.intent("I am drafting a brief.")
        self.service.state["call_times"] = [self.now] * 12
        self.service.on_human("Continue the draft.")
        self.service.resume_after_human()
        self.assertIsNone(self.service.job)
        self.assertEqual(self.service.snapshot()["analysis"]["status"], "budget_paused")
        self.assertEqual(self.service.snapshot()["home_composition"], first["home_composition"])
        self.service.state["call_times"] = []

        async def malformed(request):
            receipt = await self.analyze(request)
            receipt["proposal"]["evidence_ids"] = ["made-up"]
            return receipt

        self.service.analyze = malformed
        self.service.on_human("Continue the draft.")
        self.service.resume_after_human()
        await self.service.job
        self.assertEqual(self.service.snapshot()["analysis"]["status"], "unavailable")
        self.assertEqual(self.service.snapshot()["home_composition"], first["home_composition"])

    async def test_detail_expiry_keeps_summary_but_explicit_forget_removes_it(self):
        first = await self.intent("I am drafting a brief.")
        evidence = first["current_work_context"]["evidence_ids"]
        self.now += 86401
        self.service.store.purge()
        self.assertEqual(self.service.store.list("observation"), [])
        self.assertIsNotNone(self.service.snapshot()["current_work_context"])
        await self.command("forget", ids=evidence)
        self.assertIsNone(self.service.snapshot()["current_work_context"])
        self.assertEqual(self.service.store.search("brief"), [])

    async def test_learning_needs_repeated_choices_across_work_contexts(self):
        first = await self.intent("I am drafting a project brief.")
        await self.command("preference", component_kind="note", value="less")
        chosen = self.service.snapshot()["preferences"][0]
        self.assertTrue(chosen["explicit"])
        await self.command("preference", component_kind="note", value="reset")
        self.assertEqual(self.service.snapshot()["preferences"], [])
        component_id = first["home_composition"]["components"][0]["id"]
        for _ in range(3):
            await self.command("feedback", component_id=component_id, value="prefer")
            self.assertEqual(self.service.snapshot()["preferences"], [])
        self.title = "Plan a garden layout"
        second = await self.intent("I am planning the garden layout.")
        await self.command(
            "feedback",
            component_id=second["home_composition"]["components"][0]["id"],
            value="prefer",
        )
        learned = self.service.snapshot()["preferences"][0]
        self.assertTrue(learned["learned"])
        self.assertFalse(learned["explicit"])
        await self.command("preference", component_kind="note", value="prefer")
        await self.command("forget", ids=first["current_work_context"]["evidence_ids"])
        remaining = self.service.snapshot()["preferences"]
        self.assertEqual(len(remaining), 1)
        self.assertTrue(remaining[0]["explicit"])

    async def test_same_work_preserves_context_and_widget_identity(self):
        first = await self.intent("I am writing the project brief.")
        note = first["home_composition"]["components"][1]["id"]
        await self.command("note", component_id=note, text="A chosen detail")
        second = await self.intent("I am still writing the project brief.")
        self.assertEqual(first["current_work_context"]["id"], second["current_work_context"]["id"])
        self.assertEqual(second["home_composition"]["components"][1]["id"], note)
        self.assertEqual(second["home_composition"]["components"][1]["text"], "A chosen detail")

    async def test_chat_change_revokes_pending_human_inference(self):
        self.service.on_human("I am writing a brief.")
        self.service.on_chat_change()
        self.service.resume_after_human()
        self.assertIsNone(self.service.job)
        self.assertEqual(self.service.store.list("observation"), [])

    async def test_changed_content_updates_return_point_without_changing_apps(self):
        calls = []

        async def observed(request):
            calls.append(request)
            result = await self.analyze(request)
            result["proposal"]["confidence"] = "observed"
            result["proposal"]["return_point"] = request["evidence"][0]["text"]
            return result

        self.service.analyze = observed
        await self.command(
            "configure",
            **{
                **self.service.snapshot()["policy"],
                "enabled": True,
                "desktop_enabled": True,
                "text_enabled": True,
            },
        )
        policy = self.service.collector_policy("desktop")

        async def capture(id, text):
            await self.service.ingest(
                {
                    "schema_version": 1,
                    "id": id,
                    "source_id": "desktop",
                    "session_id": policy["session_id"],
                    "policy_epoch": policy["policy_epoch"],
                    "captured_at": self.now,
                    "kind": "text",
                    "bundle_id": "com.example.editor",
                    "app_name": "Editor",
                    "title": "Project brief",
                    "text": text,
                }
            )
            if self.service._settler:
                await self.service._settler
            if self.service.job:
                await self.service.job

        await capture("same-app-1", "Opening paragraph")
        self.now += 301
        await capture("same-app-2", "Supporting examples")
        self.assertEqual(len(calls), 2)
        self.assertEqual(
            self.service.snapshot()["current_work_context"]["return_point"], "Supporting examples"
        )
        self.now += 5
        await capture("same-app-3", "Supporting examples")
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
