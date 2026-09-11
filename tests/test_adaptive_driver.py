import base64
import json
import sys
import types
import unittest
from unittest.mock import patch

from app import adaptive_driver


def request(image=None):
    value = {
        "schema_version": 1,
        "request_id": "analysis-1",
        "policy_epoch": 4,
        "evidence": [
            {
                "id": "intent-1",
                "source_id": "conversation",
                "title": "Essay draft",
                "text": "I want to return to the opening paragraph.",
            }
        ],
        "tasks": [{"id": "task-1", "title": "Finish outline", "status": "open"}],
        "prior_context": None,
        "preferences": [],
    }
    if image is not None:
        value["image"] = image
    return value


def proposal(**overrides):
    value = {
        "title": "Essay draft",
        "summary": "The conversation says the opening paragraph is the return point.",
        "return_point": "Opening paragraph",
        "confidence": "explicit",
        "evidence_ids": ["intent-1"],
        "task_ids": ["task-1"],
        "components": [
            {
                "id": "resume-1",
                "kind": "resume",
                "title": "Return point",
                "emphasis": "primary",
                "text": "Return to the opening paragraph.",
            }
        ],
    }
    value.update(overrides)
    return value


class FakeAgent:
    def __init__(self, response):
        self.response = response
        self._persist_disabled = True
        self._session_db = None
        self.calls = []
        self.closed = False

    def run_conversation(self, content, **kwargs):
        self.calls.append((content, kwargs))
        return {"final_response": self.response, "failed": False, "interrupted": False}

    def close(self):
        self.closed = True


