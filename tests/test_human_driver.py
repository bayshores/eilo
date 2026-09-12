"""Human-driver boundary tests: no native session or model calls."""

import sys
import types
import unittest
from unittest.mock import patch

from app import human_driver
from app.tasks import TaskError, validate_proposal


def fixture_input(**changes):
    value = {
        "session_id": "fixture_session",
        "session_title": "eilo-ui-" + "a" * 32,
        "request_id": "request_human_001",
        "text": "Please add review the notes tomorrow",
        "task_state": {"revision": 7, "tasks": [], "focus_id": None, "break_active": False},
    }
    value.update(changes)
    return value


class ValidationTests(unittest.TestCase):
    def test_input_preserves_ordinary_user_text(self):
        text = "Could you add this?\nIt is only a thought."
        result = human_driver.validate_input(fixture_input(text=text))
        self.assertEqual(result["text"], text)

    def test_runtime_binds_new_and_legacy_model_output_to_the_actual_turn(self):
        legacy = '{"request_id":"stale-model-id","based_on_revision":99,"kind":"chat","reply":"Fair. That nudge missed.","operations":[]}'
        compact = '{"kind":"chat","reply":"Fair. That nudge missed.","operations":[]}'
        for raw in (legacy, compact):
            result = human_driver._parse_proposal(raw, request_id="request_human_001", revision=7)
            self.assertEqual(
                result,
                {
                    "request_id": "request_human_001",
                    "based_on_revision": 7,
                    "kind": "chat",
                    "reply": "Fair. That nudge missed.",
                    "operations": [],
                },
            )
        self.assertIsNone(
            human_driver._parse_proposal("not json", request_id="request_human_001", revision=7)
        )

    def test_duplicate_keys_and_extra_fields_cannot_change_the_proposal(self):
        for raw in (
            '{"kind":"chat","kind":"update","reply":"Saved","operations":[]}',
            '{"kind":[],"reply":"Hello","operations":[]}',
            '{"kind":{},"reply":"Hello","operations":[]}',
            '{"kind":"chat","reply":"Hello","operations":[],"unexpected":true}',
        ):
            self.assertIsNone(
                human_driver._parse_proposal(raw, request_id="request_human_001", revision=7)
            )

    def test_app_owned_update_acknowledgment_does_not_require_model_reply(self):
        raw = '{"kind":"update","reply":"","operations":[{"op":"break","active":true}]}'
        proposal = human_driver._parse_proposal(raw, request_id="request_human_001", revision=7)
        self.assertIs(
            validate_proposal(proposal, request_id="request_human_001", revision=7), proposal
        )
        for kind in ("chat", "clarify"):
            invalid = {**proposal, "kind": kind, "operations": []}
            with self.assertRaises(TaskError):
                validate_proposal(invalid, request_id="request_human_001", revision=7)

    def test_work_context_policy_requires_coverage_and_uncertainty(self):
        self.assertIn("where did I leave off", human_driver.SYSTEM_POLICY)
        self.assertIn("coverage explicitly supports", human_driver.SYSTEM_POLICY)


class RuntimeConstructionTests(unittest.TestCase):
    def test_ephemeral_policy_is_passed_to_native_agent_constructor(self):
        constructed = {}

        class FakeAgent:
            def __init__(self, **kwargs):
                constructed.update(kwargs)
                self.model = kwargs["model"]
                self.provider = kwargs["provider"]
                self.tools = []

        fake_runtime = types.SimpleNamespace(
            resolve_runtime_provider=lambda **_kwargs: {"provider": human_driver.PROVIDER}
        )
        with (
            patch.object(human_driver, "isolate_account") as account_boundary,
            patch.dict(
                sys.modules,
                {
                    "hermes_cli.runtime_provider": fake_runtime,
                    "run_agent": types.SimpleNamespace(AIAgent=FakeAgent),
                },
            ),
        ):
            human_driver._runtime_and_agent(
                session_id="fixture_session", ephemeral_system_prompt="request_human_001 revision 7"
            )
        account_boundary.assert_called_once_with()
        self.assertEqual(constructed["ephemeral_system_prompt"], "request_human_001 revision 7")
        self.assertEqual(constructed["model"], human_driver.MODEL)
        self.assertEqual(constructed["provider"], human_driver.PROVIDER)
        self.assertEqual(constructed["enabled_toolsets"], [])


