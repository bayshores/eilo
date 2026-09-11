"""User-started account authorization with ephemeral, narrowly projected progress."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import signal
from copy import deepcopy

from app.paths import ROOT

DEVICE_URL = "https://auth.openai.com/codex/device"


class AccountError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class AccountService:
    def __init__(
        self, *, changed=lambda: None, connected=lambda: None, launcher=None, auto_status=True
    ):
        self.changed, self.connected = changed, connected
        self.launcher = launcher or ROOT / "scripts/account-driver"
        self.state = {"revision": 0, "state": "unknown"}
        self.job = None
        self.seen = {}
        self.closed = False
        self.auto_status = auto_status

    def snapshot(self):
        return deepcopy(self.state)

    def publish(self, event):
        state = event.get("state") if isinstance(event, dict) else None
        if state not in {
            "connected",
            "needs_sign_in",
            "unavailable",
            "awaiting_sign_in",
            "starting",
        }:
            raise AccountError("The sign-in response could not be verified.")
        result = {"state": state}
        if state == "awaiting_sign_in":
            code = event.get("user_code")
            if (
                event.get("verification_url") != DEVICE_URL
                or not isinstance(code, str)
                or not re.fullmatch(r"[A-Za-z0-9-]{4,32}", code)
            ):
                raise AccountError("The sign-in code could not be verified.")
            result.update(verification_url=DEVICE_URL, user_code=code)
        self.state = {"revision": self.state["revision"] + 1, **result}
        self.changed()

    async def start(self):
        # Status can refresh this app's existing grant; it never starts a login.
        if self.auto_status and not self.closed and self.job is None:
            self.job = asyncio.create_task(self._run("status"))

    async def command(self, body):
        if not isinstance(body, dict) or set(body) != {"action", "request_id", "based_on_revision"}:
            raise AccountError("Invalid account command.")
        action, request_id = body["action"], body["request_id"]
        if (
            action not in {"start", "cancel", "status"}
            or not isinstance(request_id, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", request_id)
        ):
            raise AccountError("Invalid account command.")
        if request_id in self.seen:
            if self.seen[request_id] != action:
                raise AccountError("This request was already used.", 409)
            return self.snapshot()
        if (
            type(body["based_on_revision"]) is not int
            or body["based_on_revision"] != self.state["revision"]
        ):
            raise AccountError("The account state changed. Try again.", 409)
        self.seen[request_id] = action
        self.seen = dict(list(self.seen.items())[-64:])
        if self.job and not self.job.done():
            if action != "cancel":
                return self.snapshot()
            self.job.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.job
        self.job = None
        if action == "cancel":
            self.publish({"state": "needs_sign_in"})
        else:
            self.publish({"state": "starting"})
            self.job = asyncio.create_task(self._run("login" if action == "start" else "status"))
        return self.snapshot()

    async def _run(self, action):
        process = None
        try:
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
            process = await asyncio.create_subprocess_exec(
                str(self.launcher),
                f"--{action}",
                cwd=ROOT,
                env=env,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                start_new_session=True,
                limit=8192,
            )
            count = 0
            async with asyncio.timeout(930 if action == "login" else 35):
                while line := await process.stdout.readline():
                    count += 1
                    if len(line) > 4096 or count > 3:
                        raise AccountError("The sign-in response was too large.")
                    self.publish(json.loads(line))
                await process.wait()
                if (
                    process.returncode
                    or count == 0
                    or self.state["state"] not in {"connected", "needs_sign_in"}
                ):
                    raise AccountError("Sign-in did not complete.")
                if self.state["state"] == "connected":
                    self.connected()
        except (AccountError, OSError, ValueError, TimeoutError):
            if not self.closed:
                self.publish({"state": "unavailable"})
        finally:
            if process and process.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGTERM)
                try:
                    await asyncio.wait_for(process.wait(), 2)
                except TimeoutError:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGKILL)
                    await process.wait()

    async def close(self):
        self.closed = True
        if self.job and not self.job.done():
            self.job.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.job
        self.job = None
        self.state = {"revision": self.state["revision"] + 1, "state": "unknown"}
