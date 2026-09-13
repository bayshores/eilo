import sys
import types

from app.chat_context import public_context, runtime_context


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
            "model_config": {"_usage_anchor": {"prompt_tokens": 90}},
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