class RunHumanTests(unittest.TestCase):
    def test_native_user_row_and_raw_proposal_are_tagged(self):
        event = human_driver.validate_input(fixture_input())
        raw = (
            '{"request_id":"request_human_001","based_on_revision":7,"kind":"update",'
            '"reply":"Tentative.","operations":[{"op":"add","temp_id":"new_1","title":"Review notes",'
            '"due_text":"tomorrow","target_count":null,"unit":null}]}'
        )

        class FakeDB:
            tagged = None

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def resolve_resume_session_id(self, session_id):
                return session_id

            def get_session_title(self, _session_id):
                return event["session_title"]

            def get_messages_as_conversation(self, *_args, **_kwargs):
                return [
                    {"_row_id": 11, "role": "user", "content": event["text"]},
                    {"_row_id": 12, "role": "assistant", "content": raw},
                ]

            def get_active_message_watermark(self, _session_id):
                return 10

            def set_latest_matching_message_display_kind(self, *args, **kwargs):
                self.tagged = (args, kwargs)
                return True

        class FakeAgent:
            session_id = "fixture_session"

            def run_conversation(self, prompt, **kwargs):
                self.prompt, self.kwargs = prompt, kwargs
                return {"final_response": raw}

            def close(self):
                pass

        fake_db = FakeDB()
        fake_agent = FakeAgent()
        fake_state = types.SimpleNamespace(SessionDB=lambda: fake_db)
        with (
            patch.dict(sys.modules, {"hermes_state": fake_state}),
            patch(
                "app.human_driver._runtime_and_agent",
                return_value=(
                    fake_agent,
                    {
                        "model": human_driver.MODEL,
                        "provider": human_driver.PROVIDER,
                        "tool_schema_count": 0,
                    },
                ),
            ) as runtime,
        ):
            receipt = human_driver.run_human(event)

        self.assertEqual(fake_agent.prompt, event["text"])
        self.assertEqual(fake_agent.kwargs["persist_user_message"], event["text"])
        self.assertEqual(
            fake_agent.kwargs["persist_user_display_metadata"],
            {"request_id": event["request_id"], "based_on_revision": 7, "lane": "eilo_human"},
        )
        ephemeral = runtime.call_args.kwargs["ephemeral_system_prompt"]
        self.assertNotIn(event["request_id"], ephemeral)
        self.assertIn('"revision":7', ephemeral)
        self.assertNotIn(event["request_id"], fake_agent.kwargs["system_message"])
        self.assertEqual(receipt["user_id"], 11)
        self.assertEqual(receipt["assistant_id"], 12)
        self.assertEqual(receipt["proposal"]["kind"], "update")
        self.assertEqual(fake_db.tagged[1]["display_kind"], "eilo_human_proposal")
        self.assertEqual(fake_db.tagged[1]["display_metadata"]["request_id"], event["request_id"])

    def test_malformed_raw_response_is_tagged_but_not_proposed(self):
        event = human_driver.validate_input(fixture_input())

        class FakeDB:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def resolve_resume_session_id(self, session_id):
                return session_id

            def get_session_title(self, _session_id):
                return event["session_title"]

            def get_messages_as_conversation(self, *_args, **_kwargs):
                return [
                    {"_row_id": 2, "role": "user", "content": event["text"]},
                    {"_row_id": 3, "role": "assistant", "content": "broken"},
                ]

            def get_active_message_watermark(self, _session_id):
                return 1

            def set_latest_matching_message_display_kind(self, *_args, **_kwargs):
                return True

        class FakeAgent:
            session_id = "fixture_session"

            def run_conversation(self, *_args, **_kwargs):
                return {"final_response": "broken"}

            def close(self):
                pass

        with (
            patch.dict(sys.modules, {"hermes_state": types.SimpleNamespace(SessionDB=FakeDB)}),
            patch(
                "app.human_driver._runtime_and_agent",
                return_value=(
                    FakeAgent(),
                    {
                        "model": human_driver.MODEL,
                        "provider": human_driver.PROVIDER,
                        "tool_schema_count": 0,
                    },
                ),
            ),
        ):
            receipt = human_driver.run_human(event)
        self.assertIsNone(receipt["proposal"])


