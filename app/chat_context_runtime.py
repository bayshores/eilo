"""Native chat inspection and user-requested compression; no additional tools."""

from __future__ import annotations

import contextlib
import re

from app.paths import STATE
from app.runtime_contract import MODEL, PROVIDER, audit_session

TITLE = re.compile(r"eilo-ui-[a-f0-9]{32}\Z")
SYSTEM_MESSAGE = "You are felis, a personal accountability companion. Follow the current turn's explicit lane instructions and task state."


def read_chat(title):
    """Use the native display projection, never the compressed model history."""
    from hermes_state import SessionDB

    from app.chat_context import public_context

    if not isinstance(title, str) or not TITLE.fullmatch(title):
        raise ValueError("invalid chat title")
    with SessionDB(read_only=True) as db:
        original = db.get_session_by_title(title)
        if not original:
            return {}
        sid = db.resolve_resume_session_id(original["id"])
        record = db.export_session(sid)
        if not record or db.get_session_title(sid) != title:
            raise ValueError("invalid chat identity")
        audit_session(record, sid)
        limits = cached_limits()
        # Use the same native replay shape as Hermes anchor validation.
        active = db.get_messages_as_conversation(sid, repair_alternation=True, include_row_ids=True)
        context = public_context(
            {
                **record,
                "messages": active,
                "model_config": {
                    "_usage_anchor": db.get_session_model_config_value(sid, "_usage_anchor", None),
                    "_eilo_context_breakdown": db.get_session_model_config_value(
                        sid, "_eilo_context_breakdown", None
                    ),
                },
            },
            **{k: limits[k] for k in ("window_tokens", "threshold_tokens")},
        )
        context.update({k: limits[k] for k in ("compression_enabled", "window_source")})
        context["can_compress"] = len(active) >= 6
        display = db.get_messages_as_conversation(
            sid,
            include_ancestors=True,
            include_row_ids=True,
            include_compacted=True,
        )
        # Audit each saved segment before showing its archived messages.
        summary_ids = set()
        for ancestor in db.get_compression_lineage(sid):
            if ancestor != sid:
                audit_session(db.export_session(ancestor), ancestor)
            summary_ids.update(
                row["id"]
                for row in db.get_messages(ancestor, include_compacted=True)
                if row.get("_compressed_summary")
            )
        for row in display:
            if row.get("_row_id") in summary_ids:
                row["_compressed_summary"] = True
        fields = (
            "role",
            "content",
            "display_kind",
            "display_metadata",
            "tool_calls",
            "tool_call_id",
            "tool_name",
            "timestamp",
        )
        display = clean_display(display)
        record["messages"] = [
            {"id": row["_row_id"], **{k: row[k] for k in fields if k in row}}
            for row in display
            if isinstance(row.get("_row_id"), int)
        ]
        record["chat_context"] = context
        # Session model_config can contain private provider settings. Only the
        # numeric context projection crosses this subprocess boundary.
        return {
            key: record.get(key)
            for key in (
                "id",
                "title",
                "model",
                "billing_provider",
                "billing_mode",
                "api_call_count",
                "tool_call_count",
                "message_count",
                "messages",
                "chat_context",
            )
        }


def save_context_breakdown(db, session_id, agent, messages, *, rules=()):
    """Persist numeric category estimates beside the usage anchor for the completed turn."""
    from agent.context_breakdown import compute_session_context_breakdown
    from agent.system_prompt import build_system_prompt_parts

    from app.chat_context import BREAKDOWN_KEY, capture_breakdown

    raw = compute_session_context_breakdown(agent, messages)
    volatile = build_system_prompt_parts(agent).get("volatile", "")
    match = re.search(r"<available_skills>.*?</available_skills>", volatile, re.DOTALL)
    if match:
        skill_tokens = (len(match.group(0)) + 3) // 4
        categories = {
            item.get("id"): dict(item)
            for item in raw.get("categories", [])
            if isinstance(item, dict)
        }
        system = categories.get("system_prompt")
        if system:
            system["tokens"] = max(0, int(system.get("tokens", 0)) - skill_tokens)
        categories["skills"] = {"id": "skills", "tokens": skill_tokens}
        raw = {**raw, "categories": list(categories.values())}
    breakdown = capture_breakdown(
        raw,
        message_count=len(messages),
        rules=tuple(rules),
    )
    if breakdown is not None:
        db.patch_session_model_config(session_id, {BREAKDOWN_KEY: breakdown})
    return breakdown


