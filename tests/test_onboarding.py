"""Approval separation and validation for private onboarding drafts."""

from __future__ import annotations

import unittest
from copy import deepcopy

from app.onboarding import (
    OnboardingError,
    apply_onboarding_command,
    initial_onboarding,
    public_onboarding,
    stage_onboarding,
)
from app.tasks import TaskConflict, TaskError, initial_tasks


def goal(title="Solve 100 problems", target=100):
    return {
        "op": "add",
        "temp_id": "new_goal",
        "title": title,
        "due_text": "in 3 months",
        "target_count": target,
        "unit": "problems",
    }


class OnboardingTests(unittest.TestCase):
    def setUp(self):
        self.tasks = initial_tasks()
        self.state = initial_onboarding(self.tasks)
        self.source = {"kind": "human", "session_id": "fixture"}

    def stage(self, operations, request="stage-request-001", revision=None):
        return stage_onboarding(
            self.state,
            operations,
            request_id=request,
            based_on_revision=self.state["revision"] if revision is None else revision,
            source=self.source,
        )

    def test_draft_does_not_change_goals_until_acceptance(self):
        proposed = self.stage([goal()])
        self.assertEqual(self.tasks["tasks"], [])
        self.assertEqual(proposed["status"], "proposed")
        self.assertEqual(
            public_onboarding(proposed)["proposal"]["tasks"][0]["title"], "Solve 100 problems"
        )
        accepted, tasks = apply_onboarding_command(
            proposed,
            self.tasks,
            {"action": "accept", "request_id": "accept-request-001", "based_on_revision": 1},
        )
        self.assertEqual(accepted["status"], "complete")
        self.assertEqual(tasks["tasks"][0]["title"], "Solve 100 problems")
        self.assertGreaterEqual(tasks["revision"], 1)

    def test_batch_validation_and_permission_rejection_leave_state_alone(self):
        before = deepcopy(self.state)
        with self.assertRaises(TaskError):
            self.stage(
                [
                    goal(),
                    {
                        "op": "workspace",
                        "widgets": ["goals"],
                        "support_source": "browser",
                        "permission": True,
                    },
                ]
            )
        self.assertEqual(self.state, before)
        with self.assertRaises(TaskError):
            self.stage([{"op": "permission", "enabled": True}], request="bad-permission-001")
        self.assertEqual(self.state, before)

    def test_retries_are_idempotent_and_different_reuse_conflicts(self):
        proposed = self.stage([goal()])
        repeated = stage_onboarding(
            proposed,
            [goal()],
            request_id="stage-request-001",
            based_on_revision=0,
            source=self.source,
        )
        self.assertEqual(repeated, proposed)
        with self.assertRaises(TaskConflict):
            stage_onboarding(
                proposed,
                [goal("Another")],
                request_id="stage-request-001",
                based_on_revision=1,
                source=self.source,
            )

    def test_accept_refuses_changed_real_goals(self):
        proposed = self.stage([goal()])
        changed = deepcopy(self.tasks)
        changed["revision"] = 1
        with self.assertRaises(TaskConflict):
            apply_onboarding_command(
                proposed,
                changed,
                {"action": "accept", "request_id": "accept-request-001", "based_on_revision": 1},
            )

    def test_empty_draft_cannot_be_approved_and_count_and_title_are_validated(self):
        with self.assertRaises(OnboardingError):
            apply_onboarding_command(
                self.state,
                self.tasks,
                {"action": "accept", "request_id": "accept-empty-001", "based_on_revision": 0},
            )
        before = deepcopy(self.state)
        with self.assertRaises(TaskError):
            self.stage([goal(title=3)])
        self.assertEqual(self.state, before)
        with self.assertRaises(TaskError):
            self.stage([goal(target=True)])
        self.assertEqual(self.state, before)

    def test_default_progress_widget_and_support_actions_do_not_change_permissions_or_tasks(self):
        proposed = self.stage([goal()])
        self.assertEqual(proposed["widgets"], ["goals", "progress"])
        complete, tasks = apply_onboarding_command(
            proposed,
            self.tasks,
            {"action": "accept", "request_id": "accept-request-001", "based_on_revision": 1},
        )
        dismissed, unchanged = apply_onboarding_command(
            complete,
            tasks,
            {
                "action": "dismiss_support",
                "request_id": "dismiss-request-001",
                "based_on_revision": 2,
            },
        )
        self.assertEqual(dismissed["support_status"], "dismissed")
        self.assertEqual(unchanged, tasks)

    def test_malformed_boundary_values_are_safe_errors(self):
        cases = (
            ([{"op": "workspace", "widgets": [["goals"]], "support_source": None}], TaskError),
            ([{"op": "workspace", "widgets": ["goals"], "support_source": []}], TaskError),
        )
        for operations, error in cases:
            with self.subTest(operations=operations), self.assertRaises(error):
                self.stage(operations)
        for action in ([], {"accept"}):
            with self.subTest(action=action), self.assertRaises(OnboardingError):
                apply_onboarding_command(
                    self.state,
                    self.tasks,
                    {
                        "action": action,
                        "request_id": "malformed-action-001",
                        "based_on_revision": 0,
                    },
                )


if __name__ == "__main__":
    unittest.main()
