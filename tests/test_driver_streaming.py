import io
import json
import sys
import types
import unittest
from unittest.mock import patch

from app import event_driver, human_driver


class FakeDB:
    persisted = []
    opened = []
    append_calls = 0

    def __init__(self, *, read_only=False):
        self.read_only = read_only
        self.opened.append(read_only)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def resolve_resume_session_id(self, value):
        return value

    def get_messages_as_conversation(self, *args, **kwargs):
        return list(self.persisted)

    def get_active_message_watermark(self, *args):
        return 0

    def set_latest_matching_message_display_kind(self, *args, **kwargs):
        return True

    def get_session_title(self, value):
        return "eilo-ui-" + "a" * 32

    def append_message(self, *args, **kwargs):
        type(self).append_calls += 1
        raise AssertionError("event inference must not append native messages")


class FakeAgent:
    def __init__(self, chunks, final):
        self.chunks, self.final, self.session_id = chunks, final, "session-1"

    def run_conversation(self, *args, **kwargs):
        self.kwargs = kwargs
        callback = kwargs.get("stream_callback")
        if callback:
            for chunk in self.chunks:
                callback(chunk)
        return {"final_response": self.final}

    def close(self):
        pass


EVENT = {
    "session_id": "session-1",
    "event_id": "event-1",
    "human_epoch": 0,
    "task_state": {
        "revision": 2,
        "focus_id": "task-1",
        "break_active": False,
        "tasks": [
            {
                "id": "task-1",
                "title": "Practice",
                "status": "open",
                "due_text": None,
                "target_count": None,
                "completed_count": 0,
                "unit": None,
            }
        ],
    },
    "observation": {
        "kind": "approved_study_context",
        "origin": "https://leetcode.com",
        "title": "x",
    },
}
HUMAN = {
    "session_id": "session-1",
    "session_title": "eilo-ui-" + "a" * 32,
    "request_id": "request-1",
    "text": "hello",
    "task_state": {"revision": 2, "tasks": [], "focus_id": None, "break_active": False},
}