class FinalizationTests(unittest.TestCase):
    def test_finalization_updates_only_matching_proposal_and_is_idempotent(self):
        request = {
            "session_id": "fixture_session",
            "session_title": "eilo-ui-" + "a" * 32,
            "request_id": "request_human_001",
            "assistant_id": 12,
            "public_reply": "Added Review notes.",
            "disposition": "committed",
        }
        raw = '{"request_id":"request_human_001","based_on_revision":7,"kind":"update","reply":"Tentative.","operations":[]}'

        class FakeDB:
            def __init__(self):
                self.rows = [
                    {
                        "id": 12,
                        "role": "assistant",
                        "content": raw,
                        "display_kind": "eilo_human_proposal",
                        "display_metadata": {
                            "request_id": request["request_id"],
                            "assistant_id": 12,
                            "based_on_revision": 7,
                        },
                    }
                ]

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def resolve_resume_session_id(self, session_id):
                return session_id

            def get_session_title(self, _session_id):
                return request["session_title"]

            def get_messages(self, _session_id):
                return [dict(row) for row in self.rows]

            def set_latest_matching_message_display_kind(
                self, _session_id, *, role, content, display_kind, display_metadata
            ):
                row = self.rows[-1]
                if row["role"] != role or row["content"] != content:
                    return False
                row["display_kind"] = display_kind
                row["display_metadata"] = dict(display_metadata)
                return True

        fake_db = FakeDB()
        with patch.dict(
            sys.modules, {"hermes_state": types.SimpleNamespace(SessionDB=lambda: fake_db)}
        ):
            receipt = human_driver.finalize_response(human_driver.validate_finalization(request))
            retry = human_driver.finalize_response(human_driver.validate_finalization(request))
        self.assertEqual(receipt, retry)
        self.assertEqual(fake_db.rows[0]["content"], raw)
        self.assertTrue(fake_db.rows[0]["display_metadata"]["published"])
        self.assertEqual(
            fake_db.rows[0]["display_metadata"]["public_reply"], request["public_reply"]
        )

    def test_finalization_rejects_a_different_value_after_publish(self):
        request = {
            "session_id": "fixture_session",
            "session_title": "eilo-ui-" + "a" * 32,
            "request_id": "request_human_001",
            "assistant_id": 12,
            "public_reply": "Saved.",
            "disposition": "chat",
        }

        class FakeDB:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def resolve_resume_session_id(self, session_id):
                return session_id

            def get_session_title(self, _session_id):
                return request["session_title"]

            def get_messages(self, _session_id):
                return [
                    {
                        "id": 12,
                        "role": "assistant",
                        "content": "raw",
                        "display_kind": "eilo_human_proposal",
                        "display_metadata": {
                            "request_id": request["request_id"],
                            "published": True,
                            "public_reply": "Earlier.",
                            "disposition": "chat",
                        },
                    }
                ]

        with patch.dict(sys.modules, {"hermes_state": types.SimpleNamespace(SessionDB=FakeDB)}):
            with self.assertRaises(human_driver.InputError):
                human_driver.finalize_response(human_driver.validate_finalization(request))
