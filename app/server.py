"""Loopback conversation UI; Hermes owns all model work and durable messages."""
from __future__ import annotations

import argparse
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
from app.tasks import (TaskError, TaskConflict, apply_operations, migrate_legacy,
                       initial_tasks, public_state, validate_proposal)
STATE = ROOT / ".state"
META = STATE / "local-chat.json"
PID_FILE = STATE / "local-chat-process.json"
WEB = ROOT / "app/web"
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
                    messages.append({"id": str(message["id"]), "role": "assistant", "text": decision["message"], "origin": "check_in"})
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
    if record.get("tool_call_count") != 0:
        raise ValueError("tool activity or missing audit")
    for message in record["messages"]:
        if message.get("role") == "tool" or any(message.get(key) for key in
                                                ("tool_calls", "tool_call_id", "tool_name")):
            raise ValueError("recorded tool activity")


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
        self.children: set[asyncio.subprocess.Process] = set()
        self.messages: list[dict] = []
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
        self.proactive = ProactiveLoop(self, helper=ROOT / ".runtime/eilo-activity-helper/eilo-activity-helper.app/Contents/MacOS/EiloActivityHelper")
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
        return self.task is not None and not self.task.done()

    @property
    def revision(self) -> str:
        return f"{self.instance_id}:{self.revision_number}"

    def changed(self) -> None:
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
                "recovery_pending": bool(self.meta.get("pending_publication")),
                "messages": self.messages, "error": self.error,
                "conversation_id": self.meta.get("session_id"), "model": MODEL,
                "request_id": self.meta.get("request_id"), "revision": self.revision,
                "accepted_request_ids": self.meta["accepted_requests"],
                "pending_message": {key: pending[key] for key in ("request_id", "text", "status")} if pending else None,
                "accountability": self.proactive.snapshot()}

    async def command(self, arguments: list[str], *, timeout: int = 30,
                      observation: dict | None = None, launcher: str = "hermes",
                      executable: Path | None = None, human_context: str | None = None) -> tuple[int, str, str]:
        started = time.perf_counter()
        # Credentials come from Hermes's private home, never inherited provider variables.
        env = {key: os.environ[key] for key in ("HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "TZ") if key in os.environ}
        if human_context is not None:
            env["HERMES_EPHEMERAL_SYSTEM_PROMPT"] = human_context
        process = await asyncio.create_subprocess_exec(
            str(executable or ROOT / "scripts" / launcher), *arguments,
            cwd=ROOT, env=env, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=True)
        if observation is not None:
            observation["spawn_ms"] = round((time.perf_counter() - started) * 1000, 3)

        async def collect(stream, name):
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
        except (asyncio.TimeoutError, asyncio.CancelledError):
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
            if self.meta.get("pending") or self.meta.get("pending_turn"):
                self.error = "The previous reply was interrupted when the app stopped. Saved messages are shown; no message was automatically resent."
                self.meta["pending"] = False
                if self.meta.get("pending_message"):
                    self.meta["pending_message"]["status"] = "interrupted"
                write_private(self.meta_path, self.meta)
        except ChatError as exc:
            self.error, self.blocked = str(exc), True
        self.changed()

    async def send(self, text: str, request_id: str) -> dict:
        began = time.perf_counter()
        began_unix_ms = time.time() * 1000
        async with self.lock:
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
            self.proactive.on_human(text, request_id)
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

    def stage_publication(self, receipt: dict) -> None:
        pending = self.meta.get("pending_turn")
        if not pending or receipt.get("request_id") != pending["request_id"] or receipt.get("session_id") != self.meta["session_id"]:
            raise ChatError("The response could not be matched to your message. Your tasks were not changed.")
        candidate = deepcopy(self.meta)
        request_id = pending["request_id"]
        try:
            proposal = validate_proposal(receipt.get("proposal"), request_id=request_id,
                                         revision=pending["based_on_revision"])
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
                if re.search(r"\b(?:i(?:'ve| have)? (?:saved|added|updated|completed|cancelled|canceled|reopened|set your)|(?:task|goal) (?:is |has been )?saved)\b", reply, re.I):
                    reply = "Your task list has not changed. Please clarify the task change you want me to save."
                    disposition = "clarify"
        except (TaskError, TypeError, KeyError):
            reply = "I couldn't safely apply that response, so your tasks haven't changed. Your message is saved; please clarify the change or use the task controls."
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
        if not self.meta.get("pending_publication") and self.meta.get("pending_turn"):
            pending = self.meta["pending_turn"]
            rows = self.native_record.get("messages", [])
            assistants = [row for row in rows if row.get("display_kind") == "eilo_human_proposal"
                          and (row.get("display_metadata") or {}).get("request_id") == pending["request_id"]]
            users = [row for row in rows if row.get("role") == "user"
                     and (row.get("display_metadata") or {}).get("lane") == "eilo_human"
                     and (row.get("display_metadata") or {}).get("request_id") == pending["request_id"]]
            if len(assistants) == 1 and len(users) == 1:
                try:
                    proposal = json.loads(assistants[0].get("content", ""))
                except (ValueError, TypeError):
                    proposal = None
                self.stage_publication({"session_id": self.meta["session_id"], "request_id": pending["request_id"],
                                        "assistant_id": int(assistants[0]["id"]), "user_id": int(users[0]["id"]), "proposal": proposal})
        await self.publish_staged_reply()

    async def control_tasks(self, operations: list, request_id: str, based_on_revision: int) -> dict:
        async with self.lock:
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

    async def run_turn(self, text: str, began: float, timing: dict) -> None:
        path = self.meta_path.parent / ("human-" + uuid.uuid4().hex + ".json")
        try:
            request_id = self.meta["pending_turn"]["request_id"]
            write_private(path, {"session_id": self.meta["session_id"], "session_title": self.meta["title"],
                                 "request_id": request_id, "text": text, "task_state": public_state(self.meta["tasks"])})
            timing["native_process"] = {}
            code, out, err = await self.command(["--input", str(path)], launcher="hermes-human", timeout=120,
                                                 observation=timing["native_process"])
            if code:
                await self.refresh()
                await self.recover_publication()
                if self.meta.get("pending_turn"):
                    self.error = runtime_error(err)
            else:
                receipt = json.loads(out)
                audit = receipt.get("audit", {})
                if (audit.get("model") != MODEL or audit.get("provider") != PROVIDER or audit.get("tool_schema_count") != 0
                        or receipt.get("request_id") != request_id or type(receipt.get("assistant_id")) is not int
                        or type(receipt.get("user_id")) is not int):
                    raise ChatError("The native response could not be verified. Your tasks were not changed.")
                self.meta["session_id"] = receipt["session_id"]
                timing["export_process"] = {}
                await self.refresh(timing["export_process"])
                self.stage_publication(receipt)
                await self.publish_staged_reply()
        except asyncio.TimeoutError:
            self.error = "The reply timed out. No automatic retry was sent. Reopen the app to check saved messages before trying again."
        except asyncio.CancelledError:
            # Leave the marker so restart reports interruption without replaying a prompt.
            raise
        except ChatError as exc:
            self.error = str(exc)
            self.blocked = not bool(self.meta.get("pending_publication"))
        except Exception:
            self.error = "The local connection failed. Reopen the app to check saved messages; no automatic retry was sent."
        finally:
            path.unlink(missing_ok=True)
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
        async with self.lock:
            if self.busy or self.meta.get("pending_publication"):
                raise web.HTTPConflict(text=json.dumps({"error": "Wait for the current reply before starting another conversation."}), content_type="application/json")
            check_config()
            await self.proactive.close()
            self.meta = self.fresh_meta()
            self.proactive = ProactiveLoop(self, helper=self.proactive.helper)
            self.messages, self.error, self.blocked = [], None, False
            self.native_record = {}
            self.last_audit = {}
            write_private(self.meta_path, self.meta)
            self.changed()
            return self.snapshot()

    async def close(self) -> None:
        await self.proactive.close()
        self.changed()
        if self.busy:
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
        except (json.JSONDecodeError, UnicodeDecodeError):
            response = web.json_response({"error": "Send a valid message."}, status=400)
        return response

    app = web.Application(middlewares=[boundaries], client_max_size=64 * 1024)

    async def headers(request, response):
        response.headers.update({
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"})
    app.on_response_prepare.append(headers)

    async def state(request):
        return web.json_response(await chat.wait_for_state(request.query.get("after")))

    async def message(request):
        body = await request.json()
        if not isinstance(body, dict) or set(body) != {"text", "request_id"}:
            return web.json_response({"error": "Send a plain message with a request ID."}, status=400)
        text, request_id = body["text"], body["request_id"]
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_MESSAGE:
            return web.json_response({"error": "Enter a message of 1–12,000 characters."}, status=400)
        if text.lstrip().startswith(("/", "!")):
            return web.json_response({"error": "This chat accepts natural messages. Native commands are not enabled here."}, status=400)
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", request_id):
            return web.json_response({"error": "The message request ID is invalid."}, status=400)
        return web.json_response(await chat.send(text, request_id), status=202)

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
            if not isinstance(body, dict) or set(body) != {"action", "text", "request_id"}:
                raise ValueError("Invalid goal control.")
            if not all(isinstance(body[key], str) for key in ("action", "text", "request_id")):
                raise ValueError("Invalid goal control.")
            if not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", body["request_id"]):
                raise ValueError("Invalid goal request ID.")
            text = canonical_goal_message(body["action"], body["text"])
            return web.json_response(await chat.send(text, body["request_id"]), status=202)
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def tasks(request):
        body = await request.json()
        try:
            if (not isinstance(body, dict) or set(body) != {"operations", "request_id", "based_on_revision"}
                    or not isinstance(body["request_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", body["request_id"])):
                raise TaskError("Invalid task request.")
            return web.json_response(await chat.control_tasks(body["operations"], body["request_id"], body["based_on_revision"]))
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
        return web.FileResponse(WEB / {"/": "workspace.html", "/workspace": "workspace.html", "/workspace.js": "workspace.js", "/workspace.css": "workspace.css", "/app.js": "app.js", "/app.css": "app.css", "/activity-client.js": "activity-client.js", "/activity-config.js": "activity-config.js", "/activity-setup.html": "activity-setup.html"}[request.path])

    for path in ("/", "/workspace", "/workspace.js", "/workspace.css", "/app.js", "/app.css", "/activity-client.js", "/activity-config.js", "/activity-setup.html"):
        app.router.add_get(path, static)
    app.router.add_get("/api/state", state)
    app.router.add_post("/api/message", message)
    app.router.add_post("/api/new", new)
    app.router.add_post("/api/goal", goal)
    app.router.add_post("/api/tasks", tasks)
    app.router.add_post("/api/recover", recover)
    app.router.add_post("/api/activity", activity)
    app.router.add_post("/api/activity/lease", lease)
    app.router.add_post("/api/activity/observation", observation)
    app.router.add_get("/health", lambda request: web.json_response({"ok": True}))
    app.on_startup.append(lambda app: chat.initialize())
    app.on_shutdown.append(lambda app: chat.close())
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
