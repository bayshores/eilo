"""Loopback conversation UI; Hermes owns all model work and durable messages."""
from __future__ import annotations

import argparse
import base64
import binascii
import asyncio
import contextlib
from copy import deepcopy
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import sys
import time
import uuid

from aiohttp import web
import psutil
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.accountability import canonical_goal_message, validate_decision
from app.proactive import ProactiveLoop
from app.transcription import Transcriber
from app.google_calendar import GoogleCalendarConnection, CalendarError
from app.briefing import Briefing, TOOL_NAMES
from app.chat_catalog import (CONVERSATION_KEYS, CatalogError, ensure_catalog,
                              snapshot_catalog, apply_catalog, import_sessions)
from app.connections import Connections, ConnectionError
from app.tasks import (TaskError, TaskConflict, apply_operations, migrate_legacy,
                       initial_tasks, public_state, validate_proposal, bind_model_proposal)
STATE = ROOT / ".state"
META = STATE / "local-chat.json"
PID_FILE = STATE / "local-chat-process.json"
WEB = ROOT / "app/web"
HOME = ROOT / "prototypes/widget-home"
HOME_ASSETS = {
    "index.html": "index.html", "app.js": "app.js", "styles.css": "styles.css", "typography.css": "typography.css",
    "layout.js": "layout.js", "hold.js": "hold.js", "fixtures.js": "fixtures.js",
    "home-client.js": "home-client.js", "home-data.js": "home-data.js", "home-live.js": "home-live.js",
    "home-live.css": "home-live.css",
    **{name:name for name in ("connections-manager.js", "connections-manager.css", "chat-library.js", "chat-library.css", "chat-switcher.js", "chat-switcher.css", "local-commands.js")},
    **{name:name for name in ("workflow-progress.js", "workflow-progress.css", "briefing-sources.js", "briefing-sources.css")},
    **{name:name for name in ("calendar-connection.js", "calendar-connection.css", "calendar-agenda.js")},
    **{name:name for name in ("task-edit.js", "item-controls.js", "item-controls.css")},
    "workspace-views.js":"workspace-views.js", "workspace-views.css":"workspace-views.css", "goals-data.js":"goals-data.js",
    **{name:name for name in ("checkin-center.js", "checkin-center.css", "checkin-data.js")},
    **{name:name for name in ("update-queue.js", "live-updates.js", "activity-session.js", "speech-input.js", "speech-capture.js", "mic-worklet.js", "speech.css")},
    "activity-client.js": "activity-client.js", "activity-config.js": "activity-config.js", "assets/fonts/ibm-plex-sans.woff2": "assets/fonts/ibm-plex-sans.woff2",
}
MODEL = "gpt-5.6-luna"
PROVIDER = "openai-codex"
MAX_MESSAGE = 12_000


class ChatError(Exception):
    """A deliberately user-safe error; never forward raw runtime diagnostics."""