def compress_chat(title):
    """Compress through Hermes's atomic persistence path, without a chat turn."""
    from agent.model_metadata import estimate_request_tokens_rough
    from hermes_state import SessionDB

    from app.human_driver import _runtime_and_agent

    if not isinstance(title, str) or not TITLE.fullmatch(title):
        raise ValueError("invalid chat title")
    with SessionDB() as db:
        original = db.get_session_by_title(title)
        if not original:
            raise ValueError("missing chat")
        sid = db.resolve_resume_session_id(original["id"])
        audit_session(db.export_session(sid), sid)
        history = db.get_messages_as_conversation(
            sid, repair_alternation=True, include_row_ids=True
        )
        if len(history) < 6:
            return {"session_id": sid, "status": "unchanged"}
        agent, _ = _runtime_and_agent(session_id=sid, session_db=db)
        try:
            before = estimate_request_tokens_rough(
                history, system_prompt=SYSTEM_MESSAGE, tools=None
            )
            compressed, _ = agent._compress_context(
                history, SYSTEM_MESSAGE, approx_tokens=before, task_id=sid, force=True
            )
            active_id = db.resolve_resume_session_id(getattr(agent, "session_id", None) or sid)
            after = db.get_messages_as_conversation(
                active_id, repair_alternation=True, include_row_ids=True
            )
            audit_session(db.export_session(active_id), active_id)
            # A returned draft alone is not proof of a committed compression.
            changed = after != history
            if not changed:
                status = compression_status(agent)
                return {
                    "session_id": active_id,
                    "status": "failed" if status == "failed" else "unchanged",
                }
            return {"session_id": active_id, "status": "compressed"}
        finally:
            with contextlib.suppress(Exception):
                agent.close()


def compression_status(agent):
    """Project native telemetry without exposing diagnostics or model text."""
    telemetry = getattr(
        getattr(agent, "context_compressor", None), "_last_compression_telemetry", None
    )
    if not isinstance(telemetry, dict):
        return "idle"
    if telemetry.get("commit_status") == "committed":
        return "compressed"
    if telemetry.get("failure_class"):
        return "failed"
    return "idle"


def cached_limits():
    """Inspect local limits without constructing an agent or probing a provider."""
    import math

    import yaml
    from agent.context_compressor import ContextCompressor
    from agent.model_metadata import get_cached_context_length

    empty = {
        "window_tokens": None,
        "threshold_tokens": None,
        "compression_enabled": None,
        "window_source": None,
    }
    try:
        config = yaml.safe_load((STATE / "hermes/config.yaml").read_text()) or {}
        compression = config.get("compression") or {}
        window = (config.get("model") or {}).get("context_length")
        source = "configured"
        if type(window) is not int or window <= 0:
            window = get_cached_context_length(MODEL, "https://chatgpt.com/backend-api/codex")
            source = "cached"
        if type(window) is not int or window <= 0:
            return empty
        ratio = float(compression.get("threshold", 0.50))
        if not math.isfinite(ratio) or not 0 < ratio <= 1:
            return empty
        ratio = ContextCompressor._effective_threshold_percent(window, ratio)
        threshold = ContextCompressor._compute_threshold_tokens(window, ratio)
        cap = compression.get("threshold_tokens")
        if type(cap) is int and cap > 0:
            threshold = min(threshold, cap)
        enabled = compression.get("enabled", True) not in (False, "false", "off", 0)
        return {
            "window_tokens": window,
            "threshold_tokens": threshold if enabled else None,
            "compression_enabled": enabled,
            "window_source": source,
        }
    except (OSError, ValueError, TypeError, AttributeError):
        return empty


def clean_display(messages):
    """Unwrap native summary carriers while keeping app-owned display identity."""
    from agent.context_compressor import user_originated_turn_view

    clean = []
    for row in messages:
        if row.get("_compressed_summary") and row.get("role") == "user":
            live = user_originated_turn_view(row)
            if live is None:
                continue
            clean.append(
                {
                    **row,
                    **live,
                    "content": live["content"],
                    "display_kind": None,
                    "display_metadata": row.get("display_metadata"),
                }
            )
        elif row.get("_compressed_summary") and not row.get("display_kind"):
            # Standalone synthetic scaffolding has no human display receipt.
            continue
        else:
            clean.append(row)
    return clean


def bind_summary_route(agent):
    """Pin each compression attempt to the same audited felis provider and model."""
    original = getattr(agent, "_compress_context", None)
    if not callable(original):
        return

    def compress(*args, **kwargs):
        from agent.context_compressor import pin_summary_route

        with pin_summary_route(
            {
                "provider": PROVIDER,
                "model": MODEL,
                "base_url": getattr(agent, "base_url", None),
                "api_key": getattr(agent, "api_key", None),
                "api_mode": getattr(agent, "api_mode", None),
            }
        ):
            return original(*args, **kwargs)

    agent._compress_context = compress
