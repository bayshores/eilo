"""Explicit user decisions and conservative event admission, never inferred commitments."""

from __future__ import annotations

import hashlib
import json
import re
import time
from urllib.parse import urlsplit

DEFAULT_HOSTS = ("leetcode.com", "neetcode.io", "docs.python.org")
LEASE_SECONDS = 9
SAMPLE_SECONDS = 5
STABLE_SECONDS = 45
HUMAN_GRACE_SECONDS = 120
DECISION_COOLDOWN_SECONDS = 300
MAX_CALLS_HOUR = 3
MAX_CALLS_DAY = 8


def initial_state() -> dict:
    return {
        "allowed_hosts": list(DEFAULT_HOSTS),
        "human_epoch": 0,
        "last_human_at": 0,
        "last_decision_at": 0,
        "call_times": [],
        "events": {},
        "seen_events": [],
        "last_fingerprint": None,
    }


def record_human(state: dict, text: str, request_id: str, now: float | None = None) -> None:
    """Human turns preempt events; validated task transactions own task changes."""
    now = time.time() if now is None else now
    state["human_epoch"] += 1
    state["last_human_at"] = now
    state["last_fingerprint"] = None


def canonical_goal_message(action: str, text: str = "") -> str:
    if (
        action == "set"
        and isinstance(text, str)
        and 0 < len(text.strip()) <= 500
        and "\n" not in text
    ):
        value = text.strip().rstrip(".!? ")
        if value:
            return f"Set my goal to {value}"
    messages = {
        "break": "I'm taking a break.",
        "resume": "Resume my goal.",
        "cancel": "Cancel my goal.",
    }
    if action in messages and not text:
        return messages[action]
    raise ValueError("Choose a goal of 1–500 characters or a goal control.")


def normalize_host(host: str) -> str:
    if not isinstance(host, str) or len(host) > 253:
        raise ValueError("Use an exact website hostname.")
    host = host.strip().lower().rstrip(".")
    if not re.fullmatch(
        r"(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", host
    ):
        raise ValueError("Use an exact website hostname, without a path or wildcard.")
    return host


def sanitize_observation(raw: dict, allowed_hosts: list[str]) -> dict:
    """Validate already minimized browser IPC; raw URLs/titles never enter a log by default."""
    invalid = {"kind": "activity_invalid"}
    if (
        isinstance(raw, dict)
        and set(raw) == {"kind"}
        and raw["kind"] in ("activity_unshared", "activity_unknown")
    ):
        return dict(raw)
    if (
        not isinstance(raw, dict)
        or set(raw) != {"kind", "origin", "title"}
        or raw.get("kind") != "approved_study_context"
    ):
        return invalid
    origin, title = raw.get("origin"), raw.get("title")
    if not isinstance(origin, str) or not isinstance(title, str):
        return invalid
    try:
        parsed = urlsplit(origin)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in allowed_hosts
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path not in ("", "/")
            or parsed.port not in (None, 443)
        ):
            return invalid
    except ValueError:
        return invalid
    # Metadata is still untrusted after minimization. It never mutates task/control state.
    title = " ".join("".join(ch for ch in title if ch.isprintable()).split())[:180]
    return {
        "kind": "approved_study_context",
        "origin": f"https://{parsed.hostname}",
        "title": title,
    }


def fingerprint(observation: dict) -> str:
    return hashlib.sha256(json.dumps(observation, sort_keys=True).encode()).hexdigest()


def admit(
    state: dict,
    observation: dict,
    *,
    now: float,
    stable_since: float,
    lease_active: bool,
    human_busy: bool,
    has_open_work: bool,
) -> tuple[bool, str]:
    if not lease_active or human_busy or not has_open_work:
        return False, "inactive"
    if observation.get("kind") not in (
        "approved_study_context",
        "activity_unshared",
        "activity_unknown",
    ):
        return False, "invalid"
    if now - stable_since < STABLE_SECONDS:
        return False, "settling"
    if now - state["last_human_at"] < HUMAN_GRACE_SECONDS:
        return False, "human_grace"
    if now - state["last_decision_at"] < DECISION_COOLDOWN_SECONDS:
        return False, "cooldown"
    if state["last_fingerprint"] == fingerprint(observation):
        return False, "unchanged"
    times = [stamp for stamp in state["call_times"] if now - stamp < 86400]
    if len(times) >= MAX_CALLS_DAY or sum(now - stamp < 3600 for stamp in times) >= MAX_CALLS_HOUR:
        return False, "budget"
    return True, "eligible"


def validate_decision(value: object, event_id: str) -> dict | None:
    if not isinstance(value, dict) or set(value) not in (
        {"event_id", "decision", "message"},
        {"event_id", "decision", "message", "related_task_ids"},
    ):
        return None
    if value["event_id"] != event_id or value["decision"] not in ("quiet", "ask", "check_in"):
        return None
    related = value.get("related_task_ids", [])
    if (
        not isinstance(related, list)
        or len(related) > 32
        or any(
            not isinstance(item, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}", item)
            for item in related
        )
        or len(set(related)) != len(related)
    ):
        return None
    message = value["message"]
    if (
        not isinstance(message, str)
        or len(message) > 400
        or any(ord(ch) < 32 and ch != "\n" for ch in message)
    ):
        return None
    if value["decision"] == "quiet":
        return value if not message else None
    return value if message.strip() else None
