"""Native storage integration; run with the project-local Hermes Python."""

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app import chat_context_runtime, human_driver
from app.runtime_contract import MODEL, visible_messages

try:
    import hermes_state
    from agent.usage_anchor import capture_usage_anchor
except ImportError:
    hermes_state = None


@unittest.skipIf(hermes_state is None, "project-local Hermes runtime required")
class NativeContextTests(unittest.TestCase):
    def setUp(self):
        Path(".tmp").mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=".tmp")
        self.addCleanup(self.temp.cleanup)
        self.env = patch.dict(os.environ, {"HERMES_HOME": self.temp.name})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.path = Path(self.temp.name) / "state.db"
        self.real_db = hermes_state.SessionDB
        path = self.path

        class FixtureDB(self.real_db):
            def __init__(self, **kwargs):
                super().__init__(path, **kwargs)

        self.db_factory = patch.object(hermes_state, "SessionDB", FixtureDB)
        self.db_factory.start()
        self.addCleanup(self.db_factory.stop)
        self.sid = "fixture-context"
        self.title = "eilo-ui-" + "a" * 32
        with self.real_db(self.path) as db:
            db.create_session(self.sid, source="cli", model=MODEL)
            db.set_session_title(self.sid, self.title)
            for index in range(8):
                request = "fixture-request-" + str(index)
                db.append_message(
                    self.sid,
                    role="user",
                    content="Question " + str(index),
                    display_metadata={
                        "lane": "eilo_human",
                        "request_id": request,
                        "based_on_revision": 0,
                    },
                )
                assistant = db.append_message(
                    self.sid,
                    role="assistant",
                    content='{"reply":"raw"}',
                    display_kind="eilo_human_proposal",
                )
                db.set_latest_matching_message_display_kind(
                    self.sid,
                    role="assistant",
                    content='{"reply":"raw"}',
                    display_kind="eilo_human_proposal",
                    display_metadata={
                        "request_id": request,
                        "based_on_revision": 0,
                        "assistant_id": assistant,
                        "published": True,
                        "public_reply": "Reply " + str(index),
                        "disposition": "chat",
                        "provenance": {
                            "version": 1,
                            "task_revision": 0,
                            "sources": [
                                {"source": "conversation", "status": "used"},
                                {"source": "goals", "status": "used"},
                            ],
                        },
                    },
                )
            history = db.get_messages_as_conversation(self.sid)
            db.patch_session_model_config(
                self.sid, {"_usage_anchor": capture_usage_anchor(5000, 100, history[:-1])}
            )
        self.limits = patch.object(
            chat_context_runtime,
            "cached_limits",
            return_value={
                "window_tokens": 272000,
                "threshold_tokens": 204000,
                "compression_enabled": True,
                "window_source": "cached",
            },
        )
        self.limits.start()

    def tearDown(self):
        self.limits.stop()
        self.db_factory.stop()
        self.env.stop()
        self.temp.cleanup()

    def test_native_anchor_and_display_survive_compaction_and_reopen(self):
        before = chat_context_runtime.read_chat(self.title)
        before_visible = visible_messages(before)
        expected = [m["text"] for m in before_visible]
        expected_provenance = [
            message["provenance"] for message in before_visible if "provenance" in message
        ]
        self.assertEqual(len(expected), 16)
        self.assertEqual(before["chat_context"]["used_tokens"], 5100)
        with self.real_db(self.path) as db:
            history = db.get_messages_as_conversation(self.sid, include_row_ids=True)
            summary = {
                "role": "user",
                "content": "Synthetic summary",
                "display_kind": "hidden",
                "_compressed_summary": True,
            }
            db.archive_and_compact(
                self.sid,
                [summary, *history[-4:]],
                tail_count=4,
                model_config_patch={"_usage_anchor": None},
            )
            self.assertLess(len(db.get_messages(self.sid)), 16)
        after = chat_context_runtime.read_chat(self.title)
        after_visible = visible_messages(after)
        self.assertEqual([m["text"] for m in after_visible], expected)
        self.assertEqual(
            [message["provenance"] for message in after_visible if "provenance" in message],
            expected_provenance,
        )
        self.assertIsNone(after["chat_context"]["used_tokens"])
        self.assertNotIn("Synthetic summary", str(visible_messages(after)))

    def test_manual_command_commits_before_reporting_and_keeps_history(self):
        with self.real_db(self.path) as db:
            history = db.get_messages_as_conversation(self.sid, include_row_ids=True)
        closed = []

        def compact(messages, system, **kwargs):
            self.assertTrue(kwargs["force"])
            self.assertEqual(system, chat_context_runtime.SYSTEM_MESSAGE)
            with self.real_db(self.path) as db:
                result = [
                    {"role": "user", "content": "Summary", "display_kind": "hidden"},
                    *messages[-4:],
                ]
                db.archive_and_compact(self.sid, result, tail_count=4)
            return result, system

        agent = SimpleNamespace(
            session_id=self.sid, _compress_context=compact, close=lambda: closed.append(True)
        )
        with patch.object(human_driver, "_runtime_and_agent", return_value=(agent, {})):
            result = chat_context_runtime.compress_chat(self.title)
        self.assertEqual(result["status"], "compressed")
        self.assertTrue(closed)
        self.assertEqual(
            len(visible_messages(chat_context_runtime.read_chat(self.title))), len(history)
        )

    def test_merged_summary_carrier_shows_only_the_original_user_text(self):
        from agent.context_compressor import _SUMMARY_END_MARKER

        before = visible_messages(chat_context_runtime.read_chat(self.title))
        with self.real_db(self.path) as db:
            history = db.get_messages_as_conversation(self.sid, include_row_ids=True)
            user, assistant = history[-2:]
            carrier = {
                **user,
                "_compressed_summary": True,
                "content": "[CONTEXT COMPACTION] Synthetic summary\n"
                + _SUMMARY_END_MARKER
                + "\n"
                + user["content"],
            }
            db.archive_and_compact(self.sid, [carrier, assistant], tail_count=2)
        after = visible_messages(chat_context_runtime.read_chat(self.title))
        self.assertEqual([m["text"] for m in after], [m["text"] for m in before])

    def test_rotated_history_still_shows_the_full_conversation(self):
        before = visible_messages(chat_context_runtime.read_chat(self.title))
        with self.real_db(self.path) as db:
            history = db.get_messages_as_conversation(self.sid, include_row_ids=True)
            db.publish_compression_child(
                parent_session_id=self.sid,
                child_session_id="fixture-child",
                source="cli",
                model=MODEL,
                require_compression_lease=False,
                messages=[
                    {"role": "user", "content": "Synthetic summary", "display_kind": "hidden"},
                    *history[-2:],
                ],
            )
            db.set_session_title("fixture-child", self.title)
        record = chat_context_runtime.read_chat(self.title)
        self.assertEqual(record["id"], "fixture-child")
        self.assertEqual([m["text"] for m in visible_messages(record)], [m["text"] for m in before])

    def test_threshold_and_each_attempt_preserve_the_pinned_route(self):
        from agent.context_compressor import ContextCompressor, take_pinned_summary_route

        percent = ContextCompressor._effective_threshold_percent(272000, 0.5)
        self.assertEqual(ContextCompressor._compute_threshold_tokens(272000, percent), 204000)
        observed = []
        agent = SimpleNamespace(
            _compress_context=lambda *_a, **_k: observed.append(take_pinned_summary_route()),
            base_url="https://chatgpt.com/backend-api/codex",
            api_key="synthetic",
            api_mode="codex_responses",
        )
        chat_context_runtime.bind_summary_route(agent)
        agent._compress_context([])
        agent._compress_context([])
        self.assertEqual([r["model"] for r in observed], [MODEL, MODEL])
        self.assertEqual([r["provider"] for r in observed], ["openai-codex", "openai-codex"])
        self.assertIsNone(take_pinned_summary_route())
