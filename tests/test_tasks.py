"""Revisioned task projection behavior without native or model work."""
from copy import deepcopy
import unittest

from app.tasks import (TaskConflict, TaskError, apply_operations, initial_tasks,
                       migrate_legacy, public_state)


def add(temp_id, title, *, due=None, target=None, unit=None):
    return {"op": "add", "temp_id": temp_id, "title": title, "due_text": due,
            "target_count": target, "unit": unit}


class TaskProjectionTests(unittest.TestCase):
    def apply(self, state, operations, request="request_000001", revision=None, ids=None):
        identities = iter(ids or ("task_one", "task_two", "task_three"))
        return apply_operations(state, operations, based_on_revision=state["revision"] if revision is None else revision,
                                request_id=request, source={"kind": "human", "session_id": "fixture"}, now=100,
                                id_factory=lambda: next(identities))

    def test_multiple_adds_are_stable_and_can_reference_same_batch(self):
        state, _ = self.apply(initial_tasks(), [add("new_one", "Read notes"), add("new_two", "Solve problem"),
                                                {"op": "focus", "task_id": "new_two"}], ids=("task_a", "task_b"))
        self.assertEqual([task["id"] for task in state["tasks"]], ["task_a", "task_b"])
        self.assertEqual(state["focus_id"], "task_b")
        self.assertEqual(state["revision"], 1)

    def test_add_preserves_existing_tasks_and_focus(self):
        state, _ = self.apply(initial_tasks(), [add("new_one", "Existing"), {"op": "focus", "task_id": "new_one"}], ids=("task_a",))
        updated, _ = self.apply(state, [add("new_two", "Another")], request="request_000002", ids=("task_b",))
        self.assertEqual([task["title"] for task in updated["tasks"]], ["Existing", "Another"])
        self.assertEqual(updated["focus_id"], "task_a")

    def test_edit_progress_lifecycle_focus_and_break(self):
        state, _ = self.apply(initial_tasks(), [add("new_one", "Draft", target=5, unit="pages"),
                                                {"op": "focus", "task_id": "new_one"}], ids=("task_a",))
        state, _ = self.apply(state, [{"op": "edit", "task_id": "task_a", "due_text": "next Friday"},
                                      {"op": "progress", "task_id": "task_a", "completed_count": 2},
                                      {"op": "break", "active": True}], request="request_000002")
        task = state["tasks"][0]
        self.assertEqual((task["due_text"], task["completed_count"], state["break_active"]), ("next Friday", 2, True))
        state, _ = self.apply(state, [{"op": "complete", "task_id": "task_a"}, {"op": "break", "active": False}], request="request_000003")
        self.assertEqual((state["tasks"][0]["status"], state["tasks"][0]["completed_count"], state["focus_id"]), ("completed", 5, None))
        state, _ = self.apply(state, [{"op": "reopen", "task_id": "task_a"}, {"op": "focus", "task_id": "task_a"},
                                      {"op": "cancel", "task_id": "task_a"}], request="request_000004")
        self.assertEqual((state["tasks"][0]["status"], state["focus_id"]), ("cancelled", None))

    def test_invalid_batch_is_all_or_nothing(self):
        state, _ = self.apply(initial_tasks(), [add("new_one", "Kept")], ids=("task_a",))
        before = deepcopy(state)
        invalid_batches = [
            [{"op": "edit", "task_id": "missing", "title": "Nope"}],
            [{"op": "edit", "task_id": "task_a", "unknown": "field"}],
            [{"op": "progress", "task_id": "task_a", "completed_count": -1}],
            [{"op": "progress", "task_id": "task_a", "completed_count": True}],
            [add("new_two", "Would add"), {"op": "focus", "task_id": "missing"}],
        ]
        for index, operations in enumerate(invalid_batches):
            with self.assertRaises(TaskError):
                self.apply(state, operations, request=f"request_bad_{index:03d}")
            self.assertEqual(state, before)

    def test_stale_revision_and_duplicate_request_are_safe(self):
        state, _ = self.apply(initial_tasks(), [add("new_one", "Saved")], request="request_once", ids=("task_a",))
        duplicate, receipt = self.apply(state, [add("new_two", "Ignored")], request="request_once", ids=("task_b",))
        self.assertIs(duplicate, state)
        self.assertEqual(receipt, "This change is already saved.")
        with self.assertRaises(TaskConflict):
            self.apply(state, [add("new_two", "Stale")], request="request_stale", revision=0)

    def test_legacy_migration_keeps_active_and_break_meaning(self):
        active = migrate_legacy({"text": "Finish transfer form", "status": "active", "version": 3, "source_request_id": "old"})
        resting = migrate_legacy({"text": "Finish transfer form", "status": "break", "version": 4})
        self.assertEqual((active["tasks"][0]["title"], active["focus_id"], active["break_active"]),
                         ("Finish transfer form", active["tasks"][0]["id"], False))
        self.assertTrue(resting["break_active"])
        self.assertEqual(public_state(resting)["tasks"][0]["status"], "open")
