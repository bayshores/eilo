import sys
import types
import unittest
from unittest.mock import patch

from app.chat_context import capture_breakdown, public_context, runtime_context
from app.chat_context_runtime import save_context_breakdown


def _install_anchor(monkeypatch, callback):
    agent = types.ModuleType("agent")
    anchor = types.ModuleType("agent.usage_anchor")
    anchor.anchored_context_tokens = callback
    monkeypatch.setitem(sys.modules, "agent", agent)
    monkeypatch.setitem(sys.modules, "agent.usage_anchor", anchor)


def test_anchor_context_uses_hermes_estimator_and_keeps_cumulative_usage_separate(monkeypatch):
    messages = [{"role": "user", "content": "hello"}]
    observed = {}

    def anchored(actual_messages, anchor):
        observed["messages"] = actual_messages
        observed["anchor"] = anchor
        return 100

    _install_anchor(monkeypatch, anchored)
    result = public_context(
        {
            "messages": messages,
            "model_config": {
                "_usage_anchor": {"prompt_tokens": 90},
                "_eilo_context_breakdown": {
                    "version": 1,
                    "message_count": 1,
                    "categories": [
                        {"id": "system_prompt", "tokens": 20},
                        {"id": "conversation", "tokens": 80},
                    ],
                },
            },
            "input_tokens": 1000,
            "output_tokens": 50,
            "last_active": 123.5,
        },
        window_tokens=200,
        threshold_tokens=250,
    )

    assert observed == {"messages": messages, "anchor": {"prompt_tokens": 90}}
    assert result == {
        "window_tokens": 200,
        "used_tokens": 100,
        "remaining_tokens": 100,
        "percent_used": 50.0,
        "measurement": "estimate",
        "threshold_tokens": 200,
        "usage": {"input_tokens": 1000, "output_tokens": 50},
        "updated_at": 123.5,
        "last_request_tokens": 90,
        "breakdown": {
            "estimated": True,
            "categories": [
                {"id": "system_prompt", "label": "System prompt", "tokens": 20},
                {"id": "conversation", "label": "Conversation", "tokens": 80},
            ],
        },
    }


def test_stale_native_anchor_and_invalid_numbers_are_unavailable(monkeypatch):
    _install_anchor(monkeypatch, lambda messages, anchor: None)
    result = public_context(
        {
            "messages": None,
            "model_config": {"_usage_anchor": {"prompt_tokens": 80}},
            "input_tokens": -1,
            "output_tokens": float("inf"),
            "updated_at": float("nan"),
        },
        window_tokens=-1,
        threshold_tokens=True,
    )

    assert result["measurement"] == "unavailable"
    assert result["used_tokens"] is None
    assert result["usage"] == {"input_tokens": None, "output_tokens": None}
    assert result["updated_at"] is None
    assert result["last_request_tokens"] is None


def test_runtime_context_accepts_only_supplied_or_resolved_limits():
    class Compressor:
        _resolved_context_length = 272000
        _threshold_tokens = 204000

    class Agent:
        context_compressor = Compressor()

    assert runtime_context(None, agent=Agent()) == {
        "window_tokens": 272000,
        "threshold_tokens": 204000,
    }
    assert runtime_context(
        None, runtime={"window_tokens": float("inf"), "threshold_tokens": 0}
    ) == {
        "window_tokens": None,
        "threshold_tokens": None,
    }


def test_breakdown_capture_keeps_known_numbers_and_adds_current_eilo_guidance():
    result = capture_breakdown(
        {
            "categories": [
                {"id": "system_prompt", "tokens": 100, "color": "private"},
                {"id": "rules", "tokens": 20},
                {"id": "conversation", "tokens": 80},
                {"id": "unknown", "tokens": 999},
            ]
        },
        message_count=4,
        rules=("12345",),
    )

    assert result == {
        "version": 1,
        "message_count": 4,
        "categories": [
            {"id": "system_prompt", "tokens": 100},
            {"id": "rules", "tokens": 22},
            {"id": "conversation", "tokens": 80},
        ],
    }


def test_breakdown_capture_fits_estimated_categories_to_provider_usage():
    result = capture_breakdown(
        {
            "context_used": 100,
            "categories": [
                {"id": "system_prompt", "tokens": 30},
                {"id": "conversation", "tokens": 10},
            ],
        },
        message_count=2,
    )

    assert result["categories"] == [
        {"id": "system_prompt", "tokens": 75},
        {"id": "conversation", "tokens": 25},
    ]


def test_runtime_saves_only_the_sanitized_numeric_breakdown(monkeypatch):
    agent_module = types.ModuleType("agent")
    breakdown_module = types.ModuleType("agent.context_breakdown")
    breakdown_module.compute_session_context_breakdown = lambda agent, messages: {
        "context_used": 100,
        "categories": [
            {"id": "system_prompt", "label": "ignored", "tokens": 30},
            {"id": "conversation", "color": "ignored", "tokens": 70},
        ],
    }
    monkeypatch.setitem(sys.modules, "agent", agent_module)
    monkeypatch.setitem(sys.modules, "agent.context_breakdown", breakdown_module)

    class DB:
        def patch_session_model_config(self, session_id, patch):
            self.saved = (session_id, patch)

    db = DB()
    result = save_context_breakdown(db, "session-1", object(), [{}, {}])

    assert sum(category["tokens"] for category in result["categories"]) == 100
    assert db.saved == ("session-1", {"_eilo_context_breakdown": result})


class ContextBreakdownPersistenceTests(unittest.TestCase):
    def test_completed_turn_saves_only_sanitized_numeric_categories(self):
        agent_module = types.ModuleType("agent")
        breakdown_module = types.ModuleType("agent.context_breakdown")
        system_prompt_module = types.ModuleType("agent.system_prompt")
        breakdown_module.compute_session_context_breakdown = lambda agent, messages: {
            "context_used": 100,
            "categories": [
                {"id": "system_prompt", "label": "ignored", "tokens": 60},
                {"id": "conversation", "color": "ignored", "tokens": 70},
            ],
        }
        system_prompt_module.build_system_prompt_parts = lambda agent: {
            "volatile": "<available_skills>1234</available_skills>"
        }

        class DB:
            def patch_session_model_config(self, session_id, saved):
                self.saved = (session_id, saved)

        db = DB()
        with patch.dict(
            sys.modules,
            {
                "agent": agent_module,
                "agent.context_breakdown": breakdown_module,
                "agent.system_prompt": system_prompt_module,
            },
        ):
            result = save_context_breakdown(db, "session-1", object(), [{}, {}])

        self.assertEqual(sum(category["tokens"] for category in result["categories"]), 100)
        self.assertIn("skills", {category["id"] for category in result["categories"]})
        self.assertEqual(db.saved, ("session-1", {"_eilo_context_breakdown": result}))