class AdaptiveDriverTests(unittest.TestCase):
    def test_valid_request_and_proposal_are_bounded_and_nonpersisting(self):
        agent = FakeAgent(json.dumps(proposal()))
        receipt = adaptive_driver.run_analysis(request(), factory=lambda: agent)
        self.assertEqual(receipt["request_id"], "analysis-1")
        self.assertFalse(receipt["audit"]["persisted"])
        self.assertEqual(receipt["audit"]["tool_schema_count"], 0)
        self.assertTrue(agent.closed)
        content, kwargs = agent.calls[0]
        self.assertEqual(kwargs["conversation_history"], [])
        self.assertEqual(kwargs["system_message"], adaptive_driver.POLICY)
        self.assertNotIn("request_id", json.loads(content))
        self.assertNotIn("policy_epoch", json.loads(content))
        self.assertNotIn("native_history", json.loads(content))

    def test_input_and_response_reject_duplicate_keys_and_extra_fields(self):
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.decode_json('{"schema_version":1,"schema_version":1}')
        bad = request()
        bad["native_history"] = []
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.validate_input(bad)
        bad = request()
        bad["evidence"][0]["style"] = "display:none"
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.validate_input(bad)
        agent = FakeAgent(json.dumps({**proposal(), "action": "send"}))
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.run_analysis(request(), factory=lambda: agent)
        self.assertTrue(agent.closed)

    def test_identifiers_citations_and_explicit_confidence_are_source_bound(self):
        bad = request()
        bad["evidence"][0]["source_id"] = "source id"
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.validate_input(bad)
        bad = request()
        bad["tasks"][0]["id"] = "task id"
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.validate_input(bad)
        for field, value in (("evidence_ids", ["other-evidence"]), ("task_ids", ["other-task"])):
            candidate = proposal(**{field: value})
            with self.subTest(field=field):
                with self.assertRaises(adaptive_driver.AnalysisError):
                    adaptive_driver.validate_proposal(candidate, request())
        observed = request()
        observed["evidence"][0]["source_id"] = "browser"
        candidate = proposal()
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.validate_proposal(candidate, observed)

    def test_proposal_rejects_urls_markup_styles_and_actions(self):
        for field, value in (
            ("text", "https://example.test"),
            ("text", "<b>markup</b>"),
            ("title", "javascript:alert(1)"),
        ):
            candidate = proposal()
            candidate["components"][0][field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaises(adaptive_driver.AnalysisError):
                    adaptive_driver.validate_proposal(candidate, request())
        for key, value in (
            ("style", {"color": "red"}),
            ("action", "open_url"),
            ("url", "https://example.test"),
        ):
            candidate = proposal()
            candidate["components"][0][key] = value
            with self.subTest(key=key):
                with self.assertRaises(adaptive_driver.AnalysisError):
                    adaptive_driver.validate_proposal(candidate, request())

    def test_image_encoding_signature_and_size_are_checked_before_agent_creation(self):
        cases = [
            {"mime_type": "image/gif", "data_base64": "AAAA"},
            {"mime_type": "image/png", "data_base64": "not base64!"},
            {"mime_type": "image/jpeg", "data_base64": base64.b64encode(b"not-a-jpeg").decode()},
            {
                "mime_type": "image/png",
                "data_base64": base64.b64encode(
                    b"\x89PNG\r\n\x1a\n" + b"x" * (adaptive_driver.MAX_IMAGE + 1)
                ).decode(),
            },
        ]
        for image in cases:
            with self.subTest(image=image["mime_type"]):
                with self.assertRaises(adaptive_driver.AnalysisError):
                    adaptive_driver.validate_input(request(image))
        image = adaptive_driver.fixture(True)["image"]
        agent = FakeAgent(json.dumps(proposal()))
        adaptive_driver.run_analysis(request(image), factory=lambda: agent)
        content, _ = agent.calls[0]
        self.assertEqual(content[0]["type"], "text")
        self.assertEqual(
            content[1]["image_url"]["url"],
            f"data:{image['mime_type']};base64,{image['data_base64']}",
        )

    def test_truncated_png_is_rejected_before_agent_creation(self):
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.validate_input(
                request(
                    {
                        "mime_type": "image/png",
                        "data_base64": base64.b64encode(b"\x89PNG\r\n\x1a\n").decode(),
                    }
                )
            )

    def test_prior_context_and_preferences_accept_only_their_narrow_schema(self):
        bad_prior = request()
        bad_prior["prior_context"] = {"title": "Known", "action": "send"}
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.validate_input(bad_prior)
        bad_preference = request()
        bad_preference["preferences"] = [
            {"component_kind": "note", "value": "prefer", "html": "<b>"}
        ]
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.validate_input(bad_preference)

    def test_create_agent_has_no_toolsets_memory_background_or_fallback(self):
        constructed = []

        class ConstructedAgent:
            def __init__(self, **kwargs):
                constructed.append(kwargs)
                self.model = adaptive_driver.MODEL
                self.provider = adaptive_driver.PROVIDER
                self.tools = []

            def close(self):
                pass

        provider = types.ModuleType("hermes_cli.runtime_provider")
        provider.resolve_runtime_provider = lambda **_kwargs: {
            "provider": adaptive_driver.PROVIDER,
            "api_key": "not-used-by-test",
        }
        package = types.ModuleType("hermes_cli")
        package.__path__ = []
        run_agent = types.ModuleType("run_agent")
        run_agent.AIAgent = ConstructedAgent
        with (
            patch.dict(
                sys.modules,
                {
                    "hermes_cli": package,
                    "hermes_cli.runtime_provider": provider,
                    "run_agent": run_agent,
                },
            ),
            patch.object(adaptive_driver, "check_config") as check_config,
        ):
            agent = adaptive_driver.create_agent()
        self.assertTrue(agent._persist_disabled)
        self.assertIsNone(agent._session_db)
        self.assertEqual(len(constructed), 1)
        kwargs = constructed[0]
        self.assertEqual(kwargs["enabled_toolsets"], [])
        self.assertTrue(kwargs["skip_context_files"])
        self.assertTrue(kwargs["skip_memory"])
        self.assertTrue(kwargs["skip_background_review"])
        self.assertIsNone(kwargs["fallback_model"])
        self.assertEqual(kwargs["session_id"], None)
        self.assertEqual(kwargs["session_db"], None)
        check_config.assert_called_once_with()

    def test_persistence_or_tool_results_fail_closed_and_close_agent(self):
        for field, value in (("_persist_disabled", False), ("_session_db", object())):
            agent = FakeAgent(json.dumps(proposal()))
            setattr(agent, field, value)
            with self.subTest(field=field):
                with self.assertRaises(adaptive_driver.AnalysisError):
                    adaptive_driver.run_analysis(request(), factory=lambda value=agent: value)
                self.assertTrue(agent.closed)
        agent = FakeAgent(json.dumps(proposal()))
        agent.run_conversation = lambda *_args, **_kwargs: {
            "final_response": json.dumps(proposal()),
            "tool_calls": ["bad"],
        }
        with self.assertRaises(adaptive_driver.AnalysisError):
            adaptive_driver.run_analysis(request(), factory=lambda: agent)
        self.assertTrue(agent.closed)


if __name__ == "__main__":
    unittest.main()
