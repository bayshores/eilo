"""Trash behavior stays task-local and never starts a native/model runtime."""
from copy import deepcopy
import unittest

from app import event_driver, human_driver
from app.tasks import TaskConflict, TaskError, apply_operations, has_open_work, initial_tasks, public_state


def add(temp_id="new_one", title="Read notes", *, target=3, unit="pages"):
    return {"op": "add", "temp_id": temp_id, "title": title, "due_text": "tomorrow",
            "target_count": target, "unit": unit}


class TaskTrashTests(unittest.TestCase):
    def apply(self, state, operations, *, request, revision=None, now=100):
        return apply_operations(
            state, operations, based_on_revision=state["revision"] if revision is None else revision,
            request_id=request, source={"kind": "human", "session_id": "fixture"}, now=now,
            id_factory=lambda: "task_one" if not state["tasks"] else "task_two")

    def seeded(self):
        return self.apply(initial_tasks(), [add()], request="request_seed")[0]

    def test_delete_is_atomic_and_clears_focus_without_losing_task_data(self):
        state = self.seeded()
        state, _ = self.apply(state, [{"op": "focus", "task_id": "task_one"}], request="request_focus")
        deleted, _ = self.apply(state, [{"op": "delete", "task_id": "task_one"}], request="request_delete", now=123)
        task = deleted["tasks"][0]
        self.assertEqual(task["status"], "deleted")
        self.assertEqual(task["deleted_from_status"], "open")
        self.assertEqual(task["deleted_at"], 123)
        self.assertEqual((task["title"], task["due_text"], task["target_count"], task["completed_count"], task["unit"]),
                         ("Read notes", "tomorrow", 3, 0, "pages"))
        self.assertIsNone(deleted["focus_id"])
        self.assertFalse(any(task["status"] == "open" for task in deleted["tasks"]))
        self.assertFalse(has_open_work(deleted))
        restored, _ = self.apply(deleted, [{"op": "restore", "task_id": "task_one"}], request="request_restore")
        self.assertEqual((restored["tasks"][0]["status"], restored["focus_id"]), ("open", None))

        before = deepcopy(state)
        with self.assertRaises(TaskError):
            self.apply(state, [{"op": "delete", "task_id": "task_one"},
                               {"op": "edit", "task_id": "task_one", "title": "Nope"}], request="request_atomic")
        self.assertEqual(state, before)

    def test_new_delete_request_preserves_original_status_and_restore_is_exact(self):
        for prior, expected_count in (("open", 0), ("completed", 3), ("cancelled", 0)):
            with self.subTest(prior=prior):
                state = self.seeded()
                if prior == "completed":
                    state, _ = self.apply(state, [{"op": "complete", "task_id": "task_one"}], request="request_complete")
                elif prior == "cancelled":
                    state, _ = self.apply(state, [{"op": "cancel", "task_id": "task_one"}], request="request_cancel")
                deleted, _ = self.apply(state, [{"op": "delete", "task_id": "task_one"}], request="request_delete", now=123)
                repeated, receipt = self.apply(deleted, [{"op": "delete", "task_id": "task_one"}], request="request_delete_again", now=456)
                self.assertEqual(repeated["tasks"][0]["deleted_from_status"], prior)
                self.assertEqual(repeated["tasks"][0]["deleted_at"], 123)
                self.assertIn("already in Trash", receipt)
                restored, _ = self.apply(repeated, [{"op": "restore", "task_id": "task_one"}], request="request_restore")
                task = restored["tasks"][0]
                self.assertEqual((task["status"], task["completed_count"], restored["focus_id"]), (prior, expected_count, None))
                self.assertNotIn("deleted_from_status", task)
                self.assertNotIn("deleted_at", task)

    def test_deleted_task_rejects_every_non_trash_action_and_restore_requires_trash(self):
        state = self.seeded()
        deleted, _ = self.apply(state, [{"op": "delete", "task_id": "task_one"}], request="request_delete")
        invalid = [
            {"op": "edit", "task_id": "task_one", "title": "Nope"},
            {"op": "progress", "task_id": "task_one", "completed_count": 1},
            {"op": "focus", "task_id": "task_one"},
            {"op": "reopen", "task_id": "task_one"},
            {"op": "complete", "task_id": "task_one"},
            {"op": "cancel", "task_id": "task_one"},
        ]
        for index, operation in enumerate(invalid):
            with self.subTest(operation=operation["op"]):
                before = deepcopy(deleted)
                with self.assertRaises(TaskError):
                    self.apply(deleted, [operation], request=f"request_invalid_{index}")
                self.assertEqual(deleted, before)
        with self.assertRaises(TaskError):
            self.apply(state, [{"op": "restore", "task_id": "task_one"}], request="request_not_deleted")

    def test_public_state_excludes_tombstones_and_same_request_and_stale_checks_stay_safe(self):
        state = self.seeded()
        deleted, _ = self.apply(state, [{"op": "delete", "task_id": "task_one"}], request="request_delete")
        published = public_state(deleted)
        self.assertEqual(set(published["tasks"][0]), {"id", "title", "status", "due_text", "target_count", "completed_count", "unit"})
        self.assertEqual(published["tasks"][0]["status"], "deleted")
        duplicate, receipt = self.apply(deleted, [{"op": "restore", "task_id": "task_one"}], request="request_delete")
        self.assertIs(duplicate, deleted)
        self.assertEqual(receipt, "This change is already saved.")
        with self.assertRaises(TaskConflict):
            self.apply(deleted, [{"op": "restore", "task_id": "task_one"}], request="request_stale", revision=0)

    def test_human_and_event_source_contracts_describe_deleted_tasks_without_runtime_work(self):
        self.assertIn('"op":"delete|restore"', human_driver.SYSTEM_POLICY)
        self.assertIn("Never restore a task unless the user explicitly\nasks", human_driver.SYSTEM_POLICY)
        self.assertIn("Deleted tasks are never active work, eligible focus", event_driver.SYSTEM_POLICY)
        state = self.seeded()
        deleted, _ = self.apply(state, [{"op": "delete", "task_id": "task_one"}], request="request_delete")
        event = {"session_id": "fixture-session", "event_id": "event-1", "human_epoch": 0,
                 "observation": {"kind": "activity_unknown"}, "task_state": public_state(deleted)}
        with self.assertRaises(event_driver.InputError):
            event_driver.validate_input(event)
        live, _ = self.apply(deleted, [add("new_two", "Other", target=None, unit=None)], request="request_add")
        admitted = event_driver.validate_input({**event, "task_state": public_state(live)})
        self.assertEqual([task["status"] for task in admitted["task_state"]["tasks"]], ["deleted", "open"])
        self.assertIsNone(admitted["task_state"]["focus_id"])
