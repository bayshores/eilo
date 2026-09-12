"""LocalChat integration boundaries for approval-gated first-workspace setup."""

from __future__ import annotations

import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from app.chat_service import LocalChat
from app.human_driver import InputError, _policy_for_state, validate_input
from app.tasks import TaskConflict

ROOT = Path(__file__).resolve().parents[1]


def goal(title="Solve 100 LeetCode problems"):
    return {
        "op": "add",
        "temp_id": "new_goal",
        "title": title,
        "due_text": "in 3 months",
        "target_count": 100,
        "unit": "problems",
    }


class OnboardingLocalChatTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / ".tmp")
        self.path = Path(self.directory.name) / "pointer.json"
        self.chat = LocalChat(meta_path=self.path)

    async def asyncTearDown(self):
        await self.chat.close()
        self.directory.cleanup()

    def stage(self, operations, request_id="onboarding-stage-001"):
        onboarding = self.chat.meta["onboarding"]
        self.chat.meta.update(
            session_id="fixture-session",
            pending=True,
            pending_turn={
                "request_id": request_id,
                "based_on_revision": onboarding["draft_tasks"]["revision"],
                "onboarding_revision": onboarding["revision"],
            },
        )
        self.chat.save_meta()
        self.chat.stage_publication(
            {
                "session_id": "fixture-session",
                "request_id": request_id,
                "assistant_id": 2,
                "user_id": 1,
                "proposal": {
                    "request_id": request_id,
                    "based_on_revision": onboarding["draft_tasks"]["revision"],
                    "kind": "update",
                    "reply": "",
                    "operations": operations,
                },
            }
        )

    def clear_journal(self):
        candidate = deepcopy(self.chat.meta)
        candidate.update(pending=False, pending_turn=None, pending_publication=None)
        self.chat.commit_meta(candidate)

    async def test_fresh_setup_and_existing_installation_without_setup(self):
        self.assertEqual(self.chat.snapshot()["onboarding"]["status"], "draft")
        legacy = deepcopy(self.chat.meta)
        await self.chat.close()
        legacy.pop("onboarding")
        self.path.write_text(json.dumps(legacy))
        self.chat = LocalChat(meta_path=self.path)
        self.assertNotIn("onboarding", self.chat.meta)
        self.assertIsNone(self.chat.snapshot()["onboarding"])

    async def test_native_stage_reload_refine_and_accept_once(self):
        self.stage(
            [
                goal(),
                {
                    "op": "workspace",
                    "widgets": ["goals", "progress"],
                    "support_source": "browser",
                },
            ]
        )
        self.assertEqual(self.chat.meta["tasks"]["tasks"], [])
        self.assertEqual(self.chat.meta["onboarding"]["status"], "proposed")
        self.assertEqual(self.chat.meta["pending_publication"]["disposition"], "chat")
        self.clear_journal()
        await self.chat.close()
        self.chat = LocalChat(meta_path=self.path)
        draft_id = self.chat.meta["onboarding"]["draft_tasks"]["tasks"][0]["id"]
        self.stage(
            [{"op": "edit", "task_id": draft_id, "title": "Solve 100 selected problems"}],
            "onboarding-refine-001",
        )
        self.assertEqual(len(self.chat.meta["onboarding"]["draft_tasks"]["tasks"]), 1)
        self.clear_journal()
        body = {
            "action": "accept",
            "request_id": "onboarding-accept-001",
            "based_on_revision": self.chat.meta["onboarding"]["revision"],
        }
        before = deepcopy(self.chat.meta)
        with patch("app.chat_service.write_private", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                await self.chat.control_onboarding(body)
        self.assertEqual(self.chat.meta, before)
        accepted = await self.chat.control_onboarding(body)
        self.assertEqual(accepted["onboarding"]["status"], "complete")
        self.assertEqual(len(accepted["tasks"]["tasks"]), 1)
        await self.chat.close()
        self.chat = LocalChat(meta_path=self.path)
        retried = await self.chat.control_onboarding(body)
        self.assertEqual(len(retried["tasks"]["tasks"]), 1)
        self.assertEqual(retried["onboarding"]["acceptance_id"], body["request_id"])

    async def test_rejected_operations_cannot_change_permissions(self):
        before = deepcopy(self.chat.meta["onboarding"])
        self.stage([{"op": "permission", "enabled": True}])
        self.assertEqual(self.chat.meta["onboarding"], before)
        self.assertEqual(self.chat.meta["pending_publication"]["disposition"], "rejected")
        self.assertFalse(self.chat.context.state["enabled"])

    async def test_normal_controls_skip_setup_and_old_lane_still_commits_tasks(self):
        state = await self.chat.control_tasks(
            [goal("Read one chapter")],
            "ordinary-task-001",
            0,
        )
        self.assertEqual(state["onboarding"]["status"], "skipped")
        legacy = deepcopy(self.chat.meta)
        legacy.pop("onboarding")
        self.path.write_text(json.dumps(legacy))
        await self.chat.close()
        self.chat = LocalChat(meta_path=self.path)
        self.chat.meta.update(
            session_id="fixture-session",
            pending=True,
            pending_turn={"request_id": "legacy-stage-001", "based_on_revision": 1},
        )
        self.chat.stage_publication(
            {
                "session_id": "fixture-session",
                "request_id": "legacy-stage-001",
                "assistant_id": 2,
                "user_id": 1,
                "proposal": {
                    "request_id": "legacy-stage-001",
                    "based_on_revision": 1,
                    "kind": "update",
                    "reply": "",
                    "operations": [goal("Legacy ordinary task")],
                },
            }
        )
        self.assertEqual(
            [task["title"] for task in self.chat.meta["tasks"]["tasks"]],
            ["Read one chapter", "Legacy ordinary task"],
        )

    async def test_approval_conflicts_while_journal_is_live(self):
        self.stage([goal()])
        with self.assertRaises(TaskConflict):
            await self.chat.control_onboarding(
                {
                    "action": "accept",
                    "request_id": "onboarding-accept-001",
                    "based_on_revision": self.chat.meta["onboarding"]["revision"],
                }
            )


class OnboardingDriverBoundaryTests(unittest.TestCase):
    def test_driver_accepts_only_narrow_setup_data_and_exposes_draft_policy(self):
        value = {
            "session_id": None,
            "session_title": "eilo-ui-" + "a" * 32,
            "request_id": "onboarding-input-001",
            "text": "I want to solve 100 problems.",
            "task_state": {
                "revision": 0,
                "tasks": [],
                "focus_id": None,
                "break_active": False,
            },
            "onboarding": {
                "widgets": ["goals", "progress"],
                "support_source": "browser",
            },
        }
        self.assertIn("onboarding", validate_input(value))
        self.assertIn(
            "unapproved DRAFT",
            _policy_for_state(value["task_state"], value["request_id"], value["onboarding"]),
        )
        value["onboarding"]["permission"] = True
        with self.assertRaises(InputError):
            validate_input(value)


if __name__ == "__main__":
    unittest.main()
