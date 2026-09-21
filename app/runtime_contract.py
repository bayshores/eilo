"""Pinned Hermes runtime contract and safe native-record projection."""

from __future__ import annotations

import json

import yaml

from app.accountability import validate_decision
from app.briefing import TOOL_NAMES
from app.errors import ChatError
from app.paths import STATE
from app.runtime_auth import isolate_account

MODEL = "gpt-5.6-luna"
PROVIDER = "openai-codex"


def check_config() -> None:
    """Fail closed if the pinned runtime permits another provider or tools."""
    try:
        isolate_account()
        from hermes_cli.config import load_config
        from hermes_cli.tools_config import _get_platform_tools
        from model_tools import get_tool_definitions

        raw = yaml.safe_load((STATE / "hermes/config.yaml").read_text())
        if raw.get("model", {}).get("default") != MODEL or raw["model"].get("provider") != PROVIDER:
            raise ValueError("model")
        cfg = load_config()
        expected_mcp = {}
        connection_path = STATE / "mcp-connections.json"
        if connection_path.exists():
            saved = json.loads(connection_path.read_text())
            for item in saved.get("servers", []):
                if not item.get("enabled"):
                    continue
                expected_mcp[item["id"]] = (
                    {"url": item["url"]}
                    if item.get("transport") == "http"
                    else {"command": item["command"], "args": item.get("args", [])}
                )
        if cfg.get("fallback_providers") or raw.get("mcp_servers", {}) != expected_mcp:
            raise ValueError("external providers/tools")
        enabled = _get_platform_tools(cfg, "cli", include_default_mcp_servers=False)
        if enabled or get_tool_definitions(enabled_toolsets=list(enabled), quiet_mode=True):
            raise ValueError("tools")
    except Exception as exc:
        raise ChatError(
            "The local configuration needs attention. This chat requires Luna, the Codex subscription, and no default action tools or fallback providers."
        ) from exc


_PROVENANCE_SOURCES = frozenset(
    {"conversation", "goals", "connections", "mail", "calendar", "work_context", "activity"}
)
_PROVENANCE_STATUSES = frozenset({"used", "unavailable", "no_data"})


def validate_provenance(value: object) -> dict | None:
    """Return a minimized, code-authored provenance projection or reject it."""
    if not isinstance(value, dict) or set(value) != {"version", "task_revision", "sources"}:
        return None
    if (
        type(value["version"]) is not int
        or value["version"] != 1
        or type(value["task_revision"]) is not int
        or value["task_revision"] < 0
    ):
        return None
    sources = value["sources"]
    if not isinstance(sources, list) or len(sources) > len(_PROVENANCE_SOURCES):
        return None
    clean, seen = [], set()
    for source in sources:
        if (
            not isinstance(source, dict)
            or set(source) != {"source", "status"}
            or source.get("source") not in _PROVENANCE_SOURCES
            or source.get("status") not in _PROVENANCE_STATUSES
            or source["source"] in seen
        ):
            return None
        seen.add(source["source"])
        clean.append({"source": source["source"], "status": source["status"]})
    return {"version": 1, "task_revision": value["task_revision"], "sources": clean}


def validate_return_decision(value: object, delivery_id: str) -> dict | None:
    """Validate one automatic-return receipt before it reaches native history."""
    if not isinstance(value, dict) or set(value) != {"delivery_id", "decision", "message"}:
        return None
    if value.get("delivery_id") != delivery_id or value.get("decision") not in {"deliver", "quiet"}:
        return None
    message = value.get("message")
    if (
        not isinstance(message, str)
        or len(message) > 1_200
        or any(ord(char) < 32 and char not in "\\n\\t" for char in message)
    ):
        return None
    if value["decision"] == "quiet" and message:
        return None
    if value["decision"] == "deliver" and not message.strip():
        return None
    return {"delivery_id": delivery_id, "decision": value["decision"], "message": message.strip()}


