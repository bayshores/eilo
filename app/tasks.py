"""A revisioned projection of explicit decisions; never an alternate chat history."""
from __future__ import annotations

from copy import deepcopy
import json
import re
import time
import uuid


class TaskError(ValueError):
    pass


class TaskConflict(TaskError):
    pass


def initial_tasks() -> dict:
    return {"schema": 1, "revision": 0, "tasks": [], "focus_id": None,
            "break_active": False, "applied_requests": {}}


def public_state(state: dict) -> dict:
    return {"revision": state["revision"], "focus_id": state["focus_id"],
            "break_active": state["break_active"],
            "tasks": [{key: task[key] for key in
                       ("id", "title", "status", "due_text", "target_count", "completed_count", "unit")}
                      for task in state["tasks"]]}


def has_open_work(state: dict) -> bool:
    return not state["break_active"] and any(task["status"] == "open" for task in state["tasks"])


def _text(value, label, maximum, *, nullable=False):
    if value is None and nullable:
        return None
    if (not isinstance(value, str) or not value.strip() or len(value) > maximum
            or any(ord(ch) < 32 or ord(ch) == 127 for ch in value)):
        raise TaskError(f"Use {label} of 1–{maximum} characters.")
    return value.strip()


def _count(value, *, nullable=False, positive=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not (1 if positive else 0) <= value <= 10000:
        raise TaskError("Use a whole-number quantity between 0 and 10,000.")
    return value


def _shape(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= set(value) or set(value) - set(required) - set(optional):
        raise TaskError("That task change is incomplete or contains unsupported fields.")


def apply_operations(state: dict, operations: list, *, based_on_revision: int,
                     request_id: str, source: dict, now=None, id_factory=None) -> tuple[dict, str]:
    """Validate an entire batch, then return a new state. The caller durably commits it.

    A repeated receipt is a no-op. No mutation escapes on any invalid operation,
    conflicting revision, invalid reference, or failed quantity invariant.
    """
    if request_id in state["applied_requests"]:
        return state, "This change is already saved."
    if type(based_on_revision) is not int or based_on_revision != state["revision"]:
        raise TaskConflict("Your tasks changed while this request was being prepared. Review the current list and try again.")
    if not isinstance(operations, list) or not 1 <= len(operations) <= 40:
        raise TaskError("A task update must contain 1–40 supported changes.")
    if source.get("kind") not in ("human", "control", "migration", "reconciliation"):
        raise TaskError("Only an explicit human decision can change tasks.")
    now = time.time() if now is None else now
    id_factory = id_factory or (lambda: "task_" + uuid.uuid4().hex)
    updated = deepcopy(state)
    by_id = {task["id"]: task for task in updated["tasks"]}
    aliases = {}
    acknowledgments = []

    def resolve(reference, *, optional=False):
        if reference is None and optional:
            return None
        if not isinstance(reference, str):
            raise TaskError("Choose an existing task.")
        identity = aliases.get(reference, reference)
        if identity not in by_id:
            raise TaskError("That task is no longer available. Choose it from the current list.")
        return by_id[identity]

    def provenance(task):
        task["updated_at"] = now
        task["last_source"] = {**source, "request_id": request_id}

    def require_available(task):
        if task["status"] == "deleted":
            raise TaskError("Restore this task before changing it.")

    for operation in operations:
        if not isinstance(operation, dict):
            raise TaskError("Invalid task change.")
        name = operation.get("op")
        if name == "add":
            _shape(operation, ("op", "temp_id", "title", "due_text", "target_count", "unit"))
            temp_id = operation["temp_id"]
            if not isinstance(temp_id, str) or not re.fullmatch(r"new_[A-Za-z0-9_]{1,40}", temp_id) or temp_id in aliases:
                raise TaskError("New tasks need distinct temporary references.")
            if len(by_id) >= 500:
                raise TaskError("This workspace has reached its limit of 500 tasks.")
            identity = id_factory()
            if identity in by_id:
                raise TaskError("A task identity could not be safely allocated.")
            task = {"id": identity, "title": _text(operation["title"], "a title", 500),
                    "status": "open", "due_text": _text(operation["due_text"], "deadline wording", 120, nullable=True),
                    "target_count": _count(operation["target_count"], nullable=True, positive=True),
                    "unit": _text(operation["unit"], "a quantity label", 60, nullable=True),
                    "completed_count": 0, "created_at": now, "created_source": {**source, "request_id": request_id}}
            if task["unit"] is not None and task["target_count"] is None:
                raise TaskError("A quantity label needs an explicit target quantity.")
            provenance(task)
            by_id[identity], aliases[temp_id] = task, identity
            updated["tasks"].append(task)
            acknowledgments.append(f'Added “{task["title"]}”' + (f' ({task["due_text"]})' if task["due_text"] else "") + ".")
        elif name == "edit":
            _shape(operation, ("op", "task_id"), ("title", "due_text", "target_count", "unit"))
            if len(operation) == 2:
                raise TaskError("Choose something to change on this task.")
            task = resolve(operation["task_id"])
            require_available(task)
            for key, maximum in (("title", 500), ("due_text", 120), ("unit", 60)):
                if key in operation:
                    task[key] = _text(operation[key], key.replace("_", " "), maximum, nullable=key != "title")
            if "target_count" in operation:
                task["target_count"] = _count(operation["target_count"], nullable=True, positive=True)
            if task["unit"] is not None and task["target_count"] is None:
                raise TaskError("Clear the quantity label when clearing a target quantity.")
            if task["target_count"] is not None and task["completed_count"] > task["target_count"]:
                raise TaskError("The target cannot be smaller than recorded progress. Correct progress first.")
            provenance(task)
            acknowledgments.append(f'Updated “{task["title"]}”.')
        elif name == "focus":
            _shape(operation, ("op", "task_id"))
            task = resolve(operation["task_id"], optional=True)
            if task:
                require_available(task)
            if task and task["status"] != "open":
                raise TaskError("Reopen that task before making it your focus.")
            updated["focus_id"] = task["id"] if task else None
            acknowledgments.append(f'Current focus: “{task["title"]}”.' if task else "Cleared the current focus.")
        elif name in ("complete", "cancel", "reopen"):
            _shape(operation, ("op", "task_id"))
            task = resolve(operation["task_id"])
            require_available(task)
            task["status"] = {"complete": "completed", "cancel": "cancelled", "reopen": "open"}[name]
            if name == "complete" and task["target_count"] is not None:
                task["completed_count"] = task["target_count"]
            if task["status"] != "open" and updated["focus_id"] == task["id"]:
                updated["focus_id"] = None
            provenance(task)
            acknowledgments.append(f'{ {"complete": "Completed", "cancel": "Cancelled", "reopen": "Reopened"}[name]} “{task["title"]}”.')
        elif name == "delete":
            _shape(operation, ("op", "task_id"))
            task = resolve(operation["task_id"])
            if task["status"] == "deleted":
                acknowledgments.append(f'“{task["title"]}” is already in Trash.')
                continue
            task["deleted_from_status"] = task["status"]
            task["deleted_at"] = now
            task["status"] = "deleted"
            if updated["focus_id"] == task["id"]:
                updated["focus_id"] = None
            provenance(task)
            acknowledgments.append(f'Moved “{task["title"]}” to Trash.')
        elif name == "restore":
            _shape(operation, ("op", "task_id"))
            task = resolve(operation["task_id"])
            if task["status"] != "deleted":
                raise TaskError("Only a task in Trash can be restored.")
            prior_status = task.get("deleted_from_status")
            if prior_status not in ("open", "completed", "cancelled"):
                raise TaskError("This deleted task cannot be safely restored.")
            task["status"] = task.pop("deleted_from_status")
            task.pop("deleted_at", None)
            provenance(task)
            acknowledgments.append(f'Restored “{task["title"]}”.')
        elif name == "progress":
            _shape(operation, ("op", "task_id", "completed_count"))
            task = resolve(operation["task_id"])
            require_available(task)
            count = _count(operation["completed_count"])
            if task["status"] != "open" or task["target_count"] is None or count > task["target_count"]:
                raise TaskError("Progress needs an open task and cannot exceed its target quantity.")
            task["completed_count"] = count
            provenance(task)
            acknowledgments.append(f'Recorded {count} of {task["target_count"]} {task["unit"] or "items"} for “{task["title"]}”.')
        elif name == "break":
            _shape(operation, ("op", "active"))
            if not isinstance(operation["active"], bool):
                raise TaskError("Choose whether the break is active.")
            updated["break_active"] = operation["active"]
            acknowledgments.append("Break started. Your tasks are still here." if operation["active"] else "Break ended.")
        else:
            raise TaskError("That task operation is not supported.")
    updated["revision"] += 1
    updated["applied_requests"][request_id] = {"revision": updated["revision"], "source": dict(source), "at": now}
    return updated, " ".join(acknowledgments)


def bind_model_proposal(raw, *, request_id, revision):
    """Attach caller-owned correlation to one proven current-turn model row.

    The native driver proves the row follows this request before calling here;
    recovery proves it through the matching user/proposal publication metadata.
    Model-generated IDs are not transport identity or concurrency protection.
    Legacy five-field output is accepted, but its correlation fields have no
    authority. The server still validates the receipt and current task revision.
    """
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate proposal key")
            result[key] = value
        return result

    try:
        value = json.loads(raw, object_pairs_hook=unique_keys) if isinstance(raw, str) else None
    except (ValueError, TypeError):
        return None
    fields = {"kind", "reply", "operations"}
    if not isinstance(value, dict) or set(value) not in (fields, fields | {"request_id", "based_on_revision"}):
        return None
    if (not isinstance(value.get("kind"), str) or value["kind"] not in {"update", "chat", "clarify"}
            or not isinstance(value.get("reply"), str) or not isinstance(value.get("operations"), list)):
        return None
    return {"request_id": request_id, "based_on_revision": revision,
            **{key: value[key] for key in ("kind", "reply", "operations")}}


def validate_proposal(value, *, request_id, revision):
    _shape(value, ("request_id", "based_on_revision", "kind", "reply", "operations"))
    if value["request_id"] != request_id or type(value["based_on_revision"]) is not int or value["based_on_revision"] != revision:
        raise TaskConflict("The proposed change no longer matches this request or the current task list.")
    if value["kind"] not in ("update", "chat", "clarify") or not isinstance(value["operations"], list):
        raise TaskError("The response did not contain a valid task decision.")
    reply = value["reply"]
    if (not isinstance(reply, str) or (value['kind'] != 'update' and not reply.strip()) or len(reply) > 8000
            or any(ord(ch) < 32 and ch not in "\n\t" for ch in reply)):
        raise TaskError("The response did not contain a usable reply.")
    if bool(value["operations"]) != (value["kind"] == "update"):
        raise TaskError("The response and proposed task changes disagree.")
    return value


def migrate_legacy(goal: dict | None) -> dict:
    state = initial_tasks()
    if not goal or not goal.get("text") or goal.get("status") not in ("active", "break"):
        return state
    state, _ = apply_operations(state, [
        {"op": "add", "temp_id": "new_legacy", "title": goal["text"], "due_text": None, "target_count": None, "unit": None},
        {"op": "focus", "task_id": "new_legacy"},
        {"op": "break", "active": goal["status"] == "break"}],
        based_on_revision=0, request_id="legacy-single-goal-v1",
        source={"kind": "migration", "legacy_request_id": goal.get("source_request_id"), "legacy_version": goal.get("version", 0)})
    return state
