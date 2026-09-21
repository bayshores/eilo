"""Conversation orchestration and its durable, recoverable transactions.

`LocalChat` is the only owner of the private conversation journal.  A task or
publication change is first written durably, then reflected in memory; native
Hermes history is audited before it can affect either public messages or tasks.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import signal
import time
import uuid
from copy import deepcopy
from pathlib import Path

from aiohttp import web

from app.account_service import AccountService
from app.briefing import TOOL_NAMES, Briefing
from app.capabilities import Capabilities
from app.chat_catalog import (
    CONVERSATION_KEYS,
    CatalogError,
    apply_catalog,
    ensure_catalog,
    import_sessions,
    snapshot_catalog,
)
from app.connections import Connections
from app.context_analysis import analyze_context
from app.context_capture import ContextCapture
from app.context_service import ContextService
from app.context_store import ContextStoreError
from app.errors import ChatError
from app.google_calendar import GoogleCalendarConnection
from app.onboarding import (
    OnboardingError,
    active_onboarding,
    apply_onboarding_command,
    initial_onboarding,
    public_onboarding,
    stage_onboarding,
)
from app.paths import META, ROOT, RUNTIME
from app.persistence import write_private
from app.proactive import ProactiveLoop
from app.return_loop import ReturnLoop
from app.return_loop import initial_state as initial_return_state
from app.runtime_contract import (
    MODEL,
    PROVIDER,
    audit_session,
    check_config,
    runtime_error,
    visible_messages,
)
from app.tasks import (
    TaskConflict,
    TaskError,
    apply_operations,
    bind_model_proposal,
    initial_tasks,
    migrate_legacy,
    public_state,
    validate_proposal,
)

MAX_MESSAGE = 12_000


class LocalChat:
    def __init__(self, *, meta_path: Path = META, timing_path: Path | None = None) -> None:
        self.meta_path = meta_path
        self.timing_path = timing_path
        self.instance_id = uuid.uuid4().hex
        self.revision_number = 0
        self.change_event = asyncio.Event()
        self.lock = asyncio.Lock()
        self.native_lock = asyncio.Lock()
        self.task: asyncio.Task | None = None
        self._catalog_changing = False
        self.children: set[asyncio.subprocess.Process] = set()
        self.messages: list[dict] = []
        self.reply_stream = None
        self.native_record: dict = {}
        self.error: str | None = None
        self.blocked = False
        self.last_audit: dict = {}
        self._new_profile = not self.meta_path.exists()
        if self.meta_path.exists():
            self.meta = json.loads(self.meta_path.read_text())
            if not re.fullmatch(r"eilo-ui-[a-f0-9]{32}", self.meta.get("title", "")):
                raise ChatError(
                    "The local conversation pointer is invalid. It has not been replaced."
                )
        else:
            self.meta = self.fresh_meta()
            write_private(self.meta_path, self.meta)
        if "tasks" not in self.meta:
            self.meta["tasks"] = migrate_legacy(self.meta.get("accountability", {}).get("goal"))
            write_private(self.meta_path, self.meta)
        try:
            catalog_meta = ensure_catalog(self.meta)
        except CatalogError as exc:
            raise ChatError(
                "The saved chat library needs attention. It has not been replaced."
            ) from exc
        if catalog_meta != self.meta:
            write_private(self.meta_path, catalog_meta)
        self.meta = catalog_meta
        self.calendar = GoogleCalendarConnection(
            ROOT if meta_path == META else meta_path.parent / "calendar", on_change=self.changed
        )
        self.briefing = Briefing(self, ROOT if meta_path == META else meta_path.parent / "calendar")
        self.proactive = ProactiveLoop(
            self,
            helper=RUNTIME
            / "eilo-activity-helper/eilo-activity-helper.app/Contents/MacOS/EiloActivityHelper",
        )
        self.returns = ReturnLoop(self)
        self.connections = Connections(
            self, ROOT if meta_path == META else meta_path.parent / "calendar"
        )
        self.capabilities = Capabilities(self)
        self.context = ContextService(
            self.meta_path.parent / "context",
            get_tasks=lambda: public_state(self.meta["tasks"])["tasks"],
            changed=self.context_changed,
            analyze=analyze_context,
            is_human_busy=lambda: self.busy,
        )
        self.context_capture = ContextCapture(
            self.meta_path.parent / "context",
            self.context,
            RUNTIME / "eilo-context-collector/EiloContextCollector",
        )
        self.account = AccountService(
            changed=self.changed, connected=self.account_connected, auto_status=meta_path == META
        )
        for event in self.proactive.state["events"].values():
            if event.get("status") == "running":
                event["status"] = "stale"

    def save_meta(self) -> None:
        write_private(self.meta_path, self.meta)

    def account_connected(self):
        if self.error and "saved subscription sign-in" in self.error:
            self.error, self.blocked = None, False
            self.changed()

    @staticmethod
    def fresh_meta() -> dict:
        tasks = initial_tasks()
        return {
            "version": 2,
            "title": "eilo-ui-" + uuid.uuid4().hex,
            "session_id": None,
            "started": False,
            "pending": False,
            "request_id": None,
            "accepted_requests": [],
            "pending_message": None,
            "pending_turn": None,
            "pending_publication": None,
            "tasks": tasks,
            "return_briefing": initial_return_state(),
            "onboarding": initial_onboarding(tasks),
        }

    @property
    def busy(self) -> bool:
        return self._catalog_changing or (self.task is not None and not self.task.done())

    @property
    def revision(self) -> str:
        return f"{self.instance_id}:{self.revision_number}"

    def changed(self) -> None:
        if hasattr(self, "meta") and "chat_catalog" in self.meta:
            # Keep display metadata in step without replacing the live task/activity objects.
            self.meta["chat_catalog"] = ensure_catalog(self.meta)["chat_catalog"]
        self.revision_number += 1
        self.change_event.set()
        self.change_event = asyncio.Event()

    def context_changed(self) -> None:
        self.proactive.context_changed()
        self.briefing.sources_changed()
        self.returns.invalidate()

    def publish_check_in(self, publication, *, lookup=False):
        """Keep the short native commit in the same turn as authority validation."""
        expected = (self.meta_path.parent / "hermes").resolve()
        if Path(os.environ.get("HERMES_HOME", "")).resolve() != expected:
            raise ChatError("The native publication store is outside this felis profile.")
        from app.event_driver import find_publication, publish, validate_publication

        # ponytail: this local append briefly blocks the loop so a permission change
        # cannot interleave; move to a shared transaction owner if native writes grow.
        operation = find_publication if lookup else publish
        return operation(validate_publication(publication, allow_legacy=lookup))

    def publish_return(self, publication, *, lookup=False):
        """Keep one automatic return append inside the same native profile guard."""
        expected = (self.meta_path.parent / "hermes").resolve()
        if Path(os.environ.get("HERMES_HOME", "")).resolve() != expected:
            raise ChatError("The native publication store is outside this felis profile.")
        from app.return_driver import find_publication, publish, validate_publication

        operation = find_publication if lookup else publish
        return operation(validate_publication(publication))

    async def wait_for_state(self, after: str | None) -> dict:
        if after == self.revision:
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self.change_event.wait(), 20)
        return self.snapshot()

    def snapshot(self) -> dict:
        pending = self.meta.get("pending_message")
        try:
            adaptive = self.context.snapshot()
        except (ContextStoreError, OSError):
            adaptive = self.context.memory_unavailable()
        return {
            "status": "busy" if self.busy else "error" if self.error else "ready",
            "can_send": not self.busy
            and not self.blocked
            and not self.meta.get("pending_publication"),
            "schema_version": 2,
            "tasks": public_state(self.meta["tasks"]),
            "onboarding": public_onboarding(self.meta.get("onboarding")),
            "workspace": snapshot_catalog(self.meta),
            "connections_revision": self.connections.snapshot()["revision"],
            "capabilities_revision": self.capabilities.snapshot()["revision"],
            "integrations": {
                "google_calendar": self.calendar.snapshot(),
                "briefing_sources": self.briefing.mail.snapshot(),
            },
            "workflow_run": self.meta.get("workflow_run"),
            "recovery_pending": bool(self.meta.get("pending_publication")),
            "messages": self.messages,
            "error": self.error,
            "conversation_id": self.meta.get("session_id"),
            "model": MODEL,
            "account": self.account.snapshot(),
            "request_id": self.meta.get("request_id"),
            "revision": self.revision,
            "accepted_request_ids": self.meta["accepted_requests"],
            "pending_message": {key: pending[key] for key in ("request_id", "text", "status")}
            if pending
            else None,
            "accountability": self.proactive.snapshot(),
            "return_briefing": self.returns.snapshot(),
            "reply_stream": self.reply_stream,
            "chat_context": {
                **(self.native_record.get("chat_context") or {}),
                "can_compress": bool(
                    (self.native_record.get("chat_context") or {}).get("can_compress")
                    and not self.busy
                    and not self.blocked
                    and not self.meta.get("pending_turn")
                    and not self.meta.get("pending_publication")
                ),
                "status": (self.meta.get("context_compaction") or {}).get("status", "idle"),
                "error": (self.meta.get("context_compaction") or {}).get("error"),
            },
            "adaptive": adaptive,
            "capture_status": adaptive["capture_status"],
            "current_work_context": adaptive["current_work_context"],
            "home_composition": adaptive["home_composition"],
        }

    async def command(  # noqa: ASYNC109 - timeout bounds the spawned local Hermes process.
        self,
        arguments: list[str],
        *,
        timeout: int = 30,  # noqa: ASYNC109 - bounds the spawned local Hermes process.
        observation: dict | None = None,
        launcher: str = "hermes",
        executable: Path | None = None,
        human_context: str | None = None,
        on_preview=None,
        on_context=None,
    ) -> tuple[int, str, str]:
        started = time.perf_counter()
        # Credentials come from Hermes's private home, never inherited provider variables.
        env = {
            key: os.environ[key]
            for key in (
                "HOME",
                "PATH",
                "USER",
                "LOGNAME",
                "LANG",
                "LC_ALL",
                "TZ",
                "EILO_DATA_HOME",
                "EILO_RUNTIME_HOME",
                "EILO_CACHE_HOME",
            )
            if key in os.environ
        }
        if human_context is not None:
            env["HERMES_EPHEMERAL_SYSTEM_PROMPT"] = human_context
        process = await asyncio.create_subprocess_exec(
            str(executable or ROOT / "scripts" / launcher),
            *arguments,
            cwd=ROOT,
            env=env,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
            limit=1_048_576,
        )
        if observation is not None:
            observation["spawn_ms"] = round((time.perf_counter() - started) * 1000, 3)

        async def collect(stream, name):
            if name == "stdout" and on_preview is not None:
                receipt = None
                seen_text = ""
                while line := await stream.readline():
                    if len(line) > 1_048_576:
                        raise ChatError("The live reply exceeded its display limit.")
                    try:
                        frame = json.loads(line)
                    except (ValueError, UnicodeError):
                        raise ChatError("The live reply could not be decoded.") from None
                    if not isinstance(frame, dict):
                        raise ChatError("Invalid live reply frame.")
                    if frame.get("type") == "preview" and isinstance(frame.get("text"), str):
                        text = frame["text"]
                        if (
                            len(text) <= MAX_MESSAGE
                            and text.startswith(seen_text)
                            and len(text) > len(seen_text)
                        ):
                            seen_text = text
                            on_preview(text)
                            if observation is not None:
                                observation.setdefault(
                                    "first_preview_ms",
                                    round((time.perf_counter() - started) * 1000, 3),
                                )
                    elif frame.get("type") == "context" and frame.get("status") in {
                        "compressing",
                        "compressed",
                        "idle",
                        "failed",
                    }:
                        if on_context is not None:
                            on_context(frame["status"])
                    elif frame.get("type") == "result" and isinstance(frame.get("result"), dict):
                        receipt = frame["result"]
                    else:
                        raise ChatError("Invalid live reply frame.")
                return json.dumps(receipt) if receipt is not None else ""
            chunks = []
            while chunk := await stream.read(65536):
                if observation is not None:
                    observation.setdefault(
                        f"first_{name}_ms", round((time.perf_counter() - started) * 1000, 3)
                    )
                chunks.append(chunk)
            return b"".join(chunks).decode(errors="replace")

        self.children.add(process)
        try:
            out, err, code = await asyncio.wait_for(
                asyncio.gather(
                    collect(process.stdout, "stdout"),
                    collect(process.stderr, "stderr"),
                    process.wait(),
                ),
                timeout,
            )
            if observation is not None:
                observation["total_ms"] = round((time.perf_counter() - started) * 1000, 3)
            return code, out, err
        except BaseException:
            await self.stop_child(process)
            raise
        finally:
            self.children.discard(process)

    @staticmethod
    async def stop_child(process: asyncio.subprocess.Process) -> None:
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), 5)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                await process.wait()

    async def refresh(self, observation: dict | None = None) -> None:
        if not self.meta.get("started"):
            self.messages = []
            self.native_record = {}
            return
        code, out, _ = await self.command(
            ["--read-chat", self.meta["title"]], launcher="hermes-human", observation=observation
        )
        if code:
            raise ChatError(
                "The saved conversation could not be read from Hermes. It has not been replaced."
            )
        try:
            record = json.loads(out)
            if not record:
                if self.meta.get("session_id"):
                    raise ValueError("missing session")
                return
            if record.get("title") != self.meta["title"]:
                raise ValueError("unexpected chat")
            audit_session(record, record["id"])
            self.native_record = record
            self.messages = visible_messages(
                record, self.proactive.state["events"], self.returns.state["events"]
            )
            self.reconcile_pending()
            self.meta["session_id"] = record["id"]
            self.last_audit = {
                key: record.get(key)
                for key in (
                    "model",
                    "billing_provider",
                    "billing_mode",
                    "api_call_count",
                    "tool_call_count",
                    "message_count",
                )
            }
            write_private(self.meta_path, self.meta)
        except (KeyError, TypeError, ValueError) as exc:
            raise ChatError(
                "Hermes's saved session could not be safely reopened. It has not been replaced or changed to another model."
            ) from exc

    def reconcile_pending(self) -> None:
        """Pending text is only a display receipt, discarded when native history confirms it."""
        pending = self.meta.get("pending_message")
        if not pending:
            return
        after_id = pending.get("after_message_id")
        start = 0
        if after_id is not None:
            positions = [i for i, message in enumerate(self.messages) if message["id"] == after_id]
            if not positions:
                raise ValueError("pending message anchor missing")
            start = positions[-1] + 1
        if any(
            message["role"] == "user" and message["text"] == pending["text"]
            for message in self.messages[start:]
        ):
            self.meta["pending_message"] = None

    async def initialize(self) -> None:
        try:
            check_config()
            if self._new_profile and self.meta_path == META:
                code, out, _ = await self.command(["--initialize-history"], launcher="hermes-human")
                if code or json.loads(out).get("ready") is not True:
                    raise ChatError("The local conversation store could not be initialized.")
            await self.refresh()
            await self.recover_publication()
            await self.proactive.recover_publications()
            await self.returns.recover_publications()
            if (self.meta.get("context_compaction") or {}).get("status") == "compressing":
                self.meta["context_compaction"]["status"] = "interrupted"
                self.save_meta()
            if self.meta_path == META and self.meta.get("workspace_import_version", 0) < 2:
                code, out, _ = await self.command(["--list-eilo-sessions"], launcher="hermes-human")
                if code:
                    raise ChatError(
                        "Your current chat is saved, but earlier chats could not be loaded. Reload to try again."
                    )
                try:
                    candidate = import_sessions(self.meta, json.loads(out)["sessions"])
                    candidate["workspace_import_done"] = True
                    candidate["workspace_import_version"] = 2
                    self.commit_meta(candidate)
                except (ValueError, KeyError, TypeError) as exc:
                    raise ChatError(
                        "The earlier-chat list could not be verified. Your current conversation is preserved."
                    ) from exc
            if self.meta.get("pending") or self.meta.get("pending_turn"):
                self.error = "The previous reply was interrupted when the app stopped. Saved messages are shown; no message was automatically resent."
                self.meta["pending"] = False
                if self.meta.get("pending_message"):
                    self.meta["pending_message"]["status"] = "interrupted"
                write_private(self.meta_path, self.meta)
        except ChatError as exc:
            self.error, self.blocked = str(exc), True
        self.changed()

    async def send(self, text: str, request_id: str, *, chat_id: str | None = None) -> dict:
        began = time.perf_counter()
        began_unix_ms = time.time() * 1000
        async with self.lock:
            catalog = self.meta["chat_catalog"]
            if (chat_id is not None and chat_id != catalog["active_chat_id"]) or (
                chat_id is None and len(catalog["chats"]) > 1
            ):
                raise CatalogError(
                    "The active chat changed. Reopen the conversation before sending.", 409
                )
            if request_id in self.meta["accepted_requests"]:
                return self.snapshot()
            if self.busy:
                raise web.HTTPConflict(
                    text=json.dumps({"error": "A reply is already in progress."}),
                    content_type="application/json",
                )
            try:
                check_config()
            except ChatError as exc:
                self.error, self.blocked = str(exc), True
                self.changed()
                raise
            if self.blocked:
                raise ChatError(
                    self.error or "This conversation needs attention before it can continue."
                )
            if self.meta.get("pending_publication"):
                raise ChatError(
                    "The last change is saved, but its reply still needs to be recovered. Reload the app before sending another message."
                )
            self.error = None
            self.reply_stream = None
            self.proactive.on_human(text, request_id)
            self.returns.on_human(text, request_id)
            self.context.on_human(text)
            catalog = self.meta["chat_catalog"]
            active = next(c for c in catalog["chats"] if c["id"] == catalog["active_chat_id"])
            if active["name"] == "New chat" and not self.meta.get("started"):
                active["name"] = re.sub(r"\s+", " ", text).strip()[:80]
                catalog["revision"] += 1
            self.meta.update(
                started=True,
                pending=True,
                request_id=request_id,
                pending_turn={
                    "request_id": request_id,
                    "based_on_revision": (
                        self.meta["onboarding"]["draft_tasks"]["revision"]
                        if active_onboarding(self.meta.get("onboarding"))
                        else self.meta["tasks"]["revision"]
                    ),
                    **(
                        {"onboarding_revision": self.meta["onboarding"]["revision"]}
                        if active_onboarding(self.meta.get("onboarding"))
                        else {}
                    ),
                },
                pending_message={
                    "request_id": request_id,
                    "text": text,
                    "status": "accepted",
                    "after_message_id": self.messages[-1]["id"] if self.messages else None,
                },
            )
            self.meta["accepted_requests"] = (self.meta["accepted_requests"] + [request_id])[-100:]
            write_private(self.meta_path, self.meta)
            timing = {
                "request_id": request_id,
                "received_at_unix_ms": round(began_unix_ms, 3),
                "accept_ms": round((time.perf_counter() - began) * 1000, 3),
            }
            self.task = asyncio.create_task(
                self.serial_human_turn(text, began, timing), name="user-requested-hermes-turn"
            )
            self.task.add_done_callback(lambda _: self.context.resume_after_human())
            self.changed()
            return self.snapshot()

    async def serial_human_turn(self, text: str, began: float, timing: dict) -> None:
        await self.returns.wait_for_preempted_event()
        await self.proactive.wait_for_preempted_event()
        async with self.native_lock:
            await self.run_turn(text, began, timing)

    def commit_meta(self, candidate: dict) -> None:
        """Publish in memory only after the entire private journal is durable."""
        write_private(self.meta_path, candidate)
        self.meta = candidate
        self.proactive.state = self.meta["accountability"]
        self.returns.state = self.meta["return_briefing"]
        self.proactive.ledger.state = self.meta
        self.proactive.ledger.journal = self.meta["activity_journal"]

    def stage_publication(self, receipt: dict) -> None:
        pending = self.meta.get("pending_turn")
        if (
            not pending
            or receipt.get("request_id") != pending["request_id"]
            or receipt.get("session_id") != self.meta["session_id"]
        ):
            raise ChatError(
                "The response could not be matched to your message. Your tasks were not changed."
            )
        candidate = deepcopy(self.meta)
        request_id = pending["request_id"]
        try:
            proposal = validate_proposal(
                receipt.get("proposal"),
                request_id=request_id,
                revision=pending["based_on_revision"],
            )
            if proposal["kind"] == "update" and pending.get("source_used"):
                raise TaskError("Source-based task changes need a separate user confirmation.")
            if proposal["kind"] == "update":
                source = {
                    "kind": "human",
                    "session_id": receipt["session_id"],
                    "user_id": str(receipt["user_id"]),
                    "assistant_id": str(receipt["assistant_id"]),
                }
                if "onboarding_revision" in pending:
                    candidate["onboarding"] = stage_onboarding(
                        candidate.get("onboarding"),
                        proposal["operations"],
                        based_on_revision=pending["onboarding_revision"],
                        request_id=request_id,
                        source=source,
                    )
                    reply = (
                        "How does this look?"
                        if candidate["onboarding"]["status"] == "proposed"
                        else "What would you like this workspace to help you accomplish?"
                    )
                    disposition = "chat"
                else:
                    candidate["tasks"], reply = apply_operations(
                        candidate["tasks"],
                        proposal["operations"],
                        based_on_revision=proposal["based_on_revision"],
                        request_id=request_id,
                        source=source,
                    )
                    if len(reply) > 7500:
                        reply = f"Saved all {len(proposal['operations'])} requested task changes. They are shown in your task list."
                    disposition = "committed"
            else:
                reply, disposition = proposal["reply"], proposal["kind"]
                # A second guard for an inconsistent *claim*, never an intent parser.
                # Only validated operations can produce a success acknowledgment.
                if re.search(
                    r"\b(?:i(?:'ve| have)? (?:saved|added|updated|completed|cancelled|canceled|reopened|deleted|removed|restored|set your)|(?:task|goal) (?:is |has been )?saved)\b",
                    reply,
                    re.I,
                ):
                    reply = "I couldn't confirm that task change. Your saved tasks are unchanged."
                    disposition = "clarify"
        except (TaskError, OnboardingError, TypeError, KeyError):
            reply = "I couldn't finish that reply. Your message is saved, and nothing was changed."
            disposition = "rejected"
        candidate["pending_publication"] = {
            "session_id": receipt["session_id"],
            "session_title": candidate["title"],
            "request_id": request_id,
            "assistant_id": receipt["assistant_id"],
            "public_reply": reply,
            "disposition": disposition,
        }
        self.commit_meta(candidate)
        if disposition == "committed":
            self.proactive.invalidate()
            self.proactive.state["last_fingerprint"] = None

    async def publish_staged_reply(self) -> None:
        publication = self.meta.get("pending_publication")
        if not publication:
            return
        path = self.meta_path.parent / ("publish-" + uuid.uuid4().hex + ".json")
        try:
            write_private(path, publication)
            code, out, _ = await self.command(["--finalize", str(path)], launcher="hermes-human")
            result = json.loads(out) if code == 0 else {}
            if (
                result.get("session_id") != publication["session_id"]
                or result.get("request_id") != publication["request_id"]
                or str(result.get("assistant_id")) != str(publication["assistant_id"])
                or result.get("published") is not True
            ):
                raise ChatError(
                    "The change receipt needs recovery before another message can be sent. Your saved tasks are shown; retry the saved reply."
                )
            await self.refresh()
            candidate = deepcopy(self.meta)
            candidate.update(pending_publication=None, pending_turn=None, pending=False)
            self.commit_meta(candidate)
        finally:
            path.unlink(missing_ok=True)

    async def recover_publication(self) -> None:
        """Resume only a recorded transaction; never resend a prompt or infer history."""
        pending = self.meta.get("pending_turn")
        if pending and pending.get("source_used"):
            # A source permission capability expires with its turn. Never resurrect
            # a source-backed answer or task edit after an interruption/restart.
            self.meta.update(pending_publication=None, pending_turn=None, pending=False)
            self.error = (
                "The source check was interrupted. Ask again to use your current source settings."
            )
            self.save_meta()
            return
        if not self.meta.get("pending_publication") and self.meta.get("pending_turn"):
            pending = self.meta["pending_turn"]
            rows = self.native_record.get("messages", [])
            assistants = [
                row
                for row in rows
                if row.get("display_kind") == "eilo_human_proposal"
                and (row.get("display_metadata") or {}).get("request_id") == pending["request_id"]
            ]
            users = [
                row
                for row in rows
                if row.get("role") == "user"
                and (row.get("display_metadata") or {}).get("lane") == "eilo_human"
                and (row.get("display_metadata") or {}).get("request_id") == pending["request_id"]
            ]
            if len(assistants) == 1 and len(users) == 1:
                # Recover only a native pair bound to this exact caller-owned
                # revision. Never trust correlation copied into model prose.
                if any(
                    (row.get("display_metadata") or {}).get("based_on_revision")
                    != pending["based_on_revision"]
                    for row in (users[0], assistants[0])
                ):
                    raise ChatError(
                        "The saved response could not be matched to this turn. Your tasks were not changed."
                    )
                proposal = bind_model_proposal(
                    assistants[0].get("content", ""),
                    request_id=pending["request_id"],
                    revision=pending["based_on_revision"],
                )
                self.stage_publication(
                    {
                        "session_id": self.meta["session_id"],
                        "request_id": pending["request_id"],
                        "assistant_id": int(assistants[0]["id"]),
                        "user_id": int(users[0]["id"]),
                        "proposal": proposal,
                    }
                )
        await self.publish_staged_reply()

    async def control_onboarding(self, body: dict) -> dict:
        async with self.lock:
            if not self.meta.get("onboarding"):
                raise OnboardingError("This workspace already has its own setup.", 409)
            if self.busy or self.meta.get("pending_publication"):
                raise TaskConflict("Wait for the current reply before changing setup.")
            if (
                isinstance(body, dict)
                and body.get("action") == "accept"
                and (self.error or self.meta.get("pending_turn"))
            ):
                raise TaskConflict("Recover or retry the last reply before approving this preview.")
            setup, tasks = apply_onboarding_command(
                self.meta["onboarding"], self.meta["tasks"], body
            )
            candidate = deepcopy(self.meta)
            candidate["onboarding"], candidate["tasks"] = setup, tasks
            self.commit_meta(candidate)
            self.proactive.invalidate()
            self.returns.invalidate()
            await self.returns.wait_for_preempted_event()
            self.changed()
            return self.snapshot()

    async def control_tasks(
        self, operations: list, request_id: str, based_on_revision: int, conversation_id=None
    ) -> dict:
        async with self.lock:
            if conversation_id is not None and conversation_id != self.meta.get("session_id"):
                raise TaskConflict(
                    "The conversation changed. Choose an item from the current workspace."
                )
            if request_id in self.meta["tasks"]["applied_requests"]:
                return self.snapshot()
            if self.busy or self.meta.get("pending_publication"):
                raise TaskConflict("Wait for the current reply before changing tasks.")
            # Validate before preempting anything; both controls and chat use this transaction.
            updated, _ = apply_operations(
                self.meta["tasks"],
                operations,
                based_on_revision=based_on_revision,
                request_id=request_id,
                source={"kind": "control"},
            )
            self.proactive.on_human("", request_id)
            self.returns.on_human("", request_id)
            await self.returns.wait_for_preempted_event()
            await self.proactive.wait_for_preempted_event()
            candidate = deepcopy(self.meta)
            candidate["tasks"] = updated
            # Direct goal controls are an explicit alternative to guided setup.
            if active_onboarding(candidate.get("onboarding")):
                candidate["onboarding"]["status"] = "skipped"
                candidate["onboarding"]["revision"] += 1
            candidate["accountability"]["last_fingerprint"] = None
            self.commit_meta(candidate)
            self.error = None
            self.changed()
            return self.snapshot()

    async def control_activity_records(
        self, action, session_id, request_id, based_on_revision, conversation_id
    ):
        async with self.lock:
            if conversation_id != self.meta.get("session_id"):
                raise TaskConflict(
                    "The conversation changed. Choose a record from the current workspace."
                )
            ledger = self.proactive.ledger
            # Validate before preempting; an idempotent receipt must still match its payload.
            ledger.plan_control(action, session_id, request_id, based_on_revision)
            if ledger.has_control_receipt(request_id):
                return self.snapshot()
            if self.busy or self.meta.get("pending_publication"):
                raise TaskConflict("Wait for the current reply before changing activity records.")
            self.proactive.on_human("", request_id)
            self.returns.on_human("", request_id)
            await self.returns.wait_for_preempted_event()
            await self.proactive.wait_for_preempted_event()
            # Sampling can continue while a cancelled event settles. Preserve those samples.
            journal = ledger.plan_control(action, session_id, request_id, based_on_revision)
            candidate = deepcopy(self.meta)
            candidate["activity_journal"] = journal
            candidate["accountability"]["last_fingerprint"] = None
            self.commit_meta(candidate)
            self.proactive.latest, self.proactive.stable_since = None, 0
            self.error = None
            self.changed()
            return self.snapshot()

    async def run_turn(self, text: str, began: float, timing: dict) -> None:
        path = self.meta_path.parent / ("human-" + uuid.uuid4().hex + ".json")
        source_turn = None
        try:
            request_id = self.meta["pending_turn"]["request_id"]
            capability_profile = self.capabilities.active()
            source_turn = await self.briefing.open(
                request_id, allowed_sources=set(capability_profile["sources"])
            )
            write_private(
                path,
                {
                    "session_id": self.meta["session_id"],
                    "session_title": self.meta["title"],
                    "request_id": request_id,
                    "text": text,
                    "task_state": public_state(
                        self.meta["onboarding"]["draft_tasks"]
                        if "onboarding_revision" in self.meta["pending_turn"]
                        else self.meta["tasks"]
                    ),
                    **(
                        {
                            "onboarding": {
                                "widgets": self.meta["onboarding"]["widgets"],
                                "support_source": self.meta["onboarding"]["support_source"],
                            }
                        }
                        if "onboarding_revision" in self.meta["pending_turn"]
                        else {}
                    ),
                    "context_bridge": source_turn.capability(),
                    "capabilities": {
                        "skills": capability_profile["skills"],
                        "mcp_servers": capability_profile["mcp_servers"],
                        "plugins": capability_profile["plugins"],
                    },
                },
            )
            timing["native_process"] = {}

            def preview(value):
                if self.meta.get("request_id") == request_id and self.meta.get("pending"):
                    if source_turn.touched:
                        source_turn.check()
                        if not any(s["id"] == "answer" for s in source_turn.run["steps"]):
                            source_turn.writing()
                    self.reply_stream = {"id": request_id, "text": value, "status": "writing"}
                    self.changed()

            def context_status(status):
                if self.meta.get("request_id") == request_id:
                    previous = (self.meta.get("context_compaction") or {}).get("status")
                    if previous != status:
                        self.meta["context_compaction"] = {"status": status, "source": "automatic"}
                        self.save_meta()
                        self.changed()

            code, out, err = await self.command(
                ["--input", str(path), "--stream"],
                launcher="hermes-human",
                timeout=210,
                observation=timing["native_process"],
                on_preview=preview,
                on_context=context_status,
            )
            if code:
                await self.refresh()
                await self.recover_publication()
                if self.meta.get("pending_turn"):
                    if (self.meta.get("context_compaction") or {}).get("status") in {
                        "compressing",
                        "failed",
                    }:
                        self.meta["context_compaction"]["status"] = "failed"
                        self.error = "Context could not be summarized. Try Summarize now or start a new chat; your saved messages are available."
                    else:
                        self.error = runtime_error(err)
            else:
                receipt = json.loads(out)
                if receipt.get("context_status") in {"compressed", "failed"}:
                    context_status(receipt["context_status"])
                audit = receipt.get("audit", {})
                if (
                    audit.get("model") != MODEL
                    or audit.get("provider") != PROVIDER
                    or audit.get("tool_schema_count", 0) < len(TOOL_NAMES)
                    or audit.get("mcp_servers") != capability_profile["mcp_servers"]
                    or audit.get("skills") != capability_profile["skills"]
                    or audit.get("plugins") != capability_profile["plugins"]
                    or receipt.get("request_id") != request_id
                    or type(receipt.get("assistant_id")) is not int
                    or type(receipt.get("user_id")) is not int
                ):
                    raise ChatError(
                        "The native response could not be verified. Your tasks were not changed."
                    )
                self.meta["session_id"] = receipt["session_id"]
                timing["export_process"] = {}
                await self.refresh(timing["export_process"])
                if source_turn.touched:
                    source_turn.check()
                self.stage_publication(receipt)
                rejected = self.meta["pending_publication"]["disposition"] == "rejected"
                await self.publish_staged_reply()
                source_turn.finish("failed" if self.error or rejected else "completed")
        except TimeoutError:
            self.error = "The reply timed out. No automatic retry was sent. Reopen the app to check saved messages before trying again."
        except asyncio.CancelledError:
            if not source_turn or not (source_turn.cancelled or source_turn.invalidated):
                # Native shutdown keeps the pending receipt for honest restart recovery.
                raise
            self.error = "Stopped. Your message is saved; no work was automatically retried."
            if source_turn and source_turn.invalidated:
                self.error = (
                    "Source access changed, so this check stopped. Your saved tasks are unchanged."
                )
            self.meta.update(pending=False, pending_turn=None, pending_publication=None)
            self.reply_stream = None
            with contextlib.suppress(Exception):
                await self.refresh()
            if source_turn:
                source_turn.finish("cancelled")
        except ChatError as exc:
            self.error = str(exc)
            self.blocked = not bool(self.meta.get("pending_publication"))
        except Exception:
            self.error = "The local connection failed. Reopen the app to check saved messages; no automatic retry was sent."
        finally:
            if (self.meta.get("context_compaction") or {}).get("status") == "compressing":
                self.meta["context_compaction"]["status"] = "failed"
            path.unlink(missing_ok=True)
            if source_turn:
                if source_turn.run["status"] == "running":
                    source_turn.finish("failed")
                await source_turn.close()
            if self.reply_stream:
                self.reply_stream = (
                    {**self.reply_stream, "status": "interrupted"}
                    if self.error or self.meta.get("pending_turn")
                    else None
                )
        self.meta["pending"] = False
        if self.meta.get("pending_message"):
            self.meta["pending_message"]["status"] = "failed"
        write_private(self.meta_path, self.meta)
        timing["accept_to_complete_ms"] = round((time.perf_counter() - began) * 1000, 3)
        timing["completed_at_unix_ms"] = round(time.time() * 1000, 3)
        if self.timing_path is not None:
            write_private(self.timing_path, timing)
        self.changed()

    async def new_conversation(self) -> dict:
        return await self.control_catalog(
            {"action": "new_chat", "based_on_revision": self.meta["chat_catalog"]["revision"]}
        )

    async def read_catalog_conversation(self, conversation: dict) -> dict:
        if not conversation.get("started"):
            return {}
        code, out, _ = await self.command(
            ["--read-chat", conversation["title"]], launcher="hermes-human"
        )
        try:
            record = json.loads(out)
            if code or record.get("title") != conversation["title"]:
                raise ValueError("unreadable native session")
            audit_session(record, record["id"])
            return record
        except (ValueError, TypeError, KeyError) as exc:
            raise ChatError(
                "This chat could not be safely reopened. Your current conversation is still open."
            ) from exc

    async def compress_context(self, body: dict) -> dict:
        async with self.lock:
            if not isinstance(body, dict) or set(body) != {
                "action",
                "request_id",
                "conversation_id",
                "based_on_revision",
            }:
                raise CatalogError("Invalid context command.")
            request_id = body["request_id"]
            if (
                body["action"] != "compress"
                or not isinstance(request_id, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", request_id)
            ):
                raise CatalogError("Invalid context command.")
            if request_id in self.meta.get("accepted_context_requests", []):
                return self.snapshot()
            if (
                not self.meta.get("session_id")
                or body["conversation_id"] != self.meta["session_id"]
            ):
                raise CatalogError("The chat changed. Reopen context details.", 409)
            if body["based_on_revision"] != self.revision:
                raise CatalogError(
                    "Context changed. Check the refreshed details and try again.", 409
                )
            if (
                self.busy
                or self.meta.get("pending")
                or self.meta.get("pending_turn")
                or self.meta.get("pending_publication")
            ):
                raise CatalogError("Wait for this reply before summarizing.", 409)
            if self.blocked:
                raise ChatError(self.error or "Recover this conversation before summarizing.")
            check_config()
            candidate = deepcopy(self.meta)
            candidate["accepted_context_requests"] = (
                candidate.get("accepted_context_requests", []) + [request_id]
            )[-100:]
            candidate["context_compaction"] = {
                "request_id": request_id,
                "status": "compressing",
                "source": "manual",
            }
            self.commit_meta(candidate)
            self.proactive.invalidate()
            self.returns.invalidate()
            self.task = asyncio.create_task(
                self.run_compaction(), name="user-requested-context-summary"
            )
            self.task.add_done_callback(lambda _: self.context.resume_after_human())
            self.changed()
            return self.snapshot()

    async def run_compaction(self) -> None:
        try:
            await self.returns.wait_for_preempted_event()
            await self.proactive.wait_for_preempted_event()
            async with self.native_lock:
                code, out, _ = await self.command(
                    ["--compress-chat", self.meta["title"]], launcher="hermes-human", timeout=210
                )
                result = json.loads(out) if code == 0 else {}
                await self.refresh()
                if result.get("session_id") != self.meta.get("session_id") or result.get(
                    "status"
                ) not in {"compressed", "unchanged", "failed"}:
                    raise ChatError(
                        "The summary could not be confirmed. Your saved chat is available."
                    )
                self.meta["context_compaction"]["status"] = result["status"]
        except asyncio.CancelledError:
            # The durable running receipt becomes interrupted on restart; no replay.
            raise
        except Exception:
            self.meta["context_compaction"]["status"] = "failed"
            self.meta["context_compaction"]["error"] = (
                "Couldn’t confirm the summary. Check context before trying again."
            )
            with contextlib.suppress(ChatError):
                await self.refresh()
        finally:
            self.save_meta()
            self.changed()

    async def control_catalog(self, body: dict) -> dict:
        async with self.lock:
            if (
                self.busy
                or self.meta.get("pending")
                or self.meta.get("pending_turn")
                or self.meta.get("pending_publication")
            ):
                raise CatalogError(
                    "Wait for the current reply before changing chats or projects.", 409
                )
            planned = apply_catalog(self.meta, body)
            switching = (
                planned["chat_catalog"]["active_chat_id"]
                != self.meta["chat_catalog"]["active_chat_id"]
            )
            if not switching:
                self.commit_meta(planned)
                self.changed()
                return self.snapshot()
            self._catalog_changing = True
            self.context.on_chat_change()
            self.changed()
            try:
                self.proactive.invalidate()
                self.returns.invalidate()
                await self.returns.wait_for_preempted_event()
                await self.proactive.wait_for_preempted_event()
                async with self.native_lock:
                    record = await self.read_catalog_conversation(planned)
                    # Activity may have arrived during export. Keep the latest global state.
                    candidate = deepcopy(self.meta)
                    candidate["chat_catalog"] = planned["chat_catalog"]
                    for key in CONVERSATION_KEYS:
                        candidate[key] = deepcopy(planned.get(key))
                    if record:
                        candidate["session_id"] = record["id"]
                    messages = visible_messages(
                        record, self.proactive.state["events"], self.returns.state["events"]
                    )
                    pending = candidate.get("pending_message")
                    if pending:
                        anchor = pending.get("after_message_id")
                        positions = [i for i, item in enumerate(messages) if item["id"] == anchor]
                        if anchor is not None and not positions:
                            raise ChatError(
                                "The saved message receipt needs attention. Your current conversation is still open."
                            )
                        start = positions[-1] + 1 if positions else 0
                        if any(
                            m["role"] == "user" and m["text"] == pending["text"]
                            for m in messages[start:]
                        ):
                            candidate["pending_message"] = None
                    self.commit_meta(candidate)
                    self.native_record = record
                    self.messages = messages
                    self.reply_stream = None
                    self.proactive.stream = None
                    self.error, self.blocked, self.last_audit = None, False, {}
                    self.save_meta()
            finally:
                self._catalog_changing = False
                self.changed()
            return self.snapshot()

    async def close(self) -> None:
        await self.account.close()
        await self.context_capture.close()
        await self.context.aclose()
        await self.connections.close()
        await self.returns.close()
        await self.proactive.close()
        self.changed()
        if self.task is not None and not self.task.done():
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        for process in tuple(self.children):
            await self.stop_child(process)
