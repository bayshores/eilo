import json
import sys
import types
import unittest
from unittest.mock import patch

from app import return_driver
from app.runtime_contract import visible_messages
from app.tasks import apply_operations, initial_tasks, public_state

TITLE = "eilo-ui-" + "a" * 32
DELIVERY_ID = "return-" + "a" * 32


def task_state():
    tasks, _ = apply_operations(
        initial_tasks(),
        [
            {
                "op": "add",
                "temp_id": "new_one",
                "title": "Read chapter 4",
                "due_text": "yesterday",
                "due_on": "2026-09-18",
                "target_count": None,
                "unit": None,
            },
            {"op": "focus", "task_id": "new_one"},
        ],
        based_on_revision=0,
        request_id="fixture-request",
        source={"kind": "human"},
        now=1,
        id_factory=lambda: "task-one",
    )
    return public_state(tasks)


def input_value():
    return {
        "session_id": "session-root",
        "session_title": TITLE,
        "delivery_id": DELIVERY_ID,
        "return_key": "return-key-1",
        "reason": "daily",
        "local_day": "2026-09-19",
        "task_state": task_state(),
        "human_epoch": 2,
        "context_bridge": {"url": "http://127.0.0.1:1024/read", "token": "a" * 43},
    }


def publication(message="Your deadline passed. Did you finish it, still want it, or drop it?"):
    return return_driver.validate_publication(
        {
            **{
                key: value
                for key, value in input_value().items()
                if key not in {"context_bridge", "task_state"}
            },
            "task_revision": task_state()["revision"],
            "decision": {
                "delivery_id": DELIVERY_ID,
                "decision": "deliver",
                "message": message,
            },
            "provenance": {
                "version": 1,
                "task_revision": task_state()["revision"],
                "sources": [
                    {"source": "conversation", "status": "used"},
                    {"source": "goals", "status": "used"},
                    {"source": "calendar", "status": "no_data"},
                ],
            },
        }
    )


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

    def get_session_title(self, session_id):
        assert session_id == "session-tip"
        return TITLE

    def get_messages(self, session_id, *, include_compacted=False):
        assert session_id == "session-tip"
        assert include_compacted is True
        return [dict(row) for row in self.rows]

    def get_messages_as_conversation(self, session_id, **kwargs):
        assert self.read_only is True
        assert session_id == "session-tip"
        return [{"role": "user", "content": "Earlier message"}]

    def append_message(self, session_id, **kwargs):
        assert self.read_only is False
        row = {"id": len(self.rows) + 1, "session_id": session_id, **kwargs}
        self.rows.append(row)
        return row["id"]


class ReturnDriverTests(unittest.TestCase):
    def setUp(self):
        FakeDB.rows = []
        FakeDB.opened = []
        self.modules = patch.dict(
            sys.modules, {"hermes_state": types.SimpleNamespace(SessionDB=FakeDB)}
        )
        self.modules.start()

    def tearDown(self):
        self.modules.stop()

    def test_input_accepts_only_an_active_exact_task_packet_and_read_only_bridge(self):
        admitted = return_driver.validate_input(input_value())
        self.assertEqual(admitted["task_state"]["tasks"][0]["title"], "Read chapter 4")
        self.assertEqual(admitted["reason"], "daily")
        for changed in (
            {"reason": "surprise"},
            {"local_day": "not-a-date"},
            {"context_bridge": {"url": "http://example.test/read", "token": "a" * 43}},
            {"task_state": {**task_state(), "break_active": True}},
            {"delivery_id": "wrong spaces"},
        ):
            with self.assertRaises(return_driver.InputError):
                return_driver.validate_input({**input_value(), **changed})

    def test_malformed_decisions_fail_closed_to_quiet(self):
        self.assertEqual(
            return_driver._decision(
                {"delivery_id": DELIVERY_ID, "decision": "quiet", "message": "not quiet"},
                DELIVERY_ID,
            ),
            {"delivery_id": DELIVERY_ID, "decision": "quiet", "message": ""},
        )
        self.assertEqual(
            return_driver._decision(
                {"delivery_id": "other", "decision": "deliver", "message": "Hello"}, DELIVERY_ID
            ),
            {"delivery_id": DELIVERY_ID, "decision": "quiet", "message": ""},
        )

    def test_detached_return_reads_history_without_persisting_a_fake_user_message(self):
        class Agent:
            _session_db = None

            def __init__(self):
                self.calls = []

            def run_conversation(self, *args, **kwargs):
                self.calls.append((args, kwargs))
                return {
                    "final_response": json.dumps(
                        {
                            "delivery_id": DELIVERY_ID,
                            "decision": "deliver",
                            "message": "You have one saved goal to review.",
                        }
                    )
                }

            def close(self):
                pass

        agent = Agent()
        with patch(
            "app.return_driver._runtime_and_agent",
            return_value=(
                agent,
                {"model": "gpt-5.6-luna", "provider": "openai-codex", "tool_schema_count": 5},
            ),
        ):
            result = return_driver.run_return(return_driver.validate_input(input_value()))
        self.assertEqual(result["decision"]["decision"], "deliver")
        self.assertNotIn("persist_user_message", agent.calls[0][1])
        self.assertTrue(FakeDB.opened[-1])
        self.assertEqual(
            result["provenance"]["sources"][:2],
            [
                {"source": "conversation", "status": "used"},
                {"source": "goals", "status": "used"},
            ],
        )

    def test_publish_is_idempotent_and_exact(self):
        first = return_driver.publish(publication())
        repeated = return_driver.publish(publication())
        self.assertEqual(first, repeated)
        self.assertEqual(len(FakeDB.rows), 1)
        self.assertEqual(FakeDB.rows[0]["display_kind"], "eilo_return")
        self.assertEqual(FakeDB.rows[0]["display_metadata"]["publication_version"], 1)
        with self.assertRaises(return_driver.InputError):
            return_driver.publish(publication("A different response."))
        self.assertEqual(len(FakeDB.rows), 1)

    def test_lookup_is_read_only_and_only_finds_an_exact_publication(self):
        published = return_driver.publish(publication())
        before = list(FakeDB.rows)
        self.assertEqual(return_driver.find_publication(publication()), published)
        missing = return_driver.validate_publication(
            {
                **publication(),
                "delivery_id": "return-" + "b" * 32,
                "decision": {
                    "delivery_id": "return-" + "b" * 32,
                    "decision": "deliver",
                    "message": "A distinct return.",
                },
            }
        )
        self.assertIsNone(return_driver.find_publication(missing)["assistant_id"])
        self.assertEqual(FakeDB.rows, before)
        self.assertEqual(FakeDB.opened[-2:], [True, True])

    def test_visible_messages_requires_the_matching_delivered_return_event(self):
        saved = publication()
        return_event = {
            "status": "delivered",
            "return_key": saved["return_key"],
            "reason": saved["reason"],
            "local_day": saved["local_day"],
            "task_revision": saved["task_revision"],
            "human_epoch": saved["human_epoch"],
        }
        record = {
            "messages": [
                {
                    "id": 4,
                    "role": "assistant",
                    "content": return_driver._content(saved),
                    "display_kind": "eilo_return",
                    "display_metadata": return_driver._metadata(saved),
                }
            ]
        }
        visible = visible_messages(record, returns={DELIVERY_ID: return_event})
        self.assertEqual(visible[0]["origin"], "return")
        self.assertEqual(visible[0]["text"], saved["decision"]["message"])
        self.assertEqual(visible_messages(record, returns={}), [])


if __name__ == "__main__":
    unittest.main()
