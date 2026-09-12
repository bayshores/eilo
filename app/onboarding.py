"""Private, approval-gated onboarding workspace drafts."""

from __future__ import annotations

import re
from copy import deepcopy

from app.tasks import TaskConflict, TaskError, apply_operations, public_state


class OnboardingError(ValueError):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


_WIDGETS = {"goals", "progress", "notes", "today", "clock"}
_SUPPORT_SOURCES = ("browser", "desktop", "calendar", None)
_ACTIVE = {"draft", "proposed"}
_RECEIPT_CAP = 100
_REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{12,80}")


def initial_onboarding(tasks: dict) -> dict:
    """Start a private task draft without changing the existing workspace."""
    _task_revision(tasks)
    return {
        "schema": 1,
        "revision": 0,
        "status": "draft",
        "base_task_revision": tasks["revision"],
        "draft_tasks": deepcopy(tasks),
        "widgets": ["goals"],
        "support_source": None,
        "support_status": "pending",
        "receipts": {},
        "acceptance_id": None,
    }


def active_onboarding(state: dict | None) -> bool:
    return (
        isinstance(state, dict)
        and isinstance(state.get("status"), str)
        and state["status"] in _ACTIVE
    )


def public_onboarding(state: dict | None) -> dict | None:
    if state is None:
        return None
    _validate(state)
    return {
        "status": state["status"],
        "revision": state["revision"],
        "proposal": public_state(state["draft_tasks"]),
        "widgets": list(state["widgets"]),
        "support_source": state["support_source"],
        "support_status": state["support_status"],
        "acceptance_id": state["acceptance_id"],
    }


def stage_onboarding(
    state: dict, operations: list, *, request_id, based_on_revision, source
) -> dict:
    """Validate a proposed draft batch and return a replacement onboarding record."""
    _validate(state)
    payload = {"operations": operations, "based_on_revision": based_on_revision, "source": source}
    repeated = _repeat(state, request_id, payload)
    if repeated:
        return state
    if not active_onboarding(state):
        raise OnboardingError("This setup is already finished.", 409)
    if type(based_on_revision) is not int or based_on_revision != state["revision"]:
        raise TaskConflict(
            "Your setup changed while this response was being prepared. Review it and try again."
        )
    _source(source)
    if not isinstance(operations, list) or len(operations) > 40:
        raise TaskError("A setup update must contain at most 40 supported changes.")

    workspace = [
        operation
        for operation in operations
        if isinstance(operation, dict) and operation.get("op") == "workspace"
    ]
    if len(workspace) > 1:
        raise TaskError("Choose one workspace arrangement at a time.")
    if any(not isinstance(operation, dict) for operation in operations):
        raise TaskError("Invalid setup change.")
    task_operations = [operation for operation in operations if operation.get("op") != "workspace"]
    if any(operation.get("op") in ("focus", "break") for operation in task_operations):
        raise TaskError("Focus and breaks are available after you approve this workspace.")

    updated = deepcopy(state)
    if task_operations:
        updated["draft_tasks"], _ = apply_operations(
            updated["draft_tasks"],
            task_operations,
            based_on_revision=updated["draft_tasks"]["revision"],
            request_id="onboarding-" + request_id,
            source=source,
        )
    if workspace:
        widgets, support_source = _workspace(workspace[0])
        updated["widgets"] = widgets
        updated["support_source"] = support_source
    elif updated["widgets"] == ["goals"] and _has_numeric_goal(updated["draft_tasks"]):
        updated["widgets"] = ["goals", "progress"]
    updated["status"] = "proposed" if _has_open_goal(updated["draft_tasks"]) else "draft"
    updated["revision"] += 1
    _remember(updated, request_id, payload)
    return updated


def apply_onboarding_command(state: dict, tasks: dict, body: dict) -> tuple[dict, dict]:
    """Apply an explicit onboarding command; permission state is never changed here."""
    _validate(state)
    _task_revision(tasks)
    if not isinstance(body, dict) or set(body) != {"action", "request_id", "based_on_revision"}:
        raise OnboardingError("Invalid setup command.")
    action, request_id, revision = (
        body["action"],
        body["request_id"],
        body["based_on_revision"],
    )
    if action not in ("accept", "skip", "dismiss_support", "finish_support"):
        raise OnboardingError("Unsupported setup command.")
    payload = {"action": action, "based_on_revision": revision}
    repeated = _repeat(state, request_id, payload)
    if repeated:
        return state, tasks
    if type(revision) is not int or revision != state["revision"]:
        raise TaskConflict("Your setup changed while this action was being prepared. Try again.")
    updated = deepcopy(state)
    updated_tasks = tasks
    if action == "accept":
        if state["status"] != "proposed" or not _has_open_goal(state["draft_tasks"]):
            raise OnboardingError("Add a goal before approving this workspace.", 409)
        if state["base_task_revision"] != tasks["revision"]:
            raise TaskConflict(
                "Your existing goals changed during setup. Start the workspace proposal again."
            )
        updated_tasks = deepcopy(state["draft_tasks"])
        updated_tasks["revision"] = max(tasks["revision"] + 1, updated_tasks["revision"])
        updated["status"] = "complete"
        updated["acceptance_id"] = request_id
    elif action == "skip":
        if not active_onboarding(state):
            raise OnboardingError("This setup is already finished.", 409)
        updated["status"] = "skipped"
    else:
        if state["status"] != "complete":
            raise OnboardingError("Approve the workspace before configuring support.", 409)
        updated["support_status"] = "dismissed" if action == "dismiss_support" else "complete"
    updated["revision"] += 1
    _remember(updated, request_id, payload)
    return updated, updated_tasks


