import copy
import unittest

from app.activity_ledger import MAX_CONTROL_RECEIPTS, ActivityLedger
from app.tasks import TaskConflict, TaskError

LEETCODE = {"kind": "approved_study_context", "origin": "https://leetcode.com"}


class ActivityControlTests(unittest.TestCase):
    def ledger(self, state=None):
        identifiers = iter(["session-a", "session-b", "session-c"])
        return ActivityLedger(
            {} if state is None else state, now=lambda: 1000, id_factory=lambda: next(identifiers)
        )

    def plan(self, ledger, action, session_id, request_id, revision, now=100):
        return ledger.plan_control(action, session_id, request_id, revision, now=now)

    def test_trashing_active_closes_at_last_sample_and_next_sample_has_new_id(self):
        ledger = self.ledger()
        ledger.observe(LEETCODE, 10)
        ledger.observe(LEETCODE, 15)
        updated = self.plan(ledger, "trash", "session-a", "trash-a", 0, 20)
        ledger = ActivityLedger(
            {"activity_journal": updated}, now=lambda: 20, id_factory=lambda: "session-b"
        )
        snap = ledger.snapshot(20)
        self.assertIsNone(snap["active_session"])
        self.assertEqual(snap["recent_sessions"], [])
        self.assertEqual(
            (snap["trash_sessions"][0]["end"], snap["trash_sessions"][0]["observed_seconds"]),
            (15, 5),
        )
        ledger.observe(LEETCODE, 25)
        self.assertEqual(ledger.snapshot(25)["active_session"]["id"], "session-b")

    def test_restore_keeps_record_closed_and_totals_exclude_trash(self):
        ledger = self.ledger()
        ledger.observe(LEETCODE, 100)
        ledger.observe(LEETCODE, 106)
        trash = self.plan(ledger, "trash", "session-a", "trash-a", 0, 106)
        trashed_ledger = self.ledger({"activity_journal": trash})
        self.assertEqual(trashed_ledger.snapshot(106)["today_observed_seconds_by_origin"], {})
        restored = self.plan(trashed_ledger, "restore", "session-a", "restore-a", 1, 110)
        restored_ledger = self.ledger({"activity_journal": restored})
        session = restored_ledger.snapshot(110)["recent_sessions"][0]
        self.assertEqual(
            (session["end"], session["last_seen"], session["observed_seconds"]), (106, 106, 6)
        )
        self.assertIsNone(restored_ledger.snapshot(110)["active_session"])
        self.assertEqual(
            restored_ledger.snapshot(110)["today_observed_seconds_by_origin"],
            {"https://leetcode.com": 6},
        )

    def test_restore_does_not_stop_an_unrelated_active_session(self):
        ledger = self.ledger()
        ledger.observe(LEETCODE, 100)
        ledger.journal["sessions"].append(
            {
                "id": "older",
                "origin": "https://leetcode.com",
                "start": 50,
                "end": 55,
                "last_seen": 55,
                "sample_count": 2,
                "observed_seconds": 5,
                "observed_by_utc_day": {},
                "trashed_at": 60,
            }
        )
        updated = self.plan(ledger, "restore", "older", "restore-older", 0, 100)
        self.assertEqual(updated["active"], "session-a")
        self.assertIsNone(
            next(item for item in updated["sessions"] if item["id"] == "older").get("trashed_at")
        )
        self.assertIsNotNone(
            next(item for item in updated["sessions"] if item["id"] == "older")["end"]
        )

    def test_expired_record_is_rejected_without_a_receipt_or_mutation(self):
        state = {
            "activity_journal": {
                "active": None,
                "sessions": [
                    {
                        "id": "expired",
                        "origin": "https://leetcode.com",
                        "start": 0,
                        "end": 0,
                        "last_seen": 0,
                        "sample_count": 1,
                        "observed_seconds": 0,
                        "observed_by_utc_day": {},
                    }
                ],
            }
        }
        ledger = ActivityLedger(state, now=lambda: 1_000, id_factory=lambda: "unused")
        before = copy.deepcopy(ledger.journal)
        with self.assertRaises(TaskError):
            ledger.plan_control("trash", "expired", "expired-request", 0, now=700_000)
        self.assertEqual(ledger.journal, before)
        self.assertFalse(ledger.has_control_receipt("expired-request"))

    def test_unlink_dismisses_association_without_touching_tasks_or_consent(self):
        state = {
            "tasks": {"revision": 7, "tasks": [{"id": "task-1"}]},
            "accountability": {"enabled": True},
        }
        ledger = self.ledger(state)
        ledger.observe(LEETCODE, 100)
        self.assertTrue(ledger.associate("session-a", ["task-1"], 7))
        before = copy.deepcopy({"tasks": state["tasks"], "accountability": state["accountability"]})
        updated = self.plan(ledger, "unlink", "session-a", "unlink-a", 0)
        self.assertEqual(
            {"tasks": state["tasks"], "accountability": state["accountability"]}, before
        )
        updated_ledger = self.ledger({"activity_journal": updated})
        self.assertNotIn("related_task_ids", updated_ledger.snapshot(100)["recent_sessions"][0])
        self.assertFalse(updated_ledger.associate("session-a", ["task-1"], 7))

    def test_trash_stays_within_the_shared_retention_cap(self):
        sessions = [
            {
                "id": f"record-{index}",
                "origin": "https://leetcode.com",
                "start": 1000,
                "end": 1000,
                "last_seen": 1000,
                "sample_count": 1,
                "observed_seconds": 0,
                "observed_by_utc_day": {},
            }
            for index in range(128)
        ]
        state = {"activity_journal": {"active": None, "sessions": sessions}}
        ledger = self.ledger(state)
        updated = self.plan(ledger, "trash", "record-0", "trash-oldest", 0, 1000)
        updated_ledger = self.ledger({"activity_journal": updated})
        snap = updated_ledger.snapshot(1000)
        self.assertEqual(len(snap["recent_sessions"]) + len(snap["trash_sessions"]), 128)
        self.assertEqual(snap["trash_sessions"][0]["id"], "record-0")

    def test_invalid_stale_and_duplicate_requests_are_atomic(self):
        ledger = self.ledger()
        ledger.observe(LEETCODE, 100)
        before = copy.deepcopy(ledger.journal)
        with self.assertRaises(TaskError):
            self.plan(ledger, "trash", "missing", "bad-record", 0)
        with self.assertRaises(TaskConflict):
            self.plan(ledger, "trash", "session-a", "stale", 1)
        self.assertEqual(ledger.journal, before)
        first = self.plan(ledger, "trash", "session-a", "same", 0)
        committed = self.ledger({"activity_journal": first})
        self.assertEqual(committed.plan_control("trash", "session-a", "same", 0, now=999), first)
        with self.assertRaises(TaskConflict):
            committed.plan_control("restore", "session-a", "same", 1, now=999)

    def test_receipts_are_bounded(self):
        state = {
            "activity_journal": {
                "active": None,
                "sessions": [],
                "manual_revision": 0,
                "control_receipts": {
                    f"request-{index}": {"payload": {}} for index in range(MAX_CONTROL_RECEIPTS)
                },
            }
        }
        ledger = self.ledger(state)
        ledger.observe(LEETCODE, 100)
        # Existing receipts are retained only until the next committed control.
        updated = self.plan(ledger, "trash", "session-a", "new-request", 0)
        self.assertEqual(len(updated["control_receipts"]), MAX_CONTROL_RECEIPTS)
        self.assertNotIn("request-0", updated["control_receipts"])


if __name__ == "__main__":
    unittest.main()
