import copy
import unittest

from app.activity_ledger import ActivityLedger

LEETCODE = {
    "kind": "approved_study_context",
    "origin": "https://leetcode.com",
    "title": "private title",
}
DOCS = {
    "kind": "approved_study_context",
    "origin": "https://docs.python.org",
    "title": "another title",
}
ARBITRARY_HTTP = {
    "kind": "approved_study_context",
    "origin": "http://203.0.113.7:8080",
    "title": "another title",
}


class ActivityLedgerTests(unittest.TestCase):
    def ledger(self, state=None):
        ids = iter(["session-a", "session-b", "session-c"])
        return ActivityLedger(
            {} if state is None else state, now=lambda: 1000, id_factory=lambda: next(ids)
        )

    def test_same_origin_counts_only_bounded_positive_sample_gaps(self):
        ledger = self.ledger()
        ledger.observe(LEETCODE, 100)
        ledger.observe(LEETCODE, 100)
        ledger.observe(LEETCODE, 106)
        ledger.observe(LEETCODE, 104)
        session = ledger.snapshot(106)["active_session"]
        self.assertEqual(
            (session["sample_count"], session["observed_seconds"], session["last_seen"]),
            (4, 6, 106),
        )
        self.assertNotIn("title", session)

    def test_long_gap_source_switch_and_unknown_close_at_last_seen(self):
        ledger = self.ledger()
        ledger.observe(LEETCODE, 10)
        ledger.observe(LEETCODE, 15)
        ledger.observe(LEETCODE, 28)  # 13 seconds: a new session, no inferred gap.
        ledger.observe(DOCS, 32)
        ledger.observe({"kind": "activity_unshared"}, 40)
        sessions = ledger.snapshot(40)["recent_sessions"]
        self.assertEqual(
            [
                (item["origin"], item["start"], item["end"], item["observed_seconds"])
                for item in sessions
            ],
            [
                ("https://leetcode.com", 10, 15, 5),
                ("https://leetcode.com", 28, 28, 0),
                ("https://docs.python.org", 32, 32, 0),
            ],
        )
        self.assertIsNone(ledger.snapshot(40)["active_session"])

    def test_any_valid_canonical_origin_opens_a_record_without_title(self):
        ledger = self.ledger()
        ledger.observe(ARBITRARY_HTTP, 10)
        session = ledger.snapshot(10)["active_session"]
        self.assertEqual(session["origin"], "http://203.0.113.7:8080")
        self.assertNotIn("title", session)

    def test_restart_closes_restored_active_without_wall_clock_duration(self):
        state = {}
        first = self.ledger(state)
        first.observe(LEETCODE, 100)
        restarted = ActivityLedger(state, now=lambda: 999, id_factory=lambda: "unused")
        session = restarted.snapshot(999)["recent_sessions"][0]
        self.assertEqual((session["end"], session["observed_seconds"]), (100, 0))
        self.assertIsNone(restarted.snapshot(999)["active_session"])

    def test_snapshot_is_read_only_and_uses_utc_day_totals(self):
        ledger = self.ledger()
        ledger.observe(LEETCODE, 86_399)
        ledger.observe(LEETCODE, 86_405)
        before = copy.deepcopy(ledger.state)
        snap = ledger.snapshot(86_405)
        self.assertEqual(snap["timezone"], "UTC")
        self.assertEqual(snap["today_observed_seconds_by_origin"], {"https://leetcode.com": 5})
        self.assertEqual(
            snap["usage"]["days"][-2:],
            [
                {"date": "1970-01-01", "observed_seconds": 1},
                {"date": "1970-01-02", "observed_seconds": 5},
            ],
        )
        self.assertEqual(ledger.state, before)

    def test_usage_summarizes_only_retained_nontrashed_buckets_for_seven_utc_days(self):
        now = 9 * 86_400 + 3_600
        days = [
            "1970-01-04",
            "1970-01-05",
            "1970-01-06",
            "1970-01-07",
            "1970-01-08",
            "1970-01-09",
            "1970-01-10",
        ]
        state = {
            "activity_journal": {
                "active": None,
                "sessions": [
                    {
                        "id": "a",
                        "origin": "https://alpha.example",
                        "start": now - 100,
                        "end": now - 50,
                        "last_seen": now - 50,
                        "sample_count": 4,
                        "observed_seconds": 12,
                        "observed_by_utc_day": {days[1]: 8, days[-1]: 4},
                    },
                    {
                        "id": "b",
                        "origin": "https://beta.example",
                        "start": now - 100,
                        "end": now - 50,
                        "last_seen": now - 50,
                        "sample_count": 4,
                        "observed_seconds": 20,
                        "observed_by_utc_day": {days[0]: 6, days[-1]: 10},
                    },
                    {
                        "id": "trash",
                        "origin": "https://discarded.example",
                        "start": now - 100,
                        "end": now - 50,
                        "last_seen": now - 50,
                        "sample_count": 4,
                        "observed_seconds": 99,
                        "observed_by_utc_day": {days[-1]: 99},
                        "trashed_at": now,
                    },
                    {
                        "id": "corrupt-buckets",
                        "origin": "https://corrupt.example",
                        "start": now - 100,
                        "end": now - 50,
                        "last_seen": now - 50,
                        "sample_count": 4,
                        "observed_seconds": 5,
                        "observed_by_utc_day": {
                            days[-1]: 100,
                            "not-a-date": 20,
                            "1970-01-01": 20,
                            days[-2]: -3,
                        },
                    },
                    {
                        "id": "invalid-origin",
                        "origin": "https://bad origin.example",
                        "start": now - 100,
                        "end": now - 50,
                        "last_seen": now - 50,
                        "sample_count": 4,
                        "observed_seconds": 50,
                        "observed_by_utc_day": {days[-1]: 50},
                    },
                ],
            }
        }
        ledger = ActivityLedger(state, now=lambda: now, id_factory=lambda: "new")
        before = copy.deepcopy(state)

        usage = ledger.snapshot(now)["usage"]

        self.assertEqual(usage["timezone"], "UTC")
        self.assertEqual(usage["scope"], "retained_sessions")
        self.assertEqual([item["date"] for item in usage["days"]], days)
        self.assertEqual(
            [item["observed_seconds"] for item in usage["days"]], [6, 8, 0, 0, 0, 0, 19]
        )
        self.assertEqual(
            usage["sites"],
            [
                {"origin": "https://beta.example", "observed_seconds": 16},
                {"origin": "https://alpha.example", "observed_seconds": 12},
                {"origin": "https://corrupt.example", "observed_seconds": 5},
            ],
        )
        self.assertEqual(usage["total_observed_seconds"], 33)
        self.assertNotIn("private title", repr(usage))
        self.assertEqual(state, before)

    def test_associations_are_separate_from_tasks_and_bounded(self):
        state = {"tasks": {"revision": 7, "tasks": [{"id": "task-1", "status": "open"}]}}
        ledger = self.ledger(state)
        ledger.observe(LEETCODE, 100)
        before_tasks = copy.deepcopy(state["tasks"])
        self.assertTrue(ledger.associate("session-a", ["task-1"], 7))
        self.assertFalse(ledger.associate("session-a", ["task-1"] * 33, 7))
        self.assertEqual(state["tasks"], before_tasks)
        session = ledger.snapshot(100)["active_session"]
        self.assertEqual(session["related_task_ids"], ["task-1"])

    def test_retention_caps_old_sessions_at_seven_days_and_128_entries(self):
        state = {
            "activity_journal": {
                "active": None,
                "sessions": [
                    {
                        "id": "old",
                        "origin": "https://leetcode.com",
                        "start": 0,
                        "end": 0,
                        "last_seen": 0,
                        "sample_count": 1,
                        "observed_seconds": 0,
                        "observed_by_utc_day": {},
                    }
                ]
                + [
                    {
                        "id": f"fresh-{index}",
                        "origin": "https://leetcode.com",
                        "start": 700_000,
                        "end": 700_000,
                        "last_seen": 700_000,
                        "sample_count": 1,
                        "observed_seconds": 0,
                        "observed_by_utc_day": {},
                    }
                    for index in range(130)
                ],
            }
        }
        ledger = ActivityLedger(state, now=lambda: 700_000, id_factory=lambda: "new")
        sessions = ledger.snapshot(700_000)["recent_sessions"]
        self.assertEqual(len(sessions), 128)
        self.assertEqual(sessions[0]["id"], "fresh-2")