def visible_messages(
    record: dict, events: dict | None = None, returns: dict | None = None
) -> list[dict]:
    """Project audited native history into the small public message shape."""
    messages = []
    current_event = None
    current_human = None
    current_human_revision = None
    for message in record.get("messages", []):
        metadata = message.get("display_metadata") or {}
        if message.get("role") == "assistant" and message.get("display_kind") == "eilo_return":
            delivery_id = metadata.get("delivery_id") if isinstance(metadata, dict) else None
            delivery = (returns or {}).get(delivery_id, {})
            accepted = (
                delivery.get("status") == "delivered"
                and metadata.get("publication_version") == 1
                and metadata.get("return_key") == delivery.get("return_key")
                and metadata.get("reason") == delivery.get("reason")
                and metadata.get("local_day") == delivery.get("local_day")
                and metadata.get("task_revision") == delivery.get("task_revision")
                and metadata.get("human_epoch") == delivery.get("human_epoch")
                and metadata.get("decision") == "deliver"
            )
            try:
                raw_decision = json.loads(message.get("content", "")) if accepted else None
            except (TypeError, ValueError):
                raw_decision = None
            decision = validate_return_decision(raw_decision, delivery_id)
            if decision and decision["decision"] == "deliver":
                projected = {
                    "id": str(message["id"]),
                    "role": "assistant",
                    "text": decision["message"],
                    "origin": "return",
                    "return_id": delivery_id,
                }
                provenance = validate_provenance(metadata.get("provenance"))
                if provenance is not None and provenance["task_revision"] == delivery.get(
                    "task_revision"
                ):
                    projected["provenance"] = provenance
                messages.append(projected)
            continue
        if message.get("display_kind") == "eilo_observation":
            current_event = metadata.get("event_id") if isinstance(metadata, dict) else None
            current_human = None
            continue
        if message.get("role") == "user" and not message.get("display_kind"):
            current_event = None
            current_human = (
                metadata.get("request_id") if metadata.get("lane") == "eilo_human" else None
            )
        if message.get("role") == "user":
            current_human_revision = metadata.get("based_on_revision")
        if message.get("role") == "assistant" and (
            (current_human and message.get("display_kind") != "eilo_decision")
            or message.get("display_kind") == "eilo_human_proposal"
        ):
            if (
                message.get("display_kind") == "eilo_human_proposal"
                and metadata.get("published") is True
                and (
                    str(metadata.get("assistant_id")) == str(message.get("id"))
                    or (
                        current_human
                        and metadata.get("request_id") == current_human
                        and type(current_human_revision) is int
                        and current_human_revision >= 0
                        and metadata.get("based_on_revision") == current_human_revision
                        and metadata.get("disposition")
                        in {"chat", "clarify", "committed", "rejected"}
                    )
                )
                and isinstance(metadata.get("public_reply"), str)
                and metadata["public_reply"].strip()
            ):
                projected = {
                    "id": str(message["id"]),
                    "role": "assistant",
                    "text": metadata["public_reply"],
                }
                provenance = validate_provenance(metadata.get("provenance"))
                if provenance is not None:
                    projected["provenance"] = provenance
                messages.append(projected)
            continue
        if message.get("role") == "assistant" and (
            current_event or message.get("display_kind") == "eilo_decision"
        ):
            event_id = (
                metadata.get("event_id", current_event)
                if isinstance(metadata, dict)
                else current_event
            )
            delivery = (events or {}).get(event_id, {})
            # Hermes may clone a retained row during compaction. The exact accepted
            # event metadata survives; a mutable native row ID is only a locator.
            accepted_identity = (
                metadata.get("publication_version") == 2
                and metadata.get("task_revision") == delivery.get("task_revision")
                and metadata.get("human_epoch") == delivery.get("human_epoch")
            )
            if delivery.get("status") == "delivered" and (
                accepted_identity or str(message.get("id")) == delivery.get("assistant_id")
            ):
                try:
                    decision = validate_decision(json.loads(message.get("content", "")), event_id)
                except (ValueError, TypeError):
                    decision = None
                if decision and decision["decision"] != "quiet":
                    projected = {
                        "id": str(message["id"]),
                        "role": "assistant",
                        "text": decision["message"],
                        "origin": "check_in",
                        "event_id": event_id,
                    }
                    provenance = validate_provenance(metadata.get("provenance"))
                    if provenance is not None:
                        projected["provenance"] = provenance
                    messages.append(projected)
            continue
        if message.get("role") not in ("user", "assistant") or message.get("display_kind"):
            continue
        content = message.get("content")
        if isinstance(content, list):
            content = "\n".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            )
        if isinstance(content, str) and content.strip():
            messages.append(
                {
                    "id": str(message.get("id", len(messages))),
                    "role": message["role"],
                    "text": content,
                }
            )
    return messages


def audit_session(record: dict, expected_id: str | None) -> None:
    """Reject native records that would broaden model, billing, or tool scope."""
    if expected_id and record.get("id") != expected_id:
        raise ValueError("unexpected session")
    if record.get("model") != MODEL or record.get("billing_provider") not in (None, PROVIDER):
        raise ValueError("unapproved model/provider")
    if record.get("billing_mode") not in (None, "subscription_included"):
        raise ValueError("unapproved billing route")
    if type(record.get("tool_call_count")) is not int or record["tool_call_count"] < 0:
        raise ValueError("missing tool audit")
    calls = {}
    for message in record["messages"]:
        tool_calls = message.get("tool_calls") or []
        if isinstance(tool_calls, str):
            tool_calls = json.loads(tool_calls)
        for call in tool_calls:
            name = (call.get("function") or {}).get("name")
            if name not in TOOL_NAMES or not isinstance(call.get("id"), str):
                raise ValueError("unapproved tool activity")
            calls[call["id"]] = name
        if message.get("role") == "tool" and message.get("tool_call_id") not in calls:
            raise ValueError("unmatched tool activity")
        if message.get("tool_name") and message["tool_name"] not in TOOL_NAMES:
            raise ValueError("unapproved tool activity")


def runtime_error(diagnostic: str) -> str:
    """Map native diagnostics to stable, user-safe recovery guidance."""
    diagnostic = diagnostic.lower()
    if any(word in diagnostic for word in ("429", "quota", "rate limit", "usage limit")):
        return "The Codex subscription is currently at a usage limit. Try again after it resets; no other provider was used."
    if any(
        word in diagnostic for word in ("401", "unauthorized", "re-auth", "relogin", "auth_missing")
    ):
        return "Hermes could not use its saved subscription sign-in. The connection needs attention; no new login or fallback was started."
    return "Hermes could not finish that reply. Your saved conversation is still here. Check the connection, then send another message."
