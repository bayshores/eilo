"""A short-lived, read-only source capability for one user-requested Hermes turn."""

from __future__ import annotations

import asyncio
import hmac
import json
import secrets
import time
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from aiohttp import web

from app.calendar_source import _window, fetch_events
from app.gmail_source import read_thread, search_threads
from app.google_calendar import CalendarError
from app.google_mail import GoogleMail, stamp

TOOL_NAMES = frozenset(
    {
        "eilo_sources",
        "eilo_search_mail",
        "eilo_read_mail",
        "eilo_read_calendar",
        "eilo_read_work_context",
    }
)
MAX_CALLS = 26
MAX_THREADS = 18
MAX_CONTEXT = 65000


class Briefing:
    def __init__(self, chat, root):
        self.chat = chat
        self.mail = GoogleMail(root, chat.calendar, on_change=self.sources_changed)
        self.current = None
        self.return_turns = set()
        previous = chat.meta.get("workflow_run")
        if previous and previous.get("status") == "running":
            previous.update(
                status="interrupted",
                can_cancel=False,
                summary="Work stopped when felis closed. Nothing was automatically retried.",
            )
            for step in previous.get("steps", []):
                if step.get("status") == "running":
                    step["status"] = "failed"
            chat.save_meta()

    def sources_changed(self):
        turn = self.current
        if turn and turn.touched and not turn.valid():
            turn.invalidated = True
            self.chat.reply_stream = None
            if self.chat.busy:
                self.chat.task.cancel()
        for return_turn in tuple(getattr(self, "return_turns", ())):
            if not return_turn.valid():
                return_turn.invalidated = True
                if return_turn.on_invalidated is not None:
                    return_turn.on_invalidated()
        self.chat.changed()

    async def open(self, request_id, allowed_sources=None):
        turn = SourceTurn(self, request_id, allowed_sources=allowed_sources)
        self.current = turn
        await turn.open()
        return turn

    async def open_return(self, delivery_id, on_invalidated=None):
        """Open a shorter, non-presentational capability for one automatic return."""
        turn = SourceTurn(
            self,
            delivery_id,
            report=False,
            on_invalidated=on_invalidated,
            allowed_sources=set(self.chat.capabilities.active()["sources"]),
            limits={"calls": 8, "threads": 2, "context": 24_000, "mail_days": 14, "seconds": 150},
        )
        self.return_turns.add(turn)
        try:
            await turn.open()
        except BaseException:
            self.return_turns.discard(turn)
            raise
        return turn

    async def cancel(self, request_id):
        turn = self.current
        if not turn or turn.id != request_id or not self.chat.busy:
            raise CalendarError("That request is no longer running.", "conflict", 409)
        turn.cancelled = True
        self.chat.task.cancel()
        await asyncio.gather(self.chat.task, return_exceptions=True)
        return self.chat.snapshot()

    async def close(self):
        if self.current:
            await self.current.close()
        for turn in tuple(self.return_turns):
            await turn.close()
        await self.mail.close()


