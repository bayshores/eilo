import sys
import types
import unittest
from unittest.mock import patch

from app import event_driver


class FakeDB:
    rows = []
    opened = []

    def __init__(self, *, read_only=False):
        self.read_only = read_only
        self.opened.append(read_only)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def resolve_resume_session_id(self, session_id):
        return "session-tip" if session_id == "session-root" else session_id

    def get_messages(self, session_id, *, include_compacted=False):
        assert session_id == "session-tip"
        assert include_compacted is True
        return [dict(row) for row in self.rows]

    def append_message(self, session_id, **kwargs):
        assert self.read_only is False
        row = {"id": len(self.rows) + 1, "session_id": session_id, **kwargs}
        self.rows.append(row)
        return row["id"]


def publication(event_id="event-1", message="Are you still working on this?"):
    return event_driver.validate_publication(
        {
            "session_id": "session-root",
            "event_id": event_id,
            "task_revision": 3,
            "human_epoch": 7,
            "decision": {"event_id": event_id, "decision": "ask", "message": message},
        }
    )


class EventPublicationTests(unittest.TestCase):
    def setUp(self):
        FakeDB.rows = []
        FakeDB.opened = []
        self.modules = patch.dict(
            sys.modules, {"hermes_state": types.SimpleNamespace(SessionDB=FakeDB)}
        )
        self.modules.start()

    def tearDown(self):
        self.modules.stop()

    def test_double_publish_same_identity_appends_once(self):
        first = event_driver.publish(publication())
        repeated = event_driver.publish(publication())
        self.assertEqual(first, repeated)
        self.assertEqual(len(FakeDB.rows), 1)
        self.assertEqual(FakeDB.rows[0]["display_kind"], "eilo_decision")
        self.assertEqual(FakeDB.rows[0]["display_metadata"]["publication_version"], 2)

    def test_identical_text_with_distinct_events_remains_distinct(self):
        first = event_driver.publish(publication("event-1"))
        second = event_driver.publish(publication("event-2"))
        self.assertNotEqual(first["assistant_id"], second["assistant_id"])
        self.assertEqual(len(FakeDB.rows), 2)

    def test_same_event_with_mismatched_content_or_metadata_is_rejected(self):
        event_driver.publish(publication())
        with self.assertRaises(event_driver.InputError):
            event_driver.publish(publication(message="A different check-in."))
        self.assertEqual(len(FakeDB.rows), 1)
        FakeDB.rows[0]["display_metadata"]["human_epoch"] = 8
        with self.assertRaises(event_driver.InputError):
            event_driver.publish(publication())
        self.assertEqual(len(FakeDB.rows), 1)

    def test_lookup_is_read_only_and_returns_exact_existing_row(self):
        published = event_driver.publish(publication())
        before = list(FakeDB.rows)
        found = event_driver.find_publication(publication())
        missing = event_driver.find_publication(publication("event-2"))
        self.assertEqual(found, published)
        self.assertEqual(missing["assistant_id"], None)
        self.assertEqual(FakeDB.rows, before)
        self.assertEqual(FakeDB.opened[-2:], [True, True])

    def test_invalid_publication_fails_before_a_database_open_or_append(self):
        raw = {
            "session_id": "session-root",
            "event_id": "event-1",
            "task_revision": 3,
            "human_epoch": 7,
            "decision": {"event_id": "event-1", "decision": "quiet", "message": "not quiet"},
        }
        with self.assertRaises(event_driver.InputError):
            event_driver.validate_publication(raw)
        self.assertEqual(FakeDB.opened, [])
        self.assertEqual(FakeDB.rows, [])
