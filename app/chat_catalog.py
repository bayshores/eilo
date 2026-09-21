"""Pure workspace catalog state for felis's local chat metadata.

The catalog deliberately owns only conversation pointers and display metadata.
Goals, tasks, activity, and source permissions remain top-level global state.
"""

from __future__ import annotations

import re
import secrets
from copy import deepcopy
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any

CONVERSATION_KEYS = (
    "title",
    "session_id",
    "started",
    "pending",
    "request_id",
    "accepted_requests",
    "pending_message",
    "pending_turn",
    "pending_publication",
    "workflow_run",
    "context_compaction",
    "accepted_context_requests",
)
_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,79}$")
_NATIVE_TITLE_RE = re.compile(r"^eilo-ui-[0-9a-f]{32}$")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
_CATALOG_KEY = "chat_catalog"
_PROJECT_CAP = 100
_CHAT_CAP = 1000


class CatalogError(ValueError):
    """An expected, safe-to-display catalog control error."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _new_id(kind: str) -> str:
    return f"{kind}-{secrets.token_hex(12)}"


def _legacy_id(meta: dict[str, Any]) -> str:
    source = f"{meta.get('title', '')}|{meta.get('session_id', '')}|{meta.get('started', '')}"
    return "chat-legacy-" + sha256(source.encode("utf-8")).hexdigest()[:16]


def _conversation_defaults(
    title: str | None = None, *, started: bool = False, session_id: str | None = None
) -> dict[str, Any]:
    return {
        "title": title or _default_native_title(),
        "session_id": session_id,
        "started": started,
        "pending": False,
        "request_id": None,
        "accepted_requests": [],
        "pending_message": None,
        "pending_turn": None,
        "pending_publication": None,
        "workflow_run": None,
        "context_compaction": None,
        "accepted_context_requests": [],
    }


def _conversation_from(meta: dict[str, Any]) -> dict[str, Any]:
    conversation = _conversation_defaults()
    for key in CONVERSATION_KEYS:
        if key in meta:
            conversation[key] = deepcopy(meta[key])
    return conversation


def _default_native_title() -> str:
    return "eilo-ui-" + secrets.token_hex(16)


def _validate_text(value: Any, label: str, limit: int) -> str:
    if not isinstance(value, str):
        raise CatalogError(f"{label} must be text.")
    cleaned = value.strip()
    if not cleaned or len(cleaned) > limit or _CONTROL_RE.search(cleaned):
        raise CatalogError(f"{label} must be 1–{limit} visible characters.")
    return cleaned


def _validate_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _ID_RE.fullmatch(value):
        raise CatalogError(f"Invalid {label}.")
    return value


def _assert_allowed_keys(
    body: dict[str, Any], required: set[str], optional: set[str] | None = None
) -> None:
    optional = optional or set()
    if not required.issubset(body) or not set(body).issubset(required | optional):
        raise CatalogError("Invalid control fields.")


def _catalog(meta: dict[str, Any]) -> dict[str, Any]:
    catalog = meta.get(_CATALOG_KEY)
    if not isinstance(catalog, dict):
        raise CatalogError("Chat catalog is unavailable.")
    return catalog


def _find(items: list[dict[str, Any]], item_id: str, label: str) -> dict[str, Any]:
    for item in items:
        if item.get("id") == item_id:
            return item
    raise CatalogError(f"Unknown {label}.")


def _sync_active_from_top_level(meta: dict[str, Any]) -> None:
    catalog = _catalog(meta)
    active = _find(catalog["chats"], catalog["active_chat_id"], "chat")
    current = _conversation_from(meta)
    if current != active["conversation"]:
        active["conversation"] = current
        active["updated_at"] = _now()


def _activate(meta: dict[str, Any], chat: dict[str, Any]) -> None:
    catalog = _catalog(meta)
    catalog["active_chat_id"] = chat["id"]
    for key in CONVERSATION_KEYS:
        meta.pop(key, None)
    meta.update(deepcopy(chat["conversation"]))


def ensure_catalog(meta: dict[str, Any]) -> dict[str, Any]:
    """Return a copied metadata document with its active chat catalog synchronized.

    On first use, the current native conversation becomes one legacy chat.  Calls
    after migration never copy goals, source settings, or task state into chats.
    """
    if not isinstance(meta, dict):
        raise CatalogError("Metadata must be an object.")
    result = deepcopy(meta)
    existing = result.get(_CATALOG_KEY)
    if existing is None:
        timestamp = _now()
        conversation = _conversation_from(result)
        chat = {
            "id": _legacy_id(result),
            "name": "Personal conversation",
            "project_id": None,
            "archived": False,
            "pinned": False,
            "created_at": timestamp,
            "updated_at": timestamp,
            "conversation": conversation,
        }
        result[_CATALOG_KEY] = {
            "revision": 0,
            "active_chat_id": chat["id"],
            "projects": [],
            "chats": [chat],
        }
        _activate(result, chat)
        return result
    # Existing chat libraries predate context controls. Upgrade only the exact
    # previous shape; unknown or malformed state must still fail validation.
    previous_keys = set(CONVERSATION_KEYS) - {"context_compaction", "accepted_context_requests"}
    for chat in existing.get("chats", []) if isinstance(existing.get("chats"), list) else []:
        conversation = chat.get("conversation") if isinstance(chat, dict) else None
        if isinstance(conversation, dict) and set(conversation) == previous_keys:
            conversation.update(context_compaction=None, accepted_context_requests=[])
    _validate_catalog(existing)
    _sync_active_from_top_level(result)
    return result


def _validate_catalog(catalog: dict[str, Any]) -> None:
    if (
        not isinstance(catalog.get("revision"), int)
        or isinstance(catalog["revision"], bool)
        or catalog["revision"] < 0
    ):
        raise CatalogError("Invalid chat catalog.")
    if not isinstance(catalog.get("projects"), list) or not isinstance(catalog.get("chats"), list):
        raise CatalogError("Invalid chat catalog.")
    if len(catalog["projects"]) > _PROJECT_CAP or len(catalog["chats"]) > _CHAT_CAP:
        raise CatalogError("Invalid chat catalog.")
    _validate_id(catalog.get("active_chat_id"), "active chat id")
    project_ids: set[str] = set()
    project_names: set[str] = set()
    for project in catalog["projects"]:
        if not isinstance(project, dict) or set(project) != {"id", "name", "archived"}:
            raise CatalogError("Invalid chat catalog.")
        project_id = _validate_id(project["id"], "project id")
        if project_id in project_ids:
            raise CatalogError("Invalid chat catalog.")
        project_ids.add(project_id)
        name = _validate_text(project["name"], "Project name", 80)
        if name.casefold() in project_names or not isinstance(project["archived"], bool):
            raise CatalogError("Invalid chat catalog.")
        project_names.add(name.casefold())
    chat_ids: set[str] = set()
    for chat in catalog["chats"]:
        if not isinstance(chat, dict) or set(chat) != {
            "id",
            "name",
            "project_id",
            "archived",
            "pinned",
            "created_at",
            "updated_at",
            "conversation",
        }:
            raise CatalogError("Invalid chat catalog.")
        chat_id = _validate_id(chat["id"], "chat id")
        if chat_id in chat_ids:
            raise CatalogError("Invalid chat catalog.")
        chat_ids.add(chat_id)
        _validate_text(chat["name"], "Chat name", 120)
        if chat["project_id"] is not None and chat["project_id"] not in project_ids:
            raise CatalogError("Invalid chat catalog.")
        if not isinstance(chat["archived"], bool) or not isinstance(chat["pinned"], bool):
            raise CatalogError("Invalid chat catalog.")
        if not isinstance(chat["created_at"], str) or not isinstance(chat["updated_at"], str):
            raise CatalogError("Invalid chat catalog.")
        _validate_conversation(chat["conversation"])
    _find(catalog["chats"], catalog["active_chat_id"], "chat")


def _validate_conversation(conversation: Any) -> None:
    if not isinstance(conversation, dict) or set(conversation) != set(CONVERSATION_KEYS):
        raise CatalogError("Invalid chat catalog.")
    title = conversation["title"]
    if not isinstance(title, str) or not _NATIVE_TITLE_RE.fullmatch(title):
        raise CatalogError("Invalid chat catalog.")
    if conversation["session_id"] is not None and not isinstance(conversation["session_id"], str):
        raise CatalogError("Invalid chat catalog.")
    if not isinstance(conversation["started"], bool) or not isinstance(
        conversation["pending"], bool
    ):
        raise CatalogError("Invalid chat catalog.")
    if conversation["request_id"] is not None and not isinstance(conversation["request_id"], str):
        raise CatalogError("Invalid chat catalog.")
    if not isinstance(conversation["accepted_requests"], list) or not all(
        isinstance(item, str) for item in conversation["accepted_requests"]
    ):
        raise CatalogError("Invalid chat catalog.")


def snapshot_catalog(meta: dict[str, Any]) -> dict[str, Any]:
    """Return safe display metadata only, after syncing the active native pointer."""
    current = ensure_catalog(meta)
    catalog = _catalog(current)
    chats = []
    for chat in catalog["chats"]:
        conversation = chat["conversation"]
        chats.append(
            {
                "id": chat["id"],
                "name": chat["name"],
                "project_id": chat["project_id"],
                "archived": chat["archived"],
                "pinned": chat["pinned"],
                "created_at": chat["created_at"],
                "updated_at": chat["updated_at"],
                "session_id": conversation.get("session_id"),
            }
        )
    return {
        "revision": catalog["revision"],
        "active_chat_id": catalog["active_chat_id"],
        "projects": deepcopy(catalog["projects"]),
        "chats": chats,
    }


def apply_catalog(meta: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """Apply one revision-guarded catalog action and return copied metadata."""
    if not isinstance(body, dict) or not isinstance(body.get("action"), str):
        raise CatalogError("Invalid catalog control.")
    result = ensure_catalog(meta)
    catalog = _catalog(result)
    action = body["action"]
    common = {"action", "based_on_revision"}
    fields = {
        "new_chat": (common, {"name", "project_id"}),
        "switch_chat": (common | {"chat_id"}, set()),
        "rename_chat": (common | {"chat_id", "name"}, set()),
        "archive_chat": (common | {"chat_id", "archived"}, set()),
        "pin_chat": (common | {"chat_id", "pinned"}, set()),
        "move_chat": (common | {"chat_id", "project_id"}, set()),
        "create_project": (common | {"name"}, set()),
        "rename_project": (common | {"project_id", "name"}, set()),
        "archive_project": (common | {"project_id", "archived"}, set()),
    }
    if action not in fields:
        raise CatalogError("Unknown catalog action.")
    _assert_allowed_keys(body, *fields[action])
    if type(body["based_on_revision"]) is not int:
        raise CatalogError("Invalid catalog revision.")
    if body["based_on_revision"] != catalog["revision"]:
        raise CatalogError("This workspace changed. Refresh and try again.", status=409)

    changed = False
    timestamp = _now()
    chats = catalog["chats"]
    projects = catalog["projects"]

    if action == "new_chat":
        if len(chats) >= _CHAT_CAP:
            raise CatalogError("Chat limit reached.")
        name = _validate_text(body.get("name", "New chat"), "Chat name", 120)
        project_id = body.get("project_id")
        if project_id is not None:
            project = _find(projects, _validate_id(project_id, "project id"), "project")
            if project["archived"]:
                raise CatalogError("Restore this project before adding chats.")
        chat = {
            "id": _new_id("chat"),
            "name": name,
            "project_id": project_id,
            "archived": False,
            "pinned": False,
            "created_at": timestamp,
            "updated_at": timestamp,
            "conversation": _conversation_defaults(_default_native_title(), started=False),
        }
        chats.append(chat)
        _activate(result, chat)
        changed = True
    elif action == "switch_chat":
        chat = _find(chats, _validate_id(body["chat_id"], "chat id"), "chat")
        if chat["archived"]:
            raise CatalogError("Restore this chat before opening it.")
        if chat["id"] != catalog["active_chat_id"]:
            _activate(result, chat)
            changed = True
    elif action in {"rename_chat", "archive_chat", "pin_chat", "move_chat"}:
        chat = _find(chats, _validate_id(body["chat_id"], "chat id"), "chat")
        if action == "rename_chat":
            value = _validate_text(body["name"], "Chat name", 120)
            if value != chat["name"]:
                chat["name"] = value
                changed = True
        elif action == "archive_chat":
            value = body["archived"]
            if not isinstance(value, bool):
                raise CatalogError("Archived must be true or false.")
            if value and chat["id"] == catalog["active_chat_id"]:
                raise CatalogError("Switch chats before archiving this one.")
            if value != chat["archived"]:
                chat["archived"] = value
                changed = True
        elif action == "pin_chat":
            value = body["pinned"]
            if not isinstance(value, bool):
                raise CatalogError("Pinned must be true or false.")
            if value != chat["pinned"]:
                chat["pinned"] = value
                changed = True
        else:
            project_id = body["project_id"]
            if project_id is not None:
                project = _find(projects, _validate_id(project_id, "project id"), "project")
                if project["archived"]:
                    raise CatalogError("Restore this project before moving chats into it.")
            if project_id != chat["project_id"]:
                chat["project_id"] = project_id
                changed = True
        if changed:
            chat["updated_at"] = timestamp
    elif action == "create_project":
        if len(projects) >= _PROJECT_CAP:
            raise CatalogError("Project limit reached.")
        name = _validate_text(body["name"], "Project name", 80)
        if any(project["name"].casefold() == name.casefold() for project in projects):
            raise CatalogError("A project with that name already exists.")
        projects.append({"id": _new_id("project"), "name": name, "archived": False})
        changed = True
    else:
        project = _find(projects, _validate_id(body["project_id"], "project id"), "project")
        if action == "rename_project":
            name = _validate_text(body["name"], "Project name", 80)
            if any(
                other["id"] != project["id"] and other["name"].casefold() == name.casefold()
                for other in projects
            ):
                raise CatalogError("A project with that name already exists.")
            if name != project["name"]:
                project["name"] = name
                changed = True
        else:
            value = body["archived"]
            if not isinstance(value, bool):
                raise CatalogError("Archived must be true or false.")
            if value != project["archived"]:
                project["archived"] = value
                changed = True

    if changed:
        catalog["revision"] += 1
    return result


def import_sessions(meta: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Add compact historical native-session entries without importing their contents.

    The caller owns any paging, aliases, and collapse policy.  This function only
    accepts an app-owned, strict session-row shape and never activates an import.
    """
    if not isinstance(rows, list):
        raise CatalogError("Invalid session import.")
    result = ensure_catalog(meta)
    catalog = _catalog(result)
    existing_titles = {chat["conversation"]["title"] for chat in catalog["chats"]}
    existing_sessions = {chat["conversation"]["session_id"] for chat in catalog["chats"]}
    additions: list[dict[str, Any]] = []
    renamed = False
    for row in rows:
        if not isinstance(row, dict) or set(row) not in (
            {"id", "title", "created_at", "updated_at", "message_count"},
            {"id", "title", "created_at", "updated_at", "message_count", "name"},
        ):
            raise CatalogError("Invalid session import.")
        session_id = row["id"]
        title = row["title"]
        if (
            not isinstance(session_id, str)
            or not session_id
            or not isinstance(title, str)
            or not _NATIVE_TITLE_RE.fullmatch(title)
            or not isinstance(row["created_at"], str)
            or not isinstance(row["updated_at"], str)
            or not isinstance(row["message_count"], int)
            or isinstance(row["message_count"], bool)
            or row["message_count"] < 0
        ):
            raise CatalogError("Invalid session import.")
        name = _validate_text(row.get("name", "Earlier conversation"), "Chat name", 120)
        if title in existing_titles or session_id in existing_sessions:
            existing = next(
                (
                    c
                    for c in catalog["chats"]
                    if c["conversation"]["title"] == title
                    or c["conversation"]["session_id"] == session_id
                ),
                None,
            )
            if existing and existing["name"] == "Earlier conversation" and name != existing["name"]:
                existing["name"] = name
                renamed = True
            continue
        if len(catalog["chats"]) + len(additions) >= _CHAT_CAP:
            raise CatalogError("Chat limit reached.")
        chat_id = "chat-import-" + sha256(f"{session_id}|{title}".encode()).hexdigest()[:16]
        additions.append(
            {
                "id": chat_id,
                "name": name,
                "project_id": None,
                "archived": False,
                "pinned": False,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "conversation": _conversation_defaults(title, started=True, session_id=session_id),
            }
        )
        existing_titles.add(title)
        existing_sessions.add(session_id)
    if additions or renamed:
        catalog["chats"].extend(additions)
        catalog["revision"] += 1
    return result
