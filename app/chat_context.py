"""Read-only chat context metrics."""

from __future__ import annotations

import importlib
import math
from typing import Any

BREAKDOWN_KEY = "_eilo_context_breakdown"
_CATEGORY_LABELS = {
    "system_prompt": "System prompt",
    "tool_definitions": "Tools",
    "rules": "felis guidance",
    "skills": "Skills",
    "mcp": "MCP",
    "subagent_definitions": "Subagents",
    "memory": "Memory",
    "conversation": "Conversation",
}


def _integer(value: Any, *, positive: bool = False) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        result = value
    elif isinstance(value, float) and math.isfinite(value) and value.is_integer():
        result = int(value)
    else:
        return None
    if positive:
        return result if result > 0 else None
    return result if result >= 0 else None


def _object(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _anchored_tokens(messages: list[dict], anchor: Any) -> int | None:
    """Use Hermes's own persisted-anchor validation and delta estimator."""
    try:
        usage_anchor = importlib.import_module("agent.usage_anchor")
        used = usage_anchor.anchored_context_tokens(messages, anchor)
    except Exception:
        return None
    return _integer(used, positive=True)


def runtime_context(record: Any, *, runtime: Any = None, agent: Any = None) -> dict:
    """Return caller-supplied or already-resolved limits without reading configuration."""
    del record
    runtime = _object(runtime)
    compressor = getattr(agent, "context_compressor", None) if agent is not None else None
    return {
        "window_tokens": _integer(
            runtime.get("window_tokens", getattr(compressor, "_resolved_context_length", None)),
            positive=True,
        ),
        "threshold_tokens": _integer(
            runtime.get("threshold_tokens", getattr(compressor, "_threshold_tokens", None)),
            positive=True,
        ),
    }


def _updated_at(record: dict) -> float | int | None:
    for value in (record.get("last_active"), record.get("updated_at"), record.get("ended_at")):
        if (
            not isinstance(value, bool)
            and isinstance(value, (int, float))
            and math.isfinite(value)
            and value >= 0
        ):
            return value
    return None


def capture_breakdown(
    value: Any, *, message_count: int, rules: tuple[str, ...] = ()
) -> dict | None:
    """Keep only bounded numeric attribution from the live runtime."""
    categories = _object(value).get("categories")
    count = _integer(message_count)
    if count is None or not isinstance(categories, list):
        return None
    tokens: dict[str, int] = {}
    for item in categories:
        item = _object(item)
        category = item.get("id")
        amount = _integer(item.get("tokens"), positive=True)
        if category in _CATEGORY_LABELS and amount is not None and amount <= 10_000_000:
            tokens[category] = amount
    rule_tokens = sum((len(text) + 3) // 4 for text in rules if isinstance(text, str))
    if rule_tokens:
        tokens["rules"] = tokens.get("rules", 0) + rule_tokens
    if not tokens:
        return None
    used = _integer(_object(value).get("context_used"), positive=True)
    estimated = sum(tokens.values())
    if used is not None and estimated:
        assigned = 0
        ordered = [category for category in _CATEGORY_LABELS if category in tokens]
        for category in ordered:
            remaining = max(0, used - assigned)
            amount = (
                remaining
                if category == ordered[-1]
                else min(remaining, round(used * tokens[category] / estimated))
            )
            tokens[category] = max(0, amount)
            assigned += tokens[category]
    return {
        "version": 1,
        "message_count": count,
        "categories": [
            {"id": category, "tokens": tokens[category]}
            for category in _CATEGORY_LABELS
            if tokens.get(category)
        ],
    }


def _public_breakdown(value: Any, *, message_count: int, used_tokens: int | None) -> dict | None:
    value = _object(value)
    if (
        value.get("version") != 1
        or _integer(value.get("message_count")) != message_count
        or used_tokens is None
        or not isinstance(value.get("categories"), list)
    ):
        return None
    categories = []
    seen = set()
    for item in value["categories"]:
        item = _object(item)
        category = item.get("id")
        tokens = _integer(item.get("tokens"), positive=True)
        if (
            category not in _CATEGORY_LABELS
            or category in seen
            or tokens is None
            or tokens > 10_000_000
        ):
            return None
        seen.add(category)
        categories.append({"id": category, "label": _CATEGORY_LABELS[category], "tokens": tokens})
    return {"estimated": True, "categories": categories} if categories else None


def public_context(
    record: Any,
    *,
    window_tokens: Any = None,
    threshold_tokens: Any = None,
    model: Any = None,
    provider: Any = None,
) -> dict:
    """Return a safe projection from an already-exported native session."""
    del model, provider
    record = record if isinstance(record, dict) else {}
    raw_messages = record.get("messages")
    messages = (
        [item for item in raw_messages if isinstance(item, dict)]
        if isinstance(raw_messages, list)
        else []
    )
    used = _anchored_tokens(messages, _object(record.get("model_config")).get("_usage_anchor"))
    window = _integer(window_tokens, positive=True)
    threshold = _integer(threshold_tokens, positive=True)
    if window is not None and threshold is not None:
        threshold = min(threshold, window)
    percent = min(100, round(used * 100.0 / window, 1)) if window and used is not None else None
    anchor = _object(_object(record.get("model_config")).get("_usage_anchor"))
    last_request = (
        _integer(anchor.get("prompt_tokens"), positive=True) if used is not None else None
    )
    breakdown = _public_breakdown(
        _object(record.get("model_config")).get(BREAKDOWN_KEY),
        message_count=len(messages),
        used_tokens=used,
    )
    return {
        "window_tokens": window,
        "used_tokens": used,
        "remaining_tokens": max(0, window - used)
        if window is not None and used is not None
        else None,
        "percent_used": percent,
        "measurement": "estimate" if used is not None else "unavailable",
        "threshold_tokens": threshold,
        "usage": {
            "input_tokens": _integer(record.get("input_tokens")),
            "output_tokens": _integer(record.get("output_tokens")),
        },
        "updated_at": _updated_at(record),
        "last_request_tokens": last_request,
        "breakdown": breakdown,
    }