def _task_revision(tasks: dict) -> None:
    if (
        not isinstance(tasks, dict)
        or type(tasks.get("revision")) is not int
        or tasks["revision"] < 0
    ):
        raise OnboardingError("The saved goals cannot be used for setup.", 409)


def _validate(state: dict) -> None:
    required = {
        "schema",
        "revision",
        "status",
        "base_task_revision",
        "draft_tasks",
        "widgets",
        "support_source",
        "support_status",
        "receipts",
        "acceptance_id",
    }
    if not isinstance(state, dict) or set(state) != required or state["schema"] != 1:
        raise OnboardingError("Saved setup data is invalid.", 409)
    if (
        type(state["revision"]) is not int
        or state["revision"] < 0
        or type(state["base_task_revision"]) is not int
        or state["base_task_revision"] < 0
        or state["status"] not in ("draft", "proposed", "complete", "skipped")
        or state["support_status"] not in ("pending", "dismissed", "complete")
        or state["support_source"] not in _SUPPORT_SOURCES
        or not isinstance(state["receipts"], dict)
        or state["acceptance_id"] is not None
        and not isinstance(state["acceptance_id"], str)
    ):
        raise OnboardingError("Saved setup data is invalid.", 409)
    _widgets(state["widgets"])
    _task_revision(state["draft_tasks"])
    if len(state["receipts"]) > _RECEIPT_CAP or any(
        not _valid_receipt(request_id, receipt) for request_id, receipt in state["receipts"].items()
    ):
        raise OnboardingError("Saved setup data is invalid.", 409)


def _source(source) -> None:
    if not isinstance(source, dict) or source.get("kind") not in (
        "human",
        "control",
        "migration",
        "reconciliation",
    ):
        raise TaskError("Only an explicit human decision can change goals.")


def _request_id(request_id) -> None:
    if not isinstance(request_id, str) or not _REQUEST_ID.fullmatch(request_id):
        raise OnboardingError("Invalid setup request.")


def _valid_receipt(request_id, receipt) -> bool:
    return (
        isinstance(request_id, str)
        and _REQUEST_ID.fullmatch(request_id) is not None
        and isinstance(receipt, dict)
        and set(receipt) == {"payload"}
        and isinstance(receipt["payload"], dict)
    )


def _repeat(state: dict, request_id, payload: dict) -> bool:
    _request_id(request_id)
    receipt = state["receipts"].get(request_id)
    if receipt is None:
        return False
    if receipt.get("payload") != payload:
        raise TaskConflict("This setup request ID was already used for a different action.")
    return True


def _remember(state: dict, request_id: str, payload: dict) -> None:
    receipts = state["receipts"]
    receipts[request_id] = {"payload": deepcopy(payload)}
    while len(receipts) > _RECEIPT_CAP:
        del receipts[next(iter(receipts))]


def _workspace(operation: dict) -> tuple[list[str], str | None]:
    if set(operation) != {"op", "widgets", "support_source"}:
        raise TaskError("That workspace arrangement contains unsupported fields.")
    widgets = _widgets(operation["widgets"])
    source = operation["support_source"]
    if source not in _SUPPORT_SOURCES:
        raise TaskError("Choose a supported optional source.")
    return widgets, source


def _widgets(widgets) -> list[str]:
    if (
        not isinstance(widgets, list)
        or not 1 <= len(widgets) <= 3
        or any(not isinstance(widget, str) for widget in widgets)
        or len(set(widgets)) != len(widgets)
        or "goals" not in widgets
        or any(widget not in _WIDGETS for widget in widgets)
    ):
        raise TaskError("Choose one to three workspace widgets including Goals.")
    return list(widgets)


def _has_open_goal(tasks: dict) -> bool:
    return any(task.get("status") == "open" for task in tasks.get("tasks", []))


def _has_numeric_goal(tasks: dict) -> bool:
    return any(
        task.get("status") != "deleted" and type(task.get("target_count")) is int
        for task in tasks.get("tasks", [])
    )
