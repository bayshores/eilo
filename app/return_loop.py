"""Automatic return-briefing admission, cancellation, and durable publication."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import re
import time
import uuid
from datetime import date

from app.briefing import TOOL_NAMES
from app.onboarding import active_onboarding
from app.persistence import write_private
from app.runtime_contract import MODEL, PROVIDER, validate_provenance, validate_return_decision
from app.tasks import public_state


def initial_state() -> dict:
    return {"version": 1, "events": {}, "accepted_requests": []}


_REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{12,80}\Z")


def _valid_day(value) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return str(date.fromisoformat(value)) == value
    except ValueError:
        return False


def _not_on_break(tasks: object) -> bool:
    """Returns can still catch someone up without an open goal, never during a break."""
    return isinstance(tasks, dict) and tasks.get("break_active") is False


class ReturnLoop:
    """One at-most-once automatic catch-up per reason, conversation, and local day."""

    def __init__(self, chat, *, now=time.time, today=None):
        self.chat = chat
        self.now = now
        self.today = today or (lambda: date.today().isoformat())
        self.state = chat.meta.setdefault("return_briefing", initial_state())
        self.state.setdefault("version", 1)
        self.state.setdefault("events", {})
        self.state.setdefault("accepted_requests", [])
        for event in self.state["events"].values():
            if event.get("status") == "running":
                event["status"] = "stale"
        self.task = None
        self.delivery_id = None
        self.publishing = False

    def _human_epoch(self) -> int:
        state = getattr(getattr(self.chat, "proactive", None), "state", {})
        value = state.get("human_epoch") if isinstance(state, dict) else None
        return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0

    @staticmethod
    def _return_key(session_id: str, local_day: str, reason: str) -> str:
        raw = f"{session_id}\x1f{local_day}\x1f{reason}".encode()
        return "return-" + hashlib.sha256(raw).hexdigest()[:48]

    def _active(self) -> bool:
        return bool(self.task and not self.task.done())

    def snapshot(self) -> dict:
        entries = sorted(
            self.state["events"].values(), key=lambda item: item.get("created_at", 0), reverse=True
        )
        latest = entries[0] if entries else None
        phase = "preparing" if self._active() else "idle"
        if latest and phase == "idle" and latest.get("status") in {"delivered", "quiet"}:
            phase = latest["status"]
        return {
            "version": 1,
            "phase": phase,
            "pending": self._active(),
            "latest": (
                {
                    "reason": latest.get("reason"),
                    "local_day": latest.get("local_day"),
                    "status": latest.get("status"),
                    "finished_at": latest.get("finished_at"),
                }
                if latest
                else None
            ),
        }

    def _can_begin(self) -> bool:
        return bool(
            self.chat.meta.get("session_id")
            and not self.chat.busy
            and not self.chat.blocked
            and not self.chat.meta.get("pending")
            and not self.chat.meta.get("pending_turn")
            and not self.chat.meta.get("pending_publication")
            and not active_onboarding(self.chat.meta.get("onboarding"))
            and not self._active()
            and _not_on_break(self.chat.meta.get("tasks"))
        )

    async def request(self, request_id: str, reason: str, local_day: str, *, draft_present=False):
        """Accept an eligible Home request without treating it as a human chat turn."""
        async with self.chat.lock:
            if request_id in self.state["accepted_requests"]:
                return self.snapshot()
            if not isinstance(request_id, str) or not _REQUEST_ID.fullmatch(request_id):
                return self.snapshot()
            if (
                draft_present
                or reason not in {"daily", "absence"}
                or not _valid_day(local_day)
                or local_day != self.today()
            ):
                return self.snapshot()
            if not self._can_begin():
                return self.snapshot()
            session_id = self.chat.meta["session_id"]
            return_key = self._return_key(session_id, local_day, reason)
            if any(
                event.get("return_key") == return_key for event in self.state["events"].values()
            ):
                return self.snapshot()
            delivery_id = "return-" + uuid.uuid4().hex
            event = {
                "status": "running",
                "delivery_id": delivery_id,
                "return_key": return_key,
                "reason": reason,
                "local_day": local_day,
                "session_id": session_id,
                "task_revision": self.chat.meta["tasks"]["revision"],
                "human_epoch": self._human_epoch(),
                "created_at": self.now(),
                "assistant_id": None,
            }
            self.state["events"][delivery_id] = event
            keep = list(self.state["events"])[-100:]
            self.state["events"] = {
                identity: value
                for identity, value in self.state["events"].items()
                if identity in keep or value.get("status") in {"publishing", "delivered"}
            }
            self.state["accepted_requests"] = (self.state["accepted_requests"] + [request_id])[
                -100:
            ]
            self.chat.save_meta()
            self.delivery_id = delivery_id
            self.task = asyncio.create_task(
                self.decide(delivery_id), name="native-automatic-return-briefing"
            )
            self.chat.changed()
            return self.snapshot()

    def current(self, event: dict) -> bool:
        return bool(
            not self.chat.busy
            and not self.chat.blocked
            and not self.chat.meta.get("pending")
            and not self.chat.meta.get("pending_turn")
            and not self.chat.meta.get("pending_publication")
            and not active_onboarding(self.chat.meta.get("onboarding"))
            and _not_on_break(self.chat.meta.get("tasks"))
            and event.get("local_day") == self.today()
            and event.get("session_id") == self.chat.meta.get("session_id")
            and event.get("task_revision") == self.chat.meta["tasks"]["revision"]
            and event.get("human_epoch") == self._human_epoch()
        )

    def invalidate(self) -> None:
        if self.task and not self.task.done() and not self.publishing:
            event = self.state["events"].get(self.delivery_id)
            if event and event.get("status") == "running":
                event["status"] = "stale"
            self.task.cancel()
            self.chat.save_meta()

    def on_human(self, _text: str, _request_id: str) -> None:
        self.invalidate()

    async def decide(self, delivery_id: str) -> None:
        event = self.state["events"].get(delivery_id)
        path = self.chat.meta_path.parent / f"return-{delivery_id}.json"
        source_turn = None
        try:
            if event is None or not self.current(event):
                if event:
                    event["status"] = "stale"
                return
            source_turn = await self.chat.briefing.open_return(
                delivery_id, on_invalidated=self.invalidate
            )
            write_private(
                path,
                {
                    "session_id": event["session_id"],
                    "session_title": self.chat.meta["title"],
                    "delivery_id": delivery_id,
                    "return_key": event["return_key"],
                    "reason": event["reason"],
                    "local_day": event["local_day"],
                    "task_state": public_state(self.chat.meta["tasks"]),
                    "human_epoch": event["human_epoch"],
                    "context_bridge": source_turn.capability(),
                },
            )
            async with self.chat.native_lock:
                if not self.current(event) or not source_turn.valid():
                    event["status"] = "stale"
                    return
                code, out, _ = await self.chat.command(
                    ["--input", str(path)], launcher="hermes-return", timeout=180
                )
                value = json.loads(out) if code == 0 else {}
                audit = value.get("audit", {})
                if (
                    value.get("session_id") != event["session_id"]
                    or value.get("delivery_id") != delivery_id
                    or audit.get("model") != MODEL
                    or audit.get("provider") != PROVIDER
                    or audit.get("tool_schema_count") != len(TOOL_NAMES)
                    or audit.get("persisted") is not False
                ):
                    raise ValueError("automatic return receipt was not verified")
                decision = validate_return_decision(value.get("decision"), delivery_id)
                provenance = validate_provenance(value.get("provenance"))
                if provenance is None or provenance["task_revision"] != event["task_revision"]:
                    decision = None
                if not self.current(event) or not source_turn.valid():
                    event["status"] = "stale"
                elif decision and decision["decision"] == "deliver":
                    publication = {
                        "session_id": event["session_id"],
                        "session_title": self.chat.meta["title"],
                        "delivery_id": delivery_id,
                        "return_key": event["return_key"],
                        "reason": event["reason"],
                        "local_day": event["local_day"],
                        "task_revision": event["task_revision"],
                        "human_epoch": event["human_epoch"],
                        "decision": decision,
                        "provenance": provenance,
                    }
                    event.update(status="publishing", publication=publication)
                    self.chat.save_meta()
                    self.publishing = True
                    # No await may separate the final authority check from this append.
                    receipt = self.chat.publish_return(publication)
                    if receipt.get("delivery_id") != delivery_id or not isinstance(
                        receipt.get("assistant_id"), int
                    ):
                        raise ValueError("automatic return could not be published")
                    event["assistant_id"] = str(receipt["assistant_id"])
                    event["status"] = "delivered"
                    event.pop("publication", None)
                else:
                    event["status"] = "quiet"
                await self.chat.refresh()
        except asyncio.CancelledError:
            if event and event.get("status") != "publishing":
                event["status"] = "stale"
            raise
        except Exception:
            if event and event.get("status") != "publishing":
                event["status"] = "failed_quiet"
        finally:
            path.unlink(missing_ok=True)
            if source_turn:
                await source_turn.close()
            if event:
                event["finished_at"] = self.now()
            self.publishing = False
            if self.delivery_id == delivery_id:
                self.delivery_id = None
            self.chat.save_meta()
            self.chat.changed()

    async def recover_publications(self) -> None:
        """Only recover an exact native append; never replay automatic inference."""
        recovered = False
        for delivery_id, event in self.state["events"].items():
            if event.get("status") != "publishing" or not event.get("publication"):
                continue
            try:
                receipt = self.chat.publish_return(event["publication"], lookup=True)
                if receipt.get("delivery_id") != delivery_id:
                    continue
                assistant_id = receipt.get("assistant_id")
                if assistant_id is not None and not isinstance(assistant_id, int):
                    continue
                event["assistant_id"] = str(assistant_id) if assistant_id is not None else None
                event["status"] = "delivered" if assistant_id is not None else "stale"
                event["recovered"] = True
                event["recovery_outcome"] = (
                    "native_found" if assistant_id is not None else "not_found"
                )
                event.pop("publication", None)
                recovered = True
            except Exception:
                continue
        if recovered:
            self.chat.save_meta()
            await self.chat.refresh()
            self.chat.changed()

    async def wait_for_preempted_event(self) -> None:
        if self.task and not self.task.done():
            with contextlib.suppress(asyncio.CancelledError):
                await self.task

    async def close(self) -> None:
        self.invalidate()
        await self.wait_for_preempted_event()