class SourceTurn:
    def __init__(
        self,
        owner,
        request_id,
        *,
        report=True,
        limits=None,
        on_invalidated=None,
        allowed_sources=None,
    ):
        self.owner, self.mail, self.chat = owner, owner.mail, owner.chat
        self.context = getattr(self.chat, "context", None)
        self.id = request_id
        self.report = report
        self.on_invalidated = on_invalidated
        self.allowed_sources = set(
            allowed_sources
            if allowed_sources is not None
            else {"gmail", "google-calendar", "browser-activity"}
        )
        limits = limits or {}
        self.max_calls = limits.get("calls", MAX_CALLS)
        self.max_threads = limits.get("threads", MAX_THREADS)
        self.max_context = limits.get("context", MAX_CONTEXT)
        self.max_mail_days = limits.get("mail_days", 90)
        self.max_seconds = limits.get("seconds", 180)
        self.token = secrets.token_urlsafe(32)
        self.started = time.monotonic()
        self.permission = self.mail.permission_stamp()
        self.context_policy_epoch = self._context_policy_epoch()
        self.runner = None
        self.host = None
        self.touched = False
        self.work_context_touched = False
        self.source_reads = 0
        self.invalidated = self.cancelled = False
        self.lock = asyncio.Lock()
        self.calls = self.thread_reads = self.context_size = 0
        self.discovered = {}
        self.read_keys = set()
        self.refs = {}
        self.source_ids = set()
        self.had_gaps = False
        self.run = {
            "id": request_id,
            "status": "running",
            "title": "Checking your sources",
            "started_at": stamp(),
            "steps": [],
            "sources_checked": 0,
            "can_cancel": True,
            "summary": "",
        }

    def _context_policy_epoch(self):
        state = getattr(self.context, "state", None)
        epoch = state.get("policy_epoch") if isinstance(state, dict) else None
        return epoch if isinstance(epoch, int) and not isinstance(epoch, bool) else None

    def _work_context_status(self):
        if "browser-activity" not in self.allowed_sources:
            return {"enabled": False, "available": False}
        state = getattr(self.context, "state", None)
        if not isinstance(state, dict):
            return {"enabled": False, "available": False}
        enabled = bool(state.get("ai_enabled"))
        return {
            "enabled": enabled,
            # This checks only the current permission state and record reference;
            # it never opens the encrypted context store to inspect its contents.
            "available": enabled
            and (
                state.get("current_context_id") is not None
                or (
                    bool(state.get("enabled"))
                    and any(state.get(f"{source}_enabled") for source in ("browser", "desktop"))
                )
            ),
        }

    def valid(self):
        return (
            not (self.invalidated or self.cancelled)
            and self.permission == self.mail.permission_stamp()
            and (
                not self.work_context_touched
                or (
                    self.context_policy_epoch == self._context_policy_epoch()
                    and self._work_context_status()["enabled"]
                    and not getattr(self.context, "_closed", False)
                )
            )
        )

    def check(self):
        if not self.valid():
            raise CalendarError(
                "Source permissions changed. Ask again using the current sources.",
                "permission_changed",
                403,
            )
        if time.monotonic() - self.started > self.max_seconds:
            raise CalendarError("This source check reached its time limit.", "time_limit", 408)

    def emit(self):
        if not self.report:
            return
        self.run["sources_checked"] = len(self.source_ids)
        self.chat.meta["workflow_run"] = deepcopy(self.run)
        self.chat.save_meta()
        self.chat.changed()

    def step(self, identity, label, status, detail="", count=None):
        step = next((s for s in self.run["steps"] if s["id"] == identity), None)
        if step is None:
            step = {"id": identity, "label": label}
            self.run["steps"].append(step)
        step.update(status=status, detail=detail)
        if count is not None:
            step["completed_count"] = count
        self.emit()

    async def open(self):
        app = web.Application(client_max_size=8192)
        app.router.add_post("/read", self.handle)
        self.runner = web.AppRunner(app, access_log=None)
        try:
            await self.runner.setup()
            await web.TCPSite(self.runner, "127.0.0.1", 0).start()
        except Exception:
            await self.close()
            raise CalendarError(
                "Source checks could not start. Try again.", "bridge_unavailable"
            ) from None
        self.host = f"127.0.0.1:{self.runner.addresses[0][1]}"

    def capability(self):
        return {"url": f"http://{self.host}/read", "token": self.token}

    async def handle(self, request):
        if (
            request.host != self.host
            or request.headers.get("Origin") is not None
            or request.headers.get("Sec-Fetch-Site") is not None
            or not hmac.compare_digest(
                request.headers.get("Authorization", ""), "Bearer " + self.token
            )
        ):
            raise web.HTTPForbidden()
        if request.content_type != "application/json":
            raise web.HTTPUnsupportedMediaType()
        try:
            body = await request.json()
            if (
                not isinstance(body, dict)
                or set(body) != {"tool", "arguments"}
                or not isinstance(body["arguments"], dict)
            ):
                raise CalendarError("Invalid source request.", "invalid_request", 400)
            async with self.lock:
                result = await self.read(body["tool"], body["arguments"])
            return web.json_response(result, headers={"Cache-Control": "no-store"})
        except (CalendarError, ValueError, TypeError):
            return web.json_response(
                {
                    "receipt": {
                        "status": "unavailable",
                        "detail": "This source request could not be completed.",
                    },
                    "data": None,
                },
                headers={"Cache-Control": "no-store"},
            )

    async def read(self, name, args):
        self.check()
        if name not in TOOL_NAMES or self.calls >= self.max_calls:
            raise CalendarError("Source check limit reached.", "limit", 400)
        self.calls += 1
        self.touched = True
        if self.report and self.chat.meta.get("pending_turn"):
            self.chat.meta["pending_turn"]["source_used"] = True
            self.chat.save_meta()
        if name == "eilo_sources":
            if args:
                raise CalendarError("Invalid source request.", "invalid_request", 400)
            available = self.mail.snapshot()
            mail_accounts = (
                [a for a in available["accounts"] if a["enabled"]]
                if "gmail" in self.allowed_sources
                else []
            )
            calendar = dict(available["calendar"])
            if "google-calendar" not in self.allowed_sources:
                calendar["enabled"] = False
            data = {
                "now": datetime.now().astimezone().isoformat(),
                "time_zone": str(datetime.now().astimezone().tzinfo),
                "mail_accounts": mail_accounts,
                "disabled_inbox_count": len(available["accounts"]) - len(mail_accounts),
                "calendar": {
                    k: v for k, v in calendar.items() if k != "account_label" or calendar["enabled"]
                },
                "mail_default_window_days": min(30, self.max_mail_days),
                "mail_max_read_threads_per_turn": self.max_threads,
                "work_context": self._work_context_status(),
                "limitations": "Only connected, enabled sources can be checked. These tools cannot send messages, edit Calendar, or create tasks.",
            }
            if (
                not any(a["state"] == "connected" for a in mail_accounts)
                and not calendar["enabled"]
                and not self._work_context_status()["enabled"]
            ):
                self.had_gaps = True
                self.run["needs_connection"] = True
            self.step(
                "sources",
                "Check source access",
                "completed",
                f"Available inboxes: {sum(a['enabled'] and a['state'] == 'connected' for a in available['accounts'])}",
            )
            return self.pack(data, "Source access checked")
        if name == "eilo_read_work_context":
            if args:
                raise CalendarError("Invalid work-context request.", "invalid_request", 400)
            status = self._work_context_status()
            if not status["enabled"]:
                return self.gap(
                    "work_context",
                    "Read work context",
                    "Work context is not enabled for answers.",
                    skipped=True,
                )
            self.work_context_touched = True
            # Once this read begins, every guard also includes the context policy
            # revision captured when the turn opened.
            self.check()
            self.step("work_context", "Read work context", "running")
            try:
                read_context = getattr(self.context, "conversation_context", None)
                data = read_context() if callable(read_context) else None
                self.check()
                if data is None:
                    return self.gap(
                        "work_context",
                        "Read work context",
                        "No current work context is available for this answer.",
                        skipped=True,
                    )
                self.source_reads += 1
                self.source_ids.add("work_context")
                self.step("work_context", "Read work context", "completed")
                return self.pack(data, "Work context read")
            except asyncio.CancelledError:
                raise
            except Exception:
                return self.gap(
                    "work_context",
                    "Read work context",
                    "Work context could not be read. Coverage is incomplete.",
                )
        if name == "eilo_search_mail":
            if set(args) - {"account_id", "query", "days"} or not {"account_id"} <= set(args):
                raise CalendarError("Invalid mail search.", "invalid_request", 400)
            identity = args["account_id"]
            if "gmail" not in self.allowed_sources:
                return self.gap(
                    "inbox",
                    "Check inbox",
                    "Gmail is disabled for this chat.",
                    skipped=True,
                )
            account = self.mail.account(identity)
            if not account or not account["enabled"] or account["state"] != "connected":
                return self.gap(
                    "inbox", "Check inbox", "This inbox is not enabled or needs reconnection."
                )
            days = args.get("days", 30)
            query = args.get("query", "")
            if (
                type(days) is not int
                or not 1 <= days <= self.max_mail_days
                or not isinstance(query, str)
                or len(query) > 1024
            ):
                raise CalendarError("Mail search window is unavailable.", "invalid_request", 400)
            since = (datetime.now(UTC) - timedelta(days=days)).strftime("%Y/%m/%d")
            bounded_query = (
                f"({query}) " if query.strip() else ""
            ) + f"after:{since} -in:spam -in:trash"
            label = "Search " + account["email"]
            step_id = "search_" + identity
            self.step(step_id, label, "running", f"Last {days} days")
            try:
                result = await search_threads(
                    lambda url, params=None: self.mail.get(identity, url, params),
                    bounded_query,
                    max_threads=30,
                )
                self.check()
                self.discovered.setdefault(identity, set()).update(result["thread_ids"])
                self.source_ids.add(identity)
                await self.mail.checked(identity)
                self.step(
                    step_id,
                    label,
                    "completed",
                    f"Matching threads: {len(result['thread_ids'])}"
                    + (" · more results available" if result["has_more"] else ""),
                    len(result["thread_ids"]),
                )
                if result["has_more"]:
                    self.had_gaps = True
                return self.pack(
                    {"account_id": identity, "query": bounded_query, "days": days, **result},
                    "Inbox searched",
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                return self.gap(
                    step_id, label, "This inbox could not be searched. Coverage is incomplete."
                )
        if name == "eilo_read_mail":
            if set(args) != {"account_id", "thread_id"}:
                raise CalendarError("Invalid thread request.", "invalid_request", 400)
            identity, thread_id = args["account_id"], args["thread_id"]
            if "gmail" not in self.allowed_sources:
                return self.gap(
                    "read",
                    "Read relevant emails",
                    "Gmail is disabled for this chat.",
                    skipped=True,
                )
            account = self.mail.account(identity)
            if (
                not account
                or not isinstance(thread_id, str)
                or thread_id not in self.discovered.get(identity, set())
                or self.thread_reads >= self.max_threads
            ):
                return self.gap(
                    "read",
                    "Read relevant emails",
                    "A thread is unavailable or the reading limit was reached.",
                )
            self.step(
                "read", "Read relevant emails", "running", f"Threads read: {self.thread_reads}"
            )
            try:
                result = await read_thread(
                    lambda url, params=None: self.mail.get(identity, url, params),
                    thread_id,
                    max_messages=8,
                    max_chars=6000,
                )
                self.check()
                # Bound the complete thread, not each message independently. Preserve newest replies.
                remaining = 6500
                for message in reversed(result["messages"]):
                    excerpt = message["excerpt"][:remaining]
                    if len(excerpt) < len(message["excerpt"]):
                        result["truncated"] = True
                        message["truncated"] = True
                    message["excerpt"] = excerpt
                    remaining -= len(excerpt)
                self.thread_reads += 1
                self.source_reads += 1
                self.read_keys.add((identity, thread_id))
                if result["truncated"]:
                    self.had_gaps = True
                link = (
                    "https://mail.google.com/mail/u/?authuser="
                    + quote(account["email"], safe="")
                    + "#all/"
                    + quote(thread_id, safe="")
                )
                packed = self.pack(
                    {"account_id": identity, **result},
                    "Email thread read",
                    link=link,
                    label="Email · " + account["email"],
                )
                self.step(
                    "read",
                    "Read relevant emails",
                    "completed",
                    f"Threads read: {self.thread_reads}",
                    self.thread_reads,
                )
                return packed
            except asyncio.CancelledError:
                raise
            except Exception:
                return self.gap(
                    "read",
                    "Read relevant emails",
                    "A thread could not be read. Coverage is incomplete.",
                )
        if args:
            raise CalendarError("Invalid calendar request.", "invalid_request", 400)
        if "google-calendar" not in self.allowed_sources:
            return self.gap(
                "calendar",
                "Check selected calendars",
                "Google Calendar is disabled for this chat.",
                skipped=True,
            )
        if not self.mail.calendar_enabled():
            return self.gap(
                "calendar",
                "Check selected calendars",
                "Calendar details are not enabled for answers.",
                skipped=True,
            )
        self.step("calendar", "Check selected calendars", "running")
        try:
            calendar = self.chat.calendar
            selected = list(calendar.data["selected_ids"])
            events = await fetch_events(
                calendar._get, deepcopy(calendar.data["calendars"]), selected
            )
            self.check()
            start, end = _window(None)
            self.source_reads += 1
            self.source_ids.add("calendar")
            self.step(
                "calendar",
                "Check selected calendars",
                "completed",
                f"Events: {len(events)} · Calendars: {len(selected)}",
                len(events),
            )
            return self.pack(
                {
                    "events": events,
                    "calendar_count": len(selected),
                    "window_start": start.isoformat(),
                    "window_end": end.isoformat(),
                    "coverage": "Selected calendars only; exclusive end; cancelled and declined events omitted.",
                },
                "Calendar checked",
                link="https://calendar.google.com/calendar/u/0/r",
                label="Selected calendars",
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            return self.gap(
                "calendar",
                "Check selected calendars",
                "Calendar could not be read. Do not assume an event is missing.",
            )

    def gap(self, identity, label, detail, skipped=False):
        self.had_gaps = True
        self.step(identity, label, "skipped" if skipped else "failed", detail)
        return {"receipt": {"status": "unavailable", "detail": detail}, "data": None}

    def pack(self, data, detail, link=None, label=None):
        size = len(json.dumps(data, ensure_ascii=False))
        if self.context_size + size > self.max_context:
            self.had_gaps = True
            self.step(
                "limit",
                "Source coverage",
                "skipped",
                "Some retrieved data exceeded the per-answer size limit and was not passed to Luna.",
            )
            return {
                "receipt": {
                    "status": "limited",
                    "detail": "Context limit reached; the requested data was not passed to the model.",
                },
                "data": None,
            }
        self.context_size += size
        ref = f"S{self.calls}"
        if link:
            self.refs[ref] = {"id": ref, "label": label, "url": link}
            self.run["sources"] = list(self.refs.values())
            self.emit()
        return {"receipt": {"status": "ok", "source_id": ref, "detail": detail}, "data": data}

    def writing(self):
        if self.touched:
            self.run["title"] = "Preparing your answer"
            self.step("answer", "Bring the findings together", "running")

    def finish(self, status="completed"):
        if not self.touched:
            return
        if self.cancelled:
            status = "cancelled"
        elif self.invalidated:
            status = "cancelled"
        elif status == "completed" and self.had_gaps:
            status = "partial"
        self.run.update(
            status=status,
            can_cancel=False,
            finished_at=stamp(),
            title="Source check",
            summary={
                "completed": "Answer ready. Open a source to check the details.",
                "partial": "Answer ready with source gaps. See details for coverage.",
                "failed": "The answer did not finish. Your saved tasks are unchanged.",
                "cancelled": "Stopped. Your saved tasks are unchanged.",
            }[status],
        )
        if self.run.get("needs_connection") and status in ("completed", "partial"):
            self.run["summary"] = "Connect a source to prepare a grounded brief."
        for step in self.run["steps"]:
            if step["status"] == "running":
                step["status"] = (
                    "completed"
                    if status in ("completed", "partial") and step["id"] == "answer"
                    else "failed"
                )
        self.emit()

    async def close(self):
        self.token = ""
        if self.runner:
            runner, self.runner = self.runner, None
            await runner.cleanup()
        self.discovered.clear()
        if self.owner.current is self:
            self.owner.current = None
        turns = getattr(self.owner, "return_turns", None)
        if turns is not None:
            turns.discard(self)
