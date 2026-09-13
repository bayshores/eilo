import contextlib
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
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
            "provenance": {
                "version": 1,
                "task_revision": 3,
                "sources": [
                    {"source": "conversation", "status": "used"},
                    {"source": "goals", "status": "used"},
                    {"source": "activity", "status": "used"},
                ],
            },
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

    def test_malformed_provenance_is_rejected_before_publication(self):
        raw = {
            "session_id": "session-root",
            "event_id": "event-1",
            "task_revision": 3,
            "human_epoch": 7,
            "decision": {"event_id": "event-1", "decision": "ask", "message": "Check in?"},
            "provenance": {
                "version": 1,
                "task_revision": 3,
                "sources": [{"source": "activity", "status": "used", "raw_id": "forbidden"}],
            },
        }
        with self.assertRaises(event_driver.InputError):
            event_driver.validate_publication(raw)
        self.assertEqual(FakeDB.rows, [])

    def test_legacy_pending_publication_is_lookup_only(self):
        legacy = {
            "session_id": "session-root",
            "event_id": "event-legacy",
            "task_revision": 3,
            "human_epoch": 7,
            "decision": {
                "event_id": "event-legacy",
                "decision": "ask",
                "message": "Resume this?",
            },
        }
        with self.assertRaises(event_driver.InputError):
            event_driver.validate_publication(legacy)
        normalized = event_driver.validate_publication(legacy, allow_legacy=True)
        FakeDB.rows = [
            {
                "id": 1,
                "session_id": "session-tip",
                "role": "assistant",
                "content": event_driver._publication_content(normalized),
                "display_kind": "eilo_decision",
                "display_metadata": event_driver._publication_metadata(normalized),
            }
        ]
        found = event_driver.find_publication(normalized)
        self.assertEqual(found["assistant_id"], 1)
        self.assertEqual(len(FakeDB.rows), 1)

    def test_cli_find_publication_accepts_legacy_receipt_without_append(self):
        legacy = {
            "session_id": "session-root",
            "event_id": "event-legacy-cli",
            "task_revision": 3,
            "human_epoch": 7,
            "decision": {
                "event_id": "event-legacy-cli",
                "decision": "ask",
                "message": "Resume this?",
            },
        }
        normalized = event_driver.validate_publication(legacy, allow_legacy=True)
        FakeDB.rows = [
            {
                "id": 1,
                "session_id": "session-tip",
                "role": "assistant",
                "content": event_driver._publication_content(normalized),
                "display_kind": "eilo_decision",
                "display_metadata": event_driver._publication_metadata(normalized),
            }
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.json"
            path.write_text(json.dumps(legacy))
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = event_driver.main(["--find-publication", str(path)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.getvalue())["assistant_id"], 1)
        self.assertEqual(len(FakeDB.rows), 1)

    def test_invalid_publication_fails_before_a_database_open_or_append(self):
        raw = {
            "session_id": "session-root",
            "event_id": "event-1",
            "task_revision": 3,
            "human_epoch": 7,
            "decision": {"event_id": "event-1", "decision": "quiet", "message": "not quiet"},
            "provenance": {
                "version": 1,
                "task_revision": 3,
                "sources": [{"source": "activity", "status": "used"}],
            },
        }
        with self.assertRaises(event_driver.InputError):
            event_driver.validate_publication(raw)
        self.assertEqual(FakeDB.opened, [])
        self.assertEqual(FakeDB.rows, [])