def write_private(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".new")
    with temporary.open("w") as stream:
        temporary.chmod(0o600)
        stream.write(json.dumps(value, indent=2) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def check_config() -> None:
    """Fail closed if this pinned CLI's approved model/tool configuration changes."""
    try:
        from hermes_cli.config import load_config
        from hermes_cli.tools_config import _get_platform_tools
        from model_tools import get_tool_definitions

        raw = yaml.safe_load((STATE / "hermes/config.yaml").read_text())
        if raw.get("model", {}).get("default") != MODEL or raw["model"].get("provider") != PROVIDER:
            raise ValueError("model")
        cfg = load_config()
        if cfg.get("fallback_providers") or cfg.get("mcp_servers"):
            raise ValueError("external providers/tools")
        enabled = _get_platform_tools(cfg, "cli")
        if enabled or get_tool_definitions(enabled_toolsets=list(enabled), quiet_mode=True):
            raise ValueError("tools")
    except Exception as exc:
        raise ChatError("The local configuration needs attention. This chat requires Luna, the Codex subscription, and no action tools or fallback providers.") from exc


def visible_messages(record: dict, events: dict | None = None) -> list[dict]:
    """The native export stays private; only visible text crosses the UI boundary."""
    messages = []
    current_event = None
    current_human = None
    for message in record.get("messages", []):
        metadata = message.get("display_metadata") or {}
        if message.get("display_kind") == "eilo_observation":
            current_event = metadata.get("event_id") if isinstance(metadata, dict) else None
            current_human = None
            continue
        if message.get("role") == "user" and not message.get("display_kind"):
            current_event = None
            current_human = metadata.get("request_id") if metadata.get("lane") == "eilo_human" else None
        if message.get("role") == "assistant" and (current_human or message.get("display_kind") == "eilo_human_proposal"):
            if (message.get("display_kind") == "eilo_human_proposal" and metadata.get("published") is True
                    and str(metadata.get("assistant_id")) == str(message.get("id"))
                    and isinstance(metadata.get("public_reply"), str) and metadata["public_reply"].strip()):
                messages.append({"id": str(message["id"]), "role": "assistant", "text": metadata["public_reply"]})
            continue
        if message.get("role") == "assistant" and (current_event or message.get("display_kind") == "eilo_decision"):
            event_id = metadata.get("event_id", current_event) if isinstance(metadata, dict) else current_event
            delivery = (events or {}).get(event_id, {})
            if delivery.get("status") == "delivered" and str(message.get("id")) == delivery.get("assistant_id"):
                try:
                    decision = validate_decision(json.loads(message.get("content", "")), event_id)
                except (ValueError, TypeError):
                    decision = None
                if decision and decision["decision"] != "quiet":
                    messages.append({"id": str(message["id"]), "role": "assistant", "text": decision["message"], "origin": "check_in", "event_id": event_id})
            continue
        if message.get("role") not in ("user", "assistant") or message.get("display_kind"):
            continue
        content = message.get("content")
        if isinstance(content, list):
            content = "\n".join(block.get("text", "") for block in content
                                if isinstance(block, dict) and block.get("type") == "text")
        if isinstance(content, str) and content.strip():
            messages.append({"id": str(message.get("id", len(messages))),
                             "role": message["role"], "text": content})
    return messages


def audit_session(record: dict, expected_id: str | None) -> None:
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
        if isinstance(tool_calls, str): tool_calls = json.loads(tool_calls)
        for call in tool_calls:
            name = (call.get("function") or {}).get("name")
            if name not in TOOL_NAMES or not isinstance(call.get("id"), str):
                raise ValueError("unapproved tool activity")
            calls[call["id"]] = name
        if message.get("role") == "tool":
            if message.get("tool_call_id") not in calls:
                raise ValueError("unmatched tool activity")
        if message.get("tool_name") and message["tool_name"] not in TOOL_NAMES:
            raise ValueError("unapproved tool activity")


def runtime_error(diagnostic: str) -> str:
    diagnostic = diagnostic.lower()
    if any(word in diagnostic for word in ("429", "quota", "rate limit", "usage limit")):
        return "The Codex subscription is currently at a usage limit. Try again after it resets; no other provider was used."
    if any(word in diagnostic for word in ("401", "unauthorized", "re-auth", "relogin", "auth_missing")):
        return "Hermes could not use its saved subscription sign-in. The connection needs attention; no new login or fallback was started."
    return "Hermes could not finish that reply. Your saved conversation is still here. Check the connection, then send another message."


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
        if self.meta_path.exists():
            self.meta = json.loads(self.meta_path.read_text())
            if not re.fullmatch(r"eilo-ui-[a-f0-9]{32}", self.meta.get("title", "")):
                raise ChatError("The local conversation pointer is invalid. It has not been replaced.")
        else:
            self.meta = self.fresh_meta()
            write_private(self.meta_path, self.meta)
        if "tasks" not in self.meta:
            self.meta["tasks"] = migrate_legacy(self.meta.get("accountability", {}).get("goal"))
            write_private(self.meta_path, self.meta)
        try:
            catalog_meta = ensure_catalog(self.meta)
        except CatalogError as exc:
            raise ChatError("The saved chat library needs attention. It has not been replaced.") from exc
        if catalog_meta != self.meta:
            write_private(self.meta_path, catalog_meta)
        self.meta = catalog_meta
        self.calendar = GoogleCalendarConnection(ROOT if meta_path == META else meta_path.parent / "calendar", on_change=self.changed)
        self.briefing = Briefing(self, ROOT if meta_path == META else meta_path.parent / "calendar")
        self.proactive = ProactiveLoop(self, helper=ROOT / ".runtime/eilo-activity-helper/eilo-activity-helper.app/Contents/MacOS/EiloActivityHelper")
        self.connections = Connections(self, ROOT if meta_path == META else meta_path.parent / "calendar")
        for event in self.proactive.state["events"].values():
            if event.get("status") == "running":
                event["status"] = "stale"

    def save_meta(self) -> None:
        write_private(self.meta_path, self.meta)

    @staticmethod
    def fresh_meta() -> dict:
        return {"version": 2, "title": "eilo-ui-" + uuid.uuid4().hex,
                "session_id": None, "started": False, "pending": False,
                "request_id": None, "accepted_requests": [], "pending_message": None,
                "pending_turn": None, "pending_publication": None, "tasks": initial_tasks()}

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

    async def wait_for_state(self, after: str | None) -> dict:
        if after == self.revision:
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self.change_event.wait(), 20)
        return self.snapshot()

    def snapshot(self) -> dict:
        pending = self.meta.get("pending_message")
        return {"status": "busy" if self.busy else "error" if self.error else "ready",
                "can_send": not self.busy and not self.blocked and not self.meta.get("pending_publication"),
                "schema_version": 2, "tasks": public_state(self.meta["tasks"]),
                "workspace": snapshot_catalog(self.meta),
                "connections_revision": self.connections.snapshot()["revision"],
                "integrations": {"google_calendar": self.calendar.snapshot(), "briefing_sources": self.briefing.mail.snapshot()},
                "workflow_run": self.meta.get("workflow_run"),
                "recovery_pending": bool(self.meta.get("pending_publication")),
                "messages": self.messages, "error": self.error,
                "conversation_id": self.meta.get("session_id"), "model": MODEL,
                "request_id": self.meta.get("request_id"), "revision": self.revision,
                "accepted_request_ids": self.meta["accepted_requests"],
                "pending_message": {key: pending[key] for key in ("request_id", "text", "status")} if pending else None,
                "accountability": self.proactive.snapshot(), "reply_stream": self.reply_stream}

    async def command(self, arguments: list[str], *, timeout: int = 30,
                      observation: dict | None = None, launcher: str = "hermes",
                      executable: Path | None = None, human_context: str | None = None, on_preview=None) -> tuple[int, str, str]:
        started = time.perf_counter()
        # Credentials come from Hermes's private home, never inherited provider variables.
        env = {key: os.environ[key] for key in ("HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "TZ") if key in os.environ}
        if human_context is not None:
            env["HERMES_EPHEMERAL_SYSTEM_PROMPT"] = human_context
        process = await asyncio.create_subprocess_exec(
            str(executable or ROOT / "scripts" / launcher), *arguments,
            cwd=ROOT, env=env, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=True, limit=1_048_576)
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
                        if len(text) <= MAX_MESSAGE and text.startswith(seen_text) and len(text) > len(seen_text):
                            seen_text = text
                            on_preview(text)
                            if observation is not None:
                                observation.setdefault("first_preview_ms", round((time.perf_counter()-started)*1000, 3))
                    elif frame.get("type") == "result" and isinstance(frame.get("result"), dict):
                        receipt = frame["result"]
                    else:
                        raise ChatError("Invalid live reply frame.")
                return json.dumps(receipt) if receipt is not None else ""
            chunks = []
            while chunk := await stream.read(65536):
                if observation is not None:
                    observation.setdefault(f"first_{name}_ms", round((time.perf_counter() - started) * 1000, 3))
                chunks.append(chunk)
            return b"".join(chunks).decode(errors="replace")

        self.children.add(process)
        try:
            out, err, code = await asyncio.wait_for(asyncio.gather(
                collect(process.stdout, "stdout"), collect(process.stderr, "stderr"), process.wait()), timeout)
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
            except asyncio.TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                await process.wait()

    async def refresh(self, observation: dict | None = None) -> None:
        if not self.meta.get("started"):
            self.messages = []
            return
        if not self.meta.get("session_id"):
            code, out, _ = await self.command(["--resolve-title", self.meta["title"]], launcher="hermes-human")
            try:
                resolved = json.loads(out) if code == 0 else {}
                if resolved.get("session_title") != self.meta["title"]:
                    raise ValueError("unverified title lookup")
                self.meta["session_id"] = resolved.get("session_id")
            except (TypeError, ValueError) as exc:
                raise ChatError("The saved conversation could not be located safely. It has not been replaced.") from exc
            if not self.meta["session_id"]:
                self.messages = []
                return
        selector = ["--session-id", self.meta["session_id"]]
        code, out, _ = await self.command(["sessions", "export", "--format", "jsonl", "--redact", "--yes", *selector, "-"], observation=observation)
        if code:
            raise ChatError("The saved conversation could not be read from Hermes. It has not been replaced.")
        try:
            records = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
            if not self.meta.get("session_id"):
                records = [r for r in records if r.get("title") == self.meta["title"]]
            if not records:
                if self.meta.get("session_id"):
                    raise ValueError("missing session")
                self.messages = []
                return
            if len(records) != 1:
                raise ValueError("ambiguous session")
            record = records[0]
            audit_session(record, self.meta.get("session_id"))
            self.native_record = record
            self.messages = visible_messages(record, self.proactive.state["events"])
            self.reconcile_pending()
            self.meta["session_id"] = record["id"]
            self.last_audit = {key: record.get(key) for key in
                               ("model", "billing_provider", "billing_mode", "api_call_count", "tool_call_count", "message_count")}
            write_private(self.meta_path, self.meta)
        except (KeyError, TypeError, ValueError) as exc:
            raise ChatError("Hermes's saved session could not be safely reopened. It has not been replaced or changed to another model.") from exc

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
        if any(message["role"] == "user" and message["text"] == pending["text"]
               for message in self.messages[start:]):
            self.meta["pending_message"] = None

    async def initialize(self) -> None:
        try:
            check_config()
            await self.refresh()
            await self.recover_publication()
            if self.meta_path == META and self.meta.get("workspace_import_version", 0) < 2:
                code, out, _ = await self.command(["--list-eilo-sessions"], launcher="hermes-human")
                if code:
                    raise ChatError("Your current chat is saved, but earlier chats could not be loaded. Reload to try again.")
                try:
                    candidate = import_sessions(self.meta, json.loads(out)["sessions"])
                    candidate["workspace_import_done"] = True
                    candidate["workspace_import_version"] = 2
                    self.commit_meta(candidate)
                except (ValueError, KeyError, TypeError) as exc:
                    raise ChatError("The earlier-chat list could not be verified. Your current conversation is preserved.") from exc
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
            if ((chat_id is not None and chat_id != catalog["active_chat_id"])
                    or (chat_id is None and len(catalog["chats"]) > 1)):
                raise CatalogError("The active chat changed. Reopen the conversation before sending.", 409)
            if request_id in self.meta["accepted_requests"]:
                return self.snapshot()
            if self.busy:
                raise web.HTTPConflict(text=json.dumps({"error": "A reply is already in progress."}), content_type="application/json")
            try:
                check_config()
            except ChatError as exc:
                self.error, self.blocked = str(exc), True
                self.changed()
                raise
            if self.blocked:
                raise ChatError(self.error or "This conversation needs attention before it can continue.")
            if self.meta.get("pending_publication"):
                raise ChatError("The last change is saved, but its reply still needs to be recovered. Reload the app before sending another message.")
            self.error = None
            self.reply_stream = None
            self.proactive.on_human(text, request_id)
            catalog = self.meta["chat_catalog"]
            active = next(c for c in catalog["chats"] if c["id"] == catalog["active_chat_id"])
            if active["name"] == "New chat" and not self.meta.get("started"):
                active["name"] = re.sub(r"\s+", " ", text).strip()[:80]
                catalog["revision"] += 1
            self.meta.update(started=True, pending=True, request_id=request_id,
                             pending_turn={"request_id": request_id, "based_on_revision": self.meta["tasks"]["revision"]},
                             pending_message={"request_id": request_id, "text": text, "status": "accepted",
                                              "after_message_id": self.messages[-1]["id"] if self.messages else None})
            self.meta["accepted_requests"] = (self.meta["accepted_requests"] + [request_id])[-100:]
            write_private(self.meta_path, self.meta)
            timing = {"request_id": request_id, "received_at_unix_ms": round(began_unix_ms, 3),
                      "accept_ms": round((time.perf_counter() - began) * 1000, 3)}
            self.task = asyncio.create_task(self.serial_human_turn(text, began, timing), name="user-requested-hermes-turn")
            self.changed()
            return self.snapshot()

    async def serial_human_turn(self, text: str, began: float, timing: dict) -> None:
        await self.proactive.wait_for_preempted_event()
        async with self.native_lock:
            await self.run_turn(text, began, timing)

    def commit_meta(self, candidate: dict) -> None:
        """Publish in memory only after the entire private journal is durable."""
        write_private(self.meta_path, candidate)
        self.meta = candidate
        self.proactive.state = self.meta["accountability"]
        self.proactive.ledger.state = self.meta
        self.proactive.ledger.journal = self.meta["activity_journal"]

    def stage_publication(self, receipt: dict) -> None:
        pending = self.meta.get("pending_turn")
        if not pending or receipt.get("request_id") != pending["request_id"] or receipt.get("session_id") != self.meta["session_id"]:
            raise ChatError("The response could not be matched to your message. Your tasks were not changed.")
        candidate = deepcopy(self.meta)
        request_id = pending["request_id"]
        try:
            proposal = validate_proposal(receipt.get("proposal"), request_id=request_id,
                                         revision=pending["based_on_revision"])
            if proposal["kind"] == "update" and pending.get("source_used"):
                raise TaskError("Source-based task changes need a separate user confirmation.")
            if proposal["kind"] == "update":
                candidate["tasks"], reply = apply_operations(
                    candidate["tasks"], proposal["operations"], based_on_revision=proposal["based_on_revision"],
                    request_id=request_id, source={"kind": "human", "session_id": receipt["session_id"],
                                                   "user_id": str(receipt["user_id"]), "assistant_id": str(receipt["assistant_id"])})
                if len(reply) > 7500:
                    reply = f'Saved all {len(proposal["operations"])} requested task changes. They are shown in your task list.'
                disposition = "committed"
            else:
                reply, disposition = proposal["reply"], proposal["kind"]
                # A second guard for an inconsistent *claim*, never an intent parser.
                # Only validated operations can produce a success acknowledgment.
                if re.search(r"\b(?:i(?:'ve| have)? (?:saved|added|updated|completed|cancelled|canceled|reopened|deleted|removed|restored|set your)|(?:task|goal) (?:is |has been )?saved)\b", reply, re.I):
                    reply = "I couldn't confirm that task change. Your saved tasks are unchanged."
                    disposition = "clarify"
        except (TaskError, TypeError, KeyError):
            reply = "I couldn't finish that reply. Your message is saved, and nothing was changed."
            disposition = "rejected"
        candidate["pending_publication"] = {
            "session_id": receipt["session_id"], "session_title": candidate["title"],
            "request_id": request_id, "assistant_id": receipt["assistant_id"],
            "public_reply": reply, "disposition": disposition}
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
            if (result.get("session_id") != publication["session_id"] or result.get("request_id") != publication["request_id"]
                    or str(result.get("assistant_id")) != str(publication["assistant_id"]) or result.get("published") is not True):
                raise ChatError("The change receipt needs recovery before another message can be sent. Your saved tasks are shown; retry the saved reply.")
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
            self.error = "The source check was interrupted. Ask again to use your current source settings."
            self.save_meta()
            return
        if not self.meta.get("pending_publication") and self.meta.get("pending_turn"):
            pending = self.meta["pending_turn"]
            rows = self.native_record.get("messages", [])
            assistants = [row for row in rows if row.get("display_kind") == "eilo_human_proposal"
                          and (row.get("display_metadata") or {}).get("request_id") == pending["request_id"]]
            users = [row for row in rows if row.get("role") == "user"
                     and (row.get("display_metadata") or {}).get("lane") == "eilo_human"
                     and (row.get("display_metadata") or {}).get("request_id") == pending["request_id"]]
            if len(assistants) == 1 and len(users) == 1:
                # Recover only a native pair bound to this exact caller-owned
                # revision. Never trust correlation copied into model prose.
                if any((row.get("display_metadata") or {}).get("based_on_revision") != pending["based_on_revision"]
                       for row in (users[0], assistants[0])):
                    raise ChatError("The saved response could not be matched to this turn. Your tasks were not changed.")
                proposal = bind_model_proposal(assistants[0].get("content", ""), request_id=pending["request_id"],
                                               revision=pending["based_on_revision"])
                self.stage_publication({"session_id": self.meta["session_id"], "request_id": pending["request_id"],
                                        "assistant_id": int(assistants[0]["id"]), "user_id": int(users[0]["id"]), "proposal": proposal})
        await self.publish_staged_reply()

    async def control_tasks(self, operations: list, request_id: str, based_on_revision: int, conversation_id=None) -> dict:
        async with self.lock:
            if conversation_id is not None and conversation_id != self.meta.get("session_id"):
                raise TaskConflict("The conversation changed. Choose an item from the current workspace.")
            if request_id in self.meta["tasks"]["applied_requests"]:
                return self.snapshot()
            if self.busy or self.meta.get("pending_publication"):
                raise TaskConflict("Wait for the current reply before changing tasks.")
            # Validate before preempting anything; both controls and chat use this transaction.
            updated, _ = apply_operations(self.meta["tasks"], operations, based_on_revision=based_on_revision,
                                          request_id=request_id, source={"kind": "control"})
            self.proactive.on_human("", request_id)
            await self.proactive.wait_for_preempted_event()
            candidate = deepcopy(self.meta)
            candidate["tasks"] = updated
            candidate["accountability"]["last_fingerprint"] = None
            self.commit_meta(candidate)
            self.error = None
            self.changed()
            return self.snapshot()

    async def control_activity_records(self, action, session_id, request_id, based_on_revision, conversation_id):
        async with self.lock:
            if conversation_id != self.meta.get("session_id"):
                raise TaskConflict("The conversation changed. Choose a record from the current workspace.")
            ledger = self.proactive.ledger
            # Validate before preempting; an idempotent receipt must still match its payload.
            ledger.plan_control(action, session_id, request_id, based_on_revision)
            if ledger.has_control_receipt(request_id):
                return self.snapshot()
            if self.busy or self.meta.get("pending_publication"):
                raise TaskConflict("Wait for the current reply before changing activity records.")
            self.proactive.on_human("", request_id)
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
            source_turn = await self.briefing.open(request_id)
            write_private(path, {"session_id": self.meta["session_id"], "session_title": self.meta["title"],
                                 "request_id": request_id, "text": text, "task_state": public_state(self.meta["tasks"]),
                                 "context_bridge": source_turn.capability()})
            timing["native_process"] = {}
            def preview(value):
                if self.meta.get("request_id") == request_id and self.meta.get("pending"):
                    if source_turn.touched:
                        source_turn.check()
                        if not any(s["id"] == "answer" for s in source_turn.run["steps"]): source_turn.writing()
                    self.reply_stream = {"id": request_id, "text": value, "status": "writing"}
                    self.changed()
            code, out, err = await self.command(["--input", str(path), "--stream"], launcher="hermes-human", timeout=210,
                                                 observation=timing["native_process"], on_preview=preview)
            if code:
                await self.refresh()
                await self.recover_publication()
                if self.meta.get("pending_turn"):
                    self.error = runtime_error(err)
            else:
                receipt = json.loads(out)
                audit = receipt.get("audit", {})
                if (audit.get("model") != MODEL or audit.get("provider") != PROVIDER or audit.get("tool_schema_count") != len(TOOL_NAMES)
                        or receipt.get("request_id") != request_id or type(receipt.get("assistant_id")) is not int
                        or type(receipt.get("user_id")) is not int):
                    raise ChatError("The native response could not be verified. Your tasks were not changed.")
                self.meta["session_id"] = receipt["session_id"]
                timing["export_process"] = {}
                await self.refresh(timing["export_process"])
                if source_turn.touched: source_turn.check()
                self.stage_publication(receipt)
                rejected = self.meta["pending_publication"]["disposition"] == "rejected"
                await self.publish_staged_reply()
                source_turn.finish("failed" if self.error or rejected else "completed")
        except asyncio.TimeoutError:
            self.error = "The reply timed out. No automatic retry was sent. Reopen the app to check saved messages before trying again."
        except asyncio.CancelledError:
            if not source_turn or not (source_turn.cancelled or source_turn.invalidated):
                # Native shutdown keeps the pending receipt for honest restart recovery.
                raise
            self.error = "Stopped. Your message is saved; no work was automatically retried."
            if source_turn and source_turn.invalidated:
                self.error = "Source access changed, so this check stopped. Your saved tasks are unchanged."
            self.meta.update(pending=False,pending_turn=None,pending_publication=None)
            self.reply_stream = None
            with contextlib.suppress(Exception): await self.refresh()
            if source_turn: source_turn.finish("cancelled")
        except ChatError as exc:
            self.error = str(exc)
            self.blocked = not bool(self.meta.get("pending_publication"))
        except Exception:
            self.error = "The local connection failed. Reopen the app to check saved messages; no automatic retry was sent."
        finally:
            path.unlink(missing_ok=True)
            if source_turn:
                if source_turn.run["status"] == "running": source_turn.finish("failed")
                await source_turn.close()
            if self.reply_stream:
                self.reply_stream = {**self.reply_stream, "status": "interrupted"} if self.error or self.meta.get("pending_turn") else None
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
        return await self.control_catalog({"action":"new_chat", "based_on_revision":self.meta["chat_catalog"]["revision"]})

    async def read_catalog_conversation(self, conversation: dict) -> dict:
        """Read and audit a proposed destination before changing the active pointer."""
        if not conversation.get("started"):
            return {}
        session_id = conversation.get("session_id")
        code, out, _ = await self.command(["--resolve-title", conversation["title"]], launcher="hermes-human")
        try:
            resolved = json.loads(out) if code == 0 else {}
            if resolved.get("session_title") != conversation["title"] or not resolved.get("session_id"):
                raise ValueError("unverified native title")
            session_id = resolved["session_id"]
        except (ValueError, TypeError) as exc:
            raise ChatError("This chat could not be located in Hermes. Your current conversation is still open.") from exc
        code, out, _ = await self.command(["sessions", "export", "--format", "jsonl", "--redact", "--yes", "--session-id", session_id, "-"])
        try:
            records = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
            if code or len(records) != 1:
                raise ValueError("unreadable native session")
            audit_session(records[0], session_id)
            return records[0]
        except (ValueError, TypeError, KeyError) as exc:
            raise ChatError("This chat could not be safely reopened. Your current conversation is still open.") from exc

    async def control_catalog(self, body: dict) -> dict:
        async with self.lock:
            if self.busy or self.meta.get("pending") or self.meta.get("pending_turn") or self.meta.get("pending_publication"):
                raise CatalogError("Wait for the current reply before changing chats or projects.", 409)
            planned = apply_catalog(self.meta, body)
            switching = planned["chat_catalog"]["active_chat_id"] != self.meta["chat_catalog"]["active_chat_id"]
            if not switching:
                self.commit_meta(planned)
                self.changed()
                return self.snapshot()
            self._catalog_changing = True
            self.changed()
            try:
                self.proactive.invalidate()
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
                    messages = visible_messages(record, self.proactive.state["events"])
                    pending = candidate.get("pending_message")
                    if pending:
                        anchor = pending.get("after_message_id")
                        positions = [i for i, item in enumerate(messages) if item["id"] == anchor]
                        if anchor is not None and not positions:
                            raise ChatError("The saved message receipt needs attention. Your current conversation is still open.")
                        start = positions[-1] + 1 if positions else 0
                        if any(m["role"] == "user" and m["text"] == pending["text"] for m in messages[start:]):
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
        await self.connections.close()
        await self.proactive.close()
        self.changed()
        if self.task is not None and not self.task.done():
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        for process in tuple(self.children):
            await self.stop_child(process)


def create_app(chat: LocalChat, port: int) -> web.Application:
    @web.middleware
    async def boundaries(request: web.Request, handler):
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if request.host not in allowed_hosts:
            raise web.HTTPForbidden()
        if request.headers.get("Origin") not in (None, f"http://{request.host}"):
            raise web.HTTPForbidden()
        if request.headers.get("Sec-Fetch-Site") == "cross-site":
            raise web.HTTPForbidden()
        if request.path.startswith("/api/"):
            if request.headers.get("X-Eilo-Client") != "local-chat":
                raise web.HTTPForbidden()
            if request.method == "POST" and request.content_type != "application/json":
                raise web.HTTPUnsupportedMediaType()
        try:
            response = await handler(request)
        except ChatError as exc:
            response = web.json_response({"error": str(exc)}, status=503)
        except CatalogError as exc:
            response = web.json_response({"error": str(exc)}, status=exc.status)
        except (json.JSONDecodeError, UnicodeDecodeError):
            response = web.json_response({"error": "Send a valid message."}, status=400)
        return response

    app = web.Application(middlewares=[boundaries], client_max_size=64 * 1024)

    async def headers(request, response):
        response.headers.update({
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"})
    app.on_response_prepare.append(headers)
    transcriber = Transcriber(ROOT)

    async def workspace_catalog(request):
        if request.method == "GET":
            return web.json_response(snapshot_catalog(chat.meta))
        return web.json_response(await chat.control_catalog(await request.json()))

    async def connections(request):
        if request.method == "GET":
            return web.json_response(chat.connections.snapshot())
        try:
            return web.json_response(await chat.connections.control(await request.json()))
        except ConnectionError as exc:
            return web.json_response({"error":str(exc), "needs_setup":exc.needs_setup}, status=exc.status)
        except (OSError, TypeError, KeyError):
            return web.json_response({"error":"The connection change could not be saved. Review the current state before trying again."}, status=503)


    async def google_calendar(request):
        if request.method == 'GET':
            return web.json_response(chat.calendar.snapshot(include_authorization=True))
        try:
            body = await request.json()
            prior_sub = (chat.calendar.data.get("account") or {}).get("sub")
            result = await chat.calendar.control(body)
            if body.get("action") == "disconnect":
                await chat.briefing.mail.calendar_disconnected(prior_sub)
            chat.briefing.sources_changed()
            return web.json_response(result)
        except CalendarError as exc:
            return web.json_response({'error':str(exc),'code':exc.code},status=exc.status)
        except (OSError, TypeError, KeyError):
            return web.json_response({'error':'Calendar setup could not be saved. Try again.','code':'local_state'},status=503)

    async def briefing_sources(request):
        if request.method == "GET":
            return web.json_response(chat.briefing.mail.snapshot(True))
        try:
            result = await chat.briefing.mail.control(await request.json())
            chat.briefing.sources_changed()
            return web.json_response(result)
        except CalendarError as exc:
            return web.json_response({"error":str(exc),"code":exc.code},status=exc.status)
        except (OSError,TypeError,KeyError):
            return web.json_response({"error":"Source setup could not be saved. Try again."},status=503)

    async def cancel_workflow(request):
        body = await request.json()
        if not isinstance(body,dict) or set(body) != {"request_id"} or not isinstance(body["request_id"],str):
            raise web.HTTPBadRequest()
        try: return web.json_response(await chat.briefing.cancel(body["request_id"]))
        except CalendarError as exc: return web.json_response({"error":str(exc)},status=exc.status)

    async def speech_status(request):
        return web.json_response(transcriber.status())

    async def transcribe(request):
        # Audio alone has a larger bounded body; all other JSON routes retain 64 KiB.
        data = bytearray()
        async for chunk in request.content.iter_chunked(65536):
            data.extend(chunk)
            if len(data) > 5_300_000:
                raise web.HTTPRequestEntityTooLarge(max_size=5_300_000, actual_size=len(data))
        try:
            body = json.loads(data)
            if not isinstance(body, dict) or set(body) != {"request_id", "audio"}:
                raise ValueError()
            if not isinstance(body["request_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", body["request_id"]):
                raise ValueError()
            if not isinstance(body["audio"], str):
                raise ValueError()
            wav = base64.b64decode(body["audio"], validate=True)
        except (ValueError, TypeError, binascii.Error):
            return web.json_response({"error":"Send a valid microphone recording."}, status=400)
        work = asyncio.create_task(transcriber.transcribe(wav, body["request_id"]))
        try:
            while not work.done():
                await asyncio.wait({work}, timeout=0.2)
                if request.transport is None or request.transport.is_closing():
                    await transcriber.cancel(body["request_id"])
                    work.cancel()
                    raise asyncio.CancelledError()
            result = await work
            return web.json_response({"text":result, "request_id":body["request_id"]})
        except asyncio.CancelledError:
            work.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await work
            raise
        except Exception as exc:
            # Only the module's deliberate user-facing errors may cross this boundary.
            from app.transcription import TranscriptionError
            if isinstance(exc, TranscriptionError):
                return web.json_response({"error":str(exc)}, status=getattr(exc,"status",503))
            return web.json_response({"error":"Local transcription could not finish. You can still type your message."}, status=503)

    async def cancel_transcription(request):
        body = await request.json()
        if not isinstance(body,dict) or set(body)!={"request_id"} or not isinstance(body["request_id"],str) or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}",body["request_id"]):
            return web.json_response({"error":"Invalid recording request."},status=400)
        await transcriber.cancel(body["request_id"])
        return web.json_response({"cancelled":True})

    async def state(request):
        return web.json_response(await chat.wait_for_state(request.query.get("after")))

    async def message(request):
        body = await request.json()
        if not isinstance(body, dict) or set(body) not in ({"text", "request_id"}, {"text", "request_id", "chat_id"}):
            return web.json_response({"error": "Send a plain message with a request ID."}, status=400)
        text, request_id = body["text"], body["request_id"]
        if "chat_id" in body and (not isinstance(body["chat_id"],str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,79}",body["chat_id"])):
            return web.json_response({"error":"The chat reference is invalid."},status=400)
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_MESSAGE:
            return web.json_response({"error": "Enter a message of 1–12,000 characters."}, status=400)
        if text.lstrip().startswith(("/", "!")):
            return web.json_response({"error": "This chat accepts natural messages. Native commands are not enabled here."}, status=400)
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", request_id):
            return web.json_response({"error": "The message request ID is invalid."}, status=400)
        return web.json_response(await chat.send(text, request_id, chat_id=body.get("chat_id")), status=202)

    async def new(request):
        if await request.json() != {}:
            return web.json_response({"error": "Invalid conversation request."}, status=400)
        return web.json_response(await chat.new_conversation())

    def require_client(body, keys):
        if (not isinstance(body, dict) or set(body) != set(keys) or not isinstance(body.get("client_id"), str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", body["client_id"])):
            raise ValueError("Invalid activity request.")

    async def goal(request):
        body = await request.json()
        try:
            if not isinstance(body, dict) or set(body) not in ({"action", "text", "request_id"}, {"action", "text", "request_id", "chat_id"}):
                raise ValueError("Invalid goal control.")
            if not all(isinstance(body[key], str) for key in ("action", "text", "request_id")):
                raise ValueError("Invalid goal control.")
            if not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", body["request_id"]):
                raise ValueError("Invalid goal request ID.")
            text = canonical_goal_message(body["action"], body["text"])
            return web.json_response(await chat.send(text, body["request_id"], chat_id=body.get("chat_id")), status=202)
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def tasks(request):
        body = await request.json()
        try:
            if (not isinstance(body, dict) or set(body) not in ({"operations", "request_id", "based_on_revision"}, {"operations", "request_id", "based_on_revision", "conversation_id"})
                    or not isinstance(body["request_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", body["request_id"])):
                raise TaskError("Invalid task request.")
            if body.get("conversation_id") is not None and (not isinstance(body["conversation_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", body["conversation_id"])):
                raise TaskError("Invalid conversation reference.")
            return web.json_response(await chat.control_tasks(body["operations"], body["request_id"], body["based_on_revision"], conversation_id=body.get("conversation_id")))
        except TaskConflict as exc:
            return web.json_response({"error": str(exc)}, status=409)
        except TaskError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def activity_records(request):
        body = await request.json()
        try:
            if (not isinstance(body, dict) or set(body) != {"action", "session_id", "request_id", "based_on_revision", "conversation_id"}
                    or not isinstance(body["request_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", body["request_id"])
                    or (body["conversation_id"] is not None and (not isinstance(body["conversation_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", body["conversation_id"])) )):
                raise TaskError("Invalid activity record request.")
            return web.json_response(await chat.control_activity_records(**body))
        except TaskConflict as exc:
            return web.json_response({"error": str(exc)}, status=409)
        except TaskError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def recover(request):
        if await request.json() != {}:
            return web.json_response({"error": "Invalid recovery request."}, status=400)
        async with chat.lock:
            if chat.busy:
                return web.json_response({"error": "A reply is still in progress."}, status=409)
            async with chat.native_lock:
                await chat.refresh()
                await chat.recover_publication()
                chat.error, chat.blocked = None, False
                chat.changed()
        return web.json_response(chat.snapshot())

    async def activity(request):
        body = await request.json()
        try:
            require_client(body, ("action", "client_id"))
            chat.proactive.control(body["action"], body["client_id"])
            return web.json_response(chat.snapshot())
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def lease(request):
        body = await request.json()
        try:
            require_client(body, ("client_id",))
            chat.proactive.renew(body["client_id"])
            return web.json_response(chat.snapshot())
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=409)

    async def observation(request):
        body = await request.json()
        try:
            require_client(body, ("client_id", "nonce", "observation"))
            if not isinstance(body["nonce"], str) or not re.fullmatch(r"[a-f0-9]{32}", body["nonce"]):
                raise ValueError("Invalid sample request.")
            await chat.proactive.observe(body["client_id"], body["nonce"], body["observation"])
            return web.json_response(chat.snapshot())
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def static(request):
        return web.FileResponse(WEB / {"/workspace.js": "workspace.js", "/workspace.css": "workspace.css", "/app.js": "app.js", "/app.css": "app.css", "/activity-client.js": "activity-client.js", "/activity-config.js": "activity-config.js", "/activity-setup.html": "activity-setup.html"}[request.path])

    async def connection_page(request):
        files={"/activity-connect":"activity-connect.html", "/activity-connect.css":"activity-connect.css", "/activity-connect.js":"activity-connect.js"}
        return web.FileResponse(WEB / files[request.path])

    async def home_redirect(request):
        raise web.HTTPPermanentRedirect(location="/home/")

    async def home_index(request):
        index = (HOME / "index.html").read_text()
        index = index.replace('<html lang="en" data-typography="plex">', '<html lang="en" data-typography="plex" data-source="live">', 1)
        return web.Response(text=index, content_type="text/html")

    async def home_asset(request):
        asset = HOME_ASSETS.get(request.match_info["asset"])
        if asset is None:
            raise web.HTTPNotFound()
        if asset == "index.html":
            return await home_index(request)
        return web.FileResponse((WEB if asset in {"activity-client.js","activity-config.js"} else HOME) / asset)

    for path in ("/workspace.js", "/workspace.css", "/app.js", "/app.css", "/activity-client.js", "/activity-config.js", "/activity-setup.html"):
        app.router.add_get(path, static)
    for path in ("/activity-connect", "/activity-connect.css", "/activity-connect.js"):
        app.router.add_get(path, connection_page)
    for path in ("/", "/workspace", "/workspace/", "/home"):
        app.router.add_get(path, home_redirect)
    app.router.add_get("/home/", home_index)
    app.router.add_get("/home/{asset:.*}", home_asset)
    app.router.add_get("/api/integrations/google-calendar", google_calendar)
    app.router.add_post("/api/integrations/google-calendar", google_calendar)
    app.router.add_get("/api/integrations/briefing-sources", briefing_sources)
    app.router.add_post("/api/integrations/briefing-sources", briefing_sources)
    app.router.add_post("/api/workflow/cancel", cancel_workflow)
    app.router.add_get("/api/speech", speech_status)
    app.router.add_post("/api/transcribe", transcribe)
    app.router.add_post("/api/transcribe/cancel", cancel_transcription)
    app.router.add_get("/api/desktop", lambda request: web.json_response({
        "app": "eilo", "protocol": 1, "workspace": str(ROOT)}))
    app.router.add_get("/api/state", state)
    app.router.add_get("/api/workspace/catalog", workspace_catalog)
    app.router.add_post("/api/workspace/catalog", workspace_catalog)
    app.router.add_get("/api/connections", connections)
    app.router.add_post("/api/connections", connections)
    app.router.add_post("/api/message", message)
    app.router.add_post("/api/new", new)
    app.router.add_post("/api/goal", goal)
    app.router.add_post("/api/tasks", tasks)
    app.router.add_post("/api/activity/records", activity_records)
    app.router.add_post("/api/recover", recover)
    app.router.add_post("/api/activity", activity)
    app.router.add_post("/api/activity/lease", lease)
    app.router.add_post("/api/activity/observation", observation)
    app.router.add_get("/health", lambda request: web.json_response({"ok": True}))
    app.on_startup.append(lambda app: chat.initialize())
    app.on_startup.append(lambda app: chat.calendar.start())
    app.on_shutdown.append(lambda app: chat.calendar.close())
    app.on_shutdown.append(lambda app: chat.close())
    app.on_shutdown.append(lambda app: chat.briefing.close())
    app.on_shutdown.append(lambda app: transcriber.close())
    return app


def stop_server() -> None:
    if not PID_FILE.exists():
        print("The local eïlo app is not running.")
        return
    record = json.loads(PID_FILE.read_text())
    try:
        process = psutil.Process(record["pid"])
        command = process.cmdline()
        if process.create_time() != record["created"] or str(Path(__file__).resolve()) not in command:
            raise RuntimeError("The process record is stale; no process was stopped.")
        process.terminate()
        process.wait(timeout=15)
        print("Stopped the local eïlo app.")
    except psutil.NoSuchProcess:
        PID_FILE.unlink(missing_ok=True)
        print("The local eïlo app has already stopped.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("start", "stop"), nargs="?", default="start")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    os.umask(0o077)
    if args.action == "stop":
        stop_server()
        return
    lock = (STATE / "local-chat.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("The local eïlo app is already running.")
    write_private(PID_FILE, {"pid": os.getpid(), "created": psutil.Process().create_time(), "port": args.port})
    try:
        print(f"eïlo is available at http://127.0.0.1:{args.port} (Ctrl+C to stop).", flush=True)
        web.run_app(create_app(LocalChat(), args.port), host="127.0.0.1", port=args.port, access_log=None, print=None, shutdown_timeout=15)
    finally:
        PID_FILE.unlink(missing_ok=True)
        lock.close()


if __name__ == "__main__":
    main()
