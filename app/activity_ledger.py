"""Conservative local record of observed, approved study-site sessions."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import re
import time
import uuid

from app.accountability import DEFAULT_HOSTS
from app.tasks import TaskConflict, TaskError

MAX_GAP_SECONDS = 12
RETENTION_SECONDS = 7 * 24 * 60 * 60
MAX_SESSIONS = 128
MAX_RELATED_TASKS = 32
MAX_CONTROL_RECEIPTS = 256
APPROVED_ORIGINS = frozenset(f"https://{host}" for host in DEFAULT_HOSTS)


class ActivityLedger:
    """Persist only sample-backed elapsed time; it makes no attention claim."""

    def __init__(self, state: dict, now=time.time, id_factory=lambda: uuid.uuid4().hex):
        if not isinstance(state, dict):
            raise TypeError("state must be a dictionary")
        self.state, self.clock, self.id_factory = state, now, id_factory
        journal = state.setdefault("activity_journal", {})
        if not isinstance(journal, dict):
            journal = state["activity_journal"] = {}
        sessions = journal.get("sessions")
        journal["sessions"] = sessions if isinstance(sessions, list) else []
        journal["active"] = journal.get("active") if isinstance(journal.get("active"), str) else None
        journal["manual_revision"] = journal.get("manual_revision") if self._revision(journal.get("manual_revision")) else 0
        journal["control_receipts"] = journal.get("control_receipts") if isinstance(journal.get("control_receipts"), dict) else {}
        self.journal = journal
        self._restore_closed()
        self._trim(self._now())

    def _now(self, value=None):
        value = self.clock() if value is None else value
        if not isinstance(value, (int, float)) or not value == value or value in (float("inf"), float("-inf")):
            raise ValueError("now must be finite")
        return float(value)

    def _sessions(self):
        return self.journal["sessions"]

    @staticmethod
    def _revision(value):
        return type(value) is int and value >= 0

    def _active(self):
        session_id = self.journal.get("active")
        return next((session for session in self._sessions()
                     if session.get("id") == session_id and session.get("end") is None
                     and "trashed_at" not in session), None)

    def _restore_closed(self):
        for session in self._sessions():
            if isinstance(session, dict) and session.get("end") is None:
                session["end"] = session.get("last_seen", session.get("start", 0))
        self.journal["active"] = None

    def _trim(self, now):
        cutoff = now - RETENTION_SECONDS
        self.journal["sessions"] = [session for session in self._sessions()
                                    if isinstance(session, dict) and session.get("last_seen", 0) >= cutoff][-MAX_SESSIONS:]
        if self._active() is None:
            self.journal["active"] = None

    @staticmethod
    def _origin(observation):
        if not isinstance(observation, dict) or observation.get("kind") != "approved_study_context":
            return None
        origin = observation.get("origin")
        return origin if origin in APPROVED_ORIGINS else None

    @staticmethod
    def _day(stamp):
        return datetime.fromtimestamp(stamp, timezone.utc).date().isoformat()

    def _open(self, origin, now):
        session = {"id": str(self.id_factory()), "origin": origin, "start": now, "end": None,
                   "last_seen": now, "sample_count": 1, "observed_seconds": 0,
                   "observed_by_utc_day": {}}
        self._sessions().append(session)
        self.journal["active"] = session["id"]
        self._trim(now)
        return session

    def _close_active(self):
        active = self._active()
        if active:
            active["end"] = active["last_seen"]
        self.journal["active"] = None

    def observe(self, sanitized_observation, now=None):
        now = self._now(now)
        origin = self._origin(sanitized_observation)
        active = self._active()
        if origin is None:
            self._close_active()
            self._trim(now)
            return self.snapshot(now)
        if not active:
            self._open(origin, now)
        elif active["origin"] != origin or now - active["last_seen"] > MAX_GAP_SECONDS:
            self._close_active()
            self._open(origin, now)
        else:
            gap = now - active["last_seen"]
            active["sample_count"] += 1
            if 0 < gap <= MAX_GAP_SECONDS:
                active["observed_seconds"] += gap
                day = self._day(active["last_seen"])
                active["observed_by_utc_day"][day] = active["observed_by_utc_day"].get(day, 0) + gap
            if now > active["last_seen"]:
                active["last_seen"] = now
        self._trim(now)
        return self.snapshot(now)

    def close(self, reason="paused", now=None):
        self._now(now)  # Validate a caller-supplied timestamp without inferring elapsed time.
        self._close_active()
        self._trim(self._now(now))
        return self.snapshot(now)

    def associate(self, session_id, task_ids, task_revision):
        if (not isinstance(session_id, str) or not isinstance(task_ids, list) or len(task_ids) > MAX_RELATED_TASKS
                or not isinstance(task_revision, int) or task_revision < 0):
            return False
        ids = []
        for task_id in task_ids:
            if not isinstance(task_id, str) or not task_id or len(task_id) > 160 or task_id in ids:
                return False
            ids.append(task_id)
        session = next((item for item in self._sessions() if item.get("id") == session_id), None)
        if not session or session.get("association_dismissed"):
            return False
        session["related_task_ids"] = ids
        session["related_task_revision"] = task_revision
        return True

    @staticmethod
    def _control_identifier(value, label):
        if (not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", value)):
            raise TaskError(f"Use a valid {label}.")

    @staticmethod
    def _public(session):
        value = {key: deepcopy(session[key]) for key in
                 ("id", "origin", "start", "end", "last_seen", "sample_count", "observed_seconds")}
        if "related_task_ids" in session:
            value["related_task_ids"] = list(session["related_task_ids"])
            value["related_task_revision"] = session["related_task_revision"]
        return value

    def has_control_receipt(self, request_id):
        """Whether this ledger has already committed a control request id."""
        return isinstance(request_id, str) and request_id in self.journal.get("control_receipts", {})

    def plan_control(self, action, session_id, request_id, based_on_revision, now=None):
        """Return a new journal for an explicit record control without mutating this ledger."""
        self._control_identifier(action, "record action")
        self._control_identifier(session_id, "session identifier")
        self._control_identifier(request_id, "request identifier")
        if action not in ("trash", "restore", "unlink"):
            raise TaskError("Choose a supported record action.")
        if not self._revision(based_on_revision):
            raise TaskError("Use the current record revision.")

        revision = self.journal.get("manual_revision", 0)
        revision = revision if self._revision(revision) else 0
        receipts = self.journal.get("control_receipts", {})
        receipts = receipts if isinstance(receipts, dict) else {}
        receipt = receipts.get(request_id)
        payload = {"action": action, "session_id": session_id, "based_on_revision": based_on_revision}
        if receipt is not None:
            if not isinstance(receipt, dict) or receipt.get("payload") != payload:
                raise TaskConflict("That record request id was already used for a different change.")
            return deepcopy(self.journal)
        if based_on_revision != revision:
            raise TaskConflict("Your activity records changed while this request was being prepared. Review them and try again.")
        now = self._now(now)

        session = next((item for item in self._sessions()
                        if isinstance(item, dict) and item.get("id") == session_id), None)
        if session is None:
            raise TaskError("That activity record is no longer available.")
        if session.get("last_seen", 0) < now - RETENTION_SECONDS:
            raise TaskError("That activity record is no longer available.")
        if action == "trash" and "trashed_at" in session:
            raise TaskError("That activity record is already in Trash.")
        if action == "restore" and "trashed_at" not in session:
            raise TaskError("That activity record is not in Trash.")
        if action == "unlink" and ("trashed_at" in session or not session.get("related_task_ids")
                                    or session.get("association_dismissed")):
            raise TaskError("That activity record has no task link to remove.")

        updated = deepcopy(self.journal)
        updated["sessions"] = [item for item in updated.get("sessions", []) if isinstance(item, dict)]
        target = next(item for item in updated["sessions"] if item.get("id") == session_id)
        if action == "trash":
            if target.get("end") is None:
                target["end"] = target.get("last_seen", target.get("start", 0))
            target["trashed_at"] = now
            updated["active"] = None if updated.get("active") == session_id else updated.get("active")
        elif action == "restore":
            target.pop("trashed_at", None)
            target["end"] = target.get("last_seen", target.get("start", 0))
            if updated.get("active") == session_id:
                updated["active"] = None
        else:
            target.pop("related_task_ids", None)
            target.pop("related_task_revision", None)
            target["association_dismissed"] = True

        cutoff = now - RETENTION_SECONDS
        updated["sessions"] = [item for item in updated["sessions"]
                              if item.get("last_seen", 0) >= cutoff][-MAX_SESSIONS:]
        active_id = updated.get("active")
        if not any(item.get("id") == active_id and item.get("end") is None and "trashed_at" not in item
                   for item in updated["sessions"]):
            updated["active"] = None
        updated["manual_revision"] = revision + 1
        updated_receipts = updated.get("control_receipts")
        updated_receipts = updated_receipts if isinstance(updated_receipts, dict) else {}
        updated["control_receipts"] = updated_receipts
        updated_receipts[request_id] = {"payload": payload, "revision": updated["manual_revision"], "at": now}
        while len(updated_receipts) > MAX_CONTROL_RECEIPTS:
            updated_receipts.pop(next(iter(updated_receipts)))
        return updated

    def snapshot(self, now=None):
        now = self._now(now)
        self._trim(now)
        today = self._day(now)
        totals = {}
        for session in self._sessions():
            if "trashed_at" in session:
                continue
            seconds = session.get("observed_by_utc_day", {}).get(today, 0)
            if seconds:
                totals[session["origin"]] = totals.get(session["origin"], 0) + seconds
        active = self._active()
        visible = [session for session in self._sessions() if "trashed_at" not in session]
        trashed = [session for session in self._sessions() if "trashed_at" in session]
        revision = self.journal.get("manual_revision", 0)
        return {"timezone": "UTC", "revision": revision if self._revision(revision) else 0,
                "recent_sessions": [self._public(session) for session in visible],
                "trash_sessions": [self._public(session) for session in trashed],
                "active_session": self._public(active) if active else None,
                "today_observed_seconds_by_origin": totals}