class DriverStreamingTests(unittest.TestCase):
    def setUp(self):
        FakeDB.opened = []
        FakeDB.append_calls = 0
        self.modules = patch.dict(
            sys.modules, {"hermes_state": types.SimpleNamespace(SessionDB=FakeDB)}
        )
        self.modules.start()

    def tearDown(self):
        self.modules.stop()

    def test_event_callback_emits_only_decoded_ask_preview_and_preserves_receipt(self):
        final = json.dumps(
            {"event_id": "event-1", "decision": "ask", "message": "Are you still working on this?"}
        )
        FakeDB.persisted = [{"role": "assistant", "content": final, "_row_id": 7}]
        seen = []
        with patch.object(
            event_driver,
            "_runtime_and_agent",
            return_value=(
                FakeAgent(list(final), final),
                {
                    "model": event_driver.MODEL,
                    "provider": event_driver.PROVIDER,
                    "tool_schema_count": 0,
                },
            ),
        ):
            receipt = event_driver.run_event(EVENT, seen.append)
        self.assertEqual(seen[-1], "Are you still working on this?")
        self.assertEqual(receipt["decision"]["decision"], "ask")
        self.assertNotIn("event-1", seen)
        self.assertEqual(receipt["assistant_id"], None)
        self.assertFalse(receipt["audit"]["persisted"])
        self.assertEqual(FakeDB.opened, [True])

    def test_quiet_and_human_update_never_preview(self):
        quiet = json.dumps({"event_id": "event-1", "decision": "quiet", "message": ""})
        FakeDB.persisted = [{"role": "assistant", "content": quiet, "_row_id": 7}]
        seen = []
        with patch.object(
            event_driver,
            "_runtime_and_agent",
            return_value=(
                FakeAgent([quiet], quiet),
                {
                    "model": event_driver.MODEL,
                    "provider": event_driver.PROVIDER,
                    "tool_schema_count": 0,
                },
            ),
        ):
            event_driver.run_event(EVENT, seen.append)
        self.assertEqual(seen, [])
        update = json.dumps(
            {
                "request_id": "request-1",
                "based_on_revision": 2,
                "kind": "update",
                "reply": "Saved",
                "operations": [],
            }
        )
        FakeDB.persisted = [
            {"role": "user", "content": "hello", "_row_id": 6},
            {"role": "assistant", "content": update, "_row_id": 7},
        ]
        with patch.object(
            human_driver,
            "_runtime_and_agent",
            return_value=(
                FakeAgent([update], update),
                {
                    "model": human_driver.MODEL,
                    "provider": human_driver.PROVIDER,
                    "tool_schema_count": 0,
                },
            ),
        ):
            receipt = human_driver.run_human(HUMAN, seen.append)
        self.assertEqual(seen, [])
        self.assertEqual(receipt["proposal"]["kind"], "update")

    def test_event_failures_and_decisions_never_append_to_native_history(self):
        quiet = json.dumps({"event_id": "event-1", "decision": "quiet", "message": ""})
        for result in ({"final_response": quiet}, {"failed": True}):
            agent = FakeAgent([], quiet)
            with (
                patch.object(agent, "run_conversation", return_value=result),
                patch.object(
                    event_driver,
                    "_runtime_and_agent",
                    return_value=(
                        agent,
                        {
                            "model": event_driver.MODEL,
                            "provider": event_driver.PROVIDER,
                            "tool_schema_count": 0,
                        },
                    ),
                ),
            ):
                if result.get("failed"):
                    with self.assertRaises(RuntimeError):
                        event_driver.run_event(EVENT)
                else:
                    receipt = event_driver.run_event(EVENT)
                    self.assertEqual(receipt["decision"]["decision"], "quiet")
        self.assertEqual(FakeDB.append_calls, 0)

    def test_event_history_keeps_published_checkins_and_drops_legacy_event_artifacts(self):
        final = json.dumps({"event_id": "event-1", "decision": "quiet", "message": ""})
        FakeDB.persisted = [
            {"role": "user", "content": "legacy observation", "display_kind": "eilo_observation"},
            {
                "role": "assistant",
                "content": "legacy decision",
                "display_kind": "eilo_decision",
                "display_metadata": {"event_id": "old"},
            },
            {
                "role": "assistant",
                "content": "validated check-in",
                "display_kind": "eilo_decision",
                "display_metadata": {"event_id": "published", "publication_version": 2},
            },
        ]
        agent = FakeAgent([], final)
        with patch.object(
            event_driver,
            "_runtime_and_agent",
            return_value=(
                agent,
                {
                    "model": event_driver.MODEL,
                    "provider": event_driver.PROVIDER,
                    "tool_schema_count": 0,
                },
            ),
        ):
            event_driver.run_event(EVENT)
        history = agent.kwargs["conversation_history"]
        self.assertEqual([message["content"] for message in history], ["validated check-in"])

    def test_stream_cli_writes_preview_then_result_ndjson_without_changing_receipt_shape(self):
        output = io.StringIO()
        with (
            patch.object(event_driver, "_read_event", return_value=EVENT),
            patch.object(
                event_driver,
                "run_event",
                side_effect=lambda event, callback: (callback("Preview"), {"ok": True})[1],
            ),
            patch.object(sys, "stdout", output),
        ):
            self.assertEqual(event_driver.main(["--input", "fixture.json", "--stream"]), 0)
        frames = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(
            frames,
            [{"type": "preview", "text": "Preview"}, {"type": "result", "result": {"ok": True}}],
        )
        plain = io.StringIO()
        with (
            patch.object(event_driver, "_read_event", return_value=EVENT),
            patch.object(event_driver, "run_event", return_value={"ok": True}),
            patch.object(sys, "stdout", plain),
        ):
            self.assertEqual(event_driver.main(["--input", "fixture.json"]), 0)
        self.assertEqual(json.loads(plain.getvalue()), {"ok": True})
        self.assertEqual(event_driver.main(["--stream"]), 2)

    def test_human_chat_stream_belongs_to_the_process_without_a_model_generated_id(self):
        for fields in ({}, {"request_id": "invented-id", "based_on_revision": 99}):
            final = json.dumps(
                {**fields, "kind": "chat", "reply": "That nudge missed.", "operations": []}
            )
            FakeDB.persisted = [
                {"role": "user", "content": "hello", "_row_id": 6},
                {"role": "assistant", "content": final, "_row_id": 7},
            ]
            seen = []
            with patch.object(
                human_driver,
                "_runtime_and_agent",
                return_value=(
                    FakeAgent(list(final), final),
                    {
                        "model": human_driver.MODEL,
                        "provider": human_driver.PROVIDER,
                        "tool_schema_count": 0,
                    },
                ),
            ):
                receipt = human_driver.run_human(HUMAN, seen.append)
            self.assertEqual(seen[-1], "That nudge missed.")
            self.assertEqual(receipt["proposal"]["request_id"], HUMAN["request_id"])
            self.assertEqual(
                receipt["proposal"]["based_on_revision"], HUMAN["task_state"]["revision"]
            )
