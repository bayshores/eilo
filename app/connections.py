"""Connection inventory and explicit MCP setup, separate from agent tool access."""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

import yaml

from app.context_service import FLAGS, ContextError
from app.google_calendar import CalendarError
from app.paths import STATE, runtime_directory, state_directory
from app.persistence import write_private, write_private_text


class ConnectionError(ValueError):
    def __init__(self, message, status=400, needs_setup=False):
        super().__init__(message)
        self.status = status
        self.needs_setup = needs_setup


def validate_mcp(body):
    name = body.get("name")
    if (
        not isinstance(name, str)
        or not 1 <= len(name.strip()) <= 80
        or re.search(r"[\x00-\x1f\x7f]", name)
    ):
        raise ConnectionError("Enter a server name of 1–80 characters.")
    kind = body.get("transport")
    entry = {"name": name.strip(), "transport": kind}
    if kind == "http":
        if set(body) - {"action", "based_on_revision", "name", "transport", "url"}:
            raise ConnectionError("Unsupported connection fields.")
        url = body.get("url")
        if not isinstance(url, str) or len(url) > 2048 or re.search(r"\s", url):
            raise ConnectionError("Enter an HTTPS MCP address.")
        try:
            p = urlsplit(url)
            if (
                p.scheme != "https"
                or not p.hostname
                or p.username
                or p.password
                or p.query
                or p.fragment
            ):
                raise ValueError()
            if p.port is not None and not 1 <= p.port <= 65535:
                raise ValueError()
        except ValueError:
            raise ConnectionError(
                "Use an HTTPS address without embedded credentials or query secrets."
            ) from None
        entry["url"] = url
    elif kind == "stdio":
        if set(body) - {"action", "based_on_revision", "name", "transport", "command", "args"}:
            raise ConnectionError("Unsupported connection fields.")
        command, args = body.get("command"), body.get("args", [])
        if (
            not isinstance(command, str)
            or not command.strip()
            or len(command) > 1024
            or re.search(r"[\x00-\x1f\x7f]", command)
            or not isinstance(args, list)
            or len(args) > 40
            or any(
                not isinstance(a, str) or len(a) > 2048 or re.search(r"[\x00-\x1f\x7f]", a)
                for a in args
            )
        ):
            raise ConnectionError("Enter an executable and a list of arguments.")
        if any("${" in a for a in [command, *args]):
            raise ConnectionError(
                "Secret environment substitutions are not supported in this form."
            )
        from hermes_cli.mcp_security import validate_mcp_server_entry

        if validate_mcp_server_entry("eilo-mcp", {"command": command, "args": args}):
            raise ConnectionError("That command is not an acceptable MCP configuration.")
        entry.update(command=command.strip(), args=args)
    else:
        raise ConnectionError("Choose HTTPS or a local MCP process.")
    return entry


class Connections:
    def __init__(self, chat, root):
        self.chat, self.root = chat, Path(root)
        self.path = state_directory(self.root) / "mcp-connections.json"
        self.data = {"servers": [], "paused_gmail_ids": []}
        if self.path.exists():
            value = json.loads(self.path.read_text())
            if (
                not isinstance(value, dict)
                or set(value) not in ({"servers"}, {"servers", "paused_gmail_ids"})
                or not isinstance(value["servers"], list)
                or len(value["servers"]) > 50
            ):
                raise ConnectionError("Saved MCP configuration needs attention.")
            if not isinstance(value.get("paused_gmail_ids", []), list) or any(
                not isinstance(item, str) for item in value.get("paused_gmail_ids", [])
            ):
                raise ConnectionError("Saved connection preferences need attention.")
            for item in value["servers"]:
                if (
                    not isinstance(item, dict)
                    or not re.fullmatch(r"mcp-[a-f0-9]{24}", item.get("id", ""))
                    or type(item.get("enabled")) is not bool
                ):
                    raise ConnectionError("Saved MCP configuration needs attention.")
                draft = {
                    k: item[k] for k in ("name", "transport", "url", "command", "args") if k in item
                }
                validate_mcp(draft)
            if len({item["id"] for item in value["servers"]}) != len(value["servers"]):
                raise ConnectionError("Saved MCP configuration needs attention.")
            self.data = value
        self._sync_runtime_config()
        self.lock = asyncio.Lock()
        self.revision = int(time.time() * 1000)
        self.fingerprint = ""
        self.jobs = {}

    def snapshot(self):
        c = self.chat.calendar.snapshot()
        mail = self.chat.briefing.mail.snapshot()
        a = self.chat.proactive.snapshot()["activity"]
        context = getattr(self.chat, "context", None)
        browser = context.capture_health("browser") if context else None
        browser_enabled = bool(browser and browser["enabled"])
        browser_verified = bool(
            browser and browser.get("setup_verified") and browser.get("connected")
        )
        accounts = mail["accounts"]
        enabled = [x for x in accounts if x["enabled"]]
        cal_enabled = c["state"] == "connected"
        apps = [
            {
                "id": "gmail",
                "name": "Gmail",
                "description": f"{len(accounts)} connected inbox{'es' if len(accounts) != 1 else ''}"
                if accounts
                else "Bring relevant email into your answers",
                "enabled": bool(enabled),
                "state": "Needs attention"
                if any(x["state"] == "reauth_required" for x in enabled)
                else "On"
                if enabled
                else "Off",
                "detail": "Each inbox has its own sharing choice.",
            },
            {
                "id": "google-calendar",
                "name": "Google Calendar",
                "description": f"{len(c['selected_ids'])} selected calendars"
                if c.get("account")
                else "Your upcoming events, in one place",
                "enabled": cal_enabled,
                "state": "Needs attention"
                if c["state"] in ("error", "reauth_required")
                else "On"
                if cal_enabled
                else "Off",
                "detail": "Calendar sync and using events in answers are separate choices.",
            },
            {
                "id": "browser-activity",
                "name": "Browser activity",
                "description": "Website names and work sessions from Chrome",
                "enabled": browser_enabled if context else a["state"] == "active",
                "setup_verified": browser_verified,
                "state": (
                    "Connected"
                    if browser_enabled and browser_verified
                    else "Setup needed"
                    if browser_enabled
                    else "Ready"
                    if browser_verified
                    else "Off"
                )
                if context
                else (
                    "On"
                    if a["state"] == "active"
                    else "Paused"
                    if a["state"] == "paused"
                    else "Off"
                ),
                "detail": "Browser access, visible text, and AI context have separate controls.",
            },
        ]
        mcps = []
        for server in self.data["servers"]:
            item = deepcopy(server)
            item.update(
                description="Configured tool server; choose which chats may use it",
                state="Testing"
                if server["id"] in self.jobs
                else "Needs attention"
                if server.get("error")
                else "Enabled"
                if server["enabled"]
                else "Off",
            )
            mcps.append(item)
        signature = json.dumps([apps, mcps, c["revision"], mail["revision"]], sort_keys=True)
        if signature != self.fingerprint:
            self.revision += 1
            self.fingerprint = signature
        return {"revision": self.revision, "apps": apps, "mcps": mcps}

    def _sync_runtime_config(self):
        if self.path.parent != STATE:
            return
        config_path = STATE / "hermes/config.yaml"
        if not config_path.exists():
            return
        config = yaml.safe_load(config_path.read_text()) or {}
        servers = {}
        for item in self.data["servers"]:
            if not item["enabled"]:
                continue
            servers[item["id"]] = (
                {"url": item["url"]}
                if item["transport"] == "http"
                else {"command": item["command"], "args": item.get("args", [])}
            )
        config["mcp_servers"] = servers
        write_private_text(config_path, yaml.safe_dump(config, sort_keys=False))

    def commit(self, servers):
        candidate = {**self.data, "servers": servers}
        write_private(self.path, candidate)
        previous, self.data = self.data, candidate
        try:
            self._sync_runtime_config()
        except Exception:
            self.data = previous
            write_private(self.path, previous)
            raise
        self.chat.changed()

    async def control(self, body):
        shapes = {
            "add_mcp": None,
            "set_enabled": {"action", "based_on_revision", "id", "enabled"},
            "remove_mcp": {"action", "based_on_revision", "id"},
            "test_mcp": {"action", "based_on_revision", "id"},
        }
        if (
            not isinstance(body, dict)
            or body.get("action") not in shapes
            or type(body.get("based_on_revision")) is not int
        ):
            raise ConnectionError("Choose a supported connection action.")
        action = body["action"]
        if shapes[action] is not None and set(body) != shapes[action]:
            raise ConnectionError("Unsupported connection fields.")
        async with self.lock:
            if body["based_on_revision"] != self.snapshot()["revision"]:
                raise ConnectionError(
                    "Connections changed. Review the current state and try again.", 409
                )
            if action == "add_mcp":
                item = validate_mcp(body)
                if len(self.data["servers"]) >= 50:
                    raise ConnectionError("The server limit is 50.")
                if any(
                    s["name"].casefold() == item["name"].casefold() for s in self.data["servers"]
                ):
                    raise ConnectionError("An MCP with that name already exists.")
                item.update(
                    id="mcp-" + uuid.uuid4().hex[:24],
                    enabled=False,
                    tool_count=None,
                    last_checked_at=None,
                    error=None,
                )
                self.commit([*self.data["servers"], item])
                return self.snapshot()
            identity = body["id"]
            if not isinstance(identity, str):
                raise ConnectionError("Invalid connection.")
            if action == "set_enabled":
                if type(body["enabled"]) is not bool:
                    raise ConnectionError("Choose On or Off.")
                if not identity.startswith("mcp-"):
                    try:
                        await self.builtin(identity, body["enabled"])
                    except CalendarError as exc:
                        raise ConnectionError(str(exc), exc.status, exc.status == 409) from exc
                    return self.snapshot()
            item = next((s for s in self.data["servers"] if s["id"] == identity), None)
            if item is None:
                raise ConnectionError("That MCP is no longer configured.", 404)
            if identity in self.jobs:
                if action == "test_mcp":
                    raise ConnectionError("A connection check is already running.", 409)
                self.jobs[identity].cancel()
                await asyncio.gather(self.jobs[identity], return_exceptions=True)
            servers = deepcopy(self.data["servers"])
            current = next(s for s in servers if s["id"] == identity)
            if action == "remove_mcp":
                self.commit([s for s in servers if s["id"] != identity])
                return self.snapshot()
            if action == "set_enabled":
                current["enabled"] = body["enabled"]
                self.commit(servers)
                return self.snapshot()
            if not item["enabled"]:
                raise ConnectionError("Enable this MCP configuration before testing it.", 409)
            task = asyncio.create_task(self.probe(deepcopy(item)))
            self.jobs[identity] = task
            self.chat.changed()
        # Probe result is returned through subsequent GET; the UI remains responsive.
        return self.snapshot()

    async def builtin(self, identity, enabled):
        if identity == "gmail":
            mail = self.chat.briefing.mail
            if enabled and not mail.data["accounts"]:
                raise ConnectionError(
                    "Connect an inbox and choose what it may share first.", 409, True
                )
            accounts = list(mail.data["accounts"])
            active_ids = [a["id"] for a in accounts if a["enabled"]]
            if enabled:
                resume = set(active_ids or self.data.get("paused_gmail_ids", []))
                targets = [a for a in accounts if a["id"] in resume]
                if not targets:
                    raise ConnectionError(
                        "Choose which inboxes to use in Gmail options first.", 409, True
                    )
            else:
                # Restore the previously selected inboxes, never enable every saved account.
                if active_ids:
                    candidate = {**self.data, "paused_gmail_ids": active_ids}
                    write_private(self.path, candidate)
                    self.data = candidate
                targets = [a for a in accounts if a["enabled"]]
            for account in targets:
                if account["enabled"] != enabled:
                    await mail.control(
                        {
                            "action": "set_mail_enabled",
                            "account_id": account["id"],
                            "enabled": enabled,
                            "based_on_revision": mail.data["revision"],
                        }
                    )
            self.chat.briefing.sources_changed()
        elif identity == "google-calendar":
            calendar = self.chat.calendar
            if enabled and (
                not calendar.data.get("account")
                or not calendar.data["selected_ids"]
                or calendar.data["state"] in ("reauth_required", "error", "authorizing")
            ):
                raise ConnectionError(
                    "Connect Google Calendar and select calendars first.", 409, True
                )
            if calendar.data.get("account"):
                await calendar.control(
                    {
                        "action": "resume" if enabled else "pause",
                        "based_on_revision": calendar.data["revision"],
                    }
                )
            self.chat.briefing.sources_changed()
        elif identity == "browser-activity":
            context = getattr(self.chat, "context", None)
            health = context.capture_health("browser") if context else {}
            if enabled and not (health.get("connected") and health.get("setup_verified")):
                raise ConnectionError("Finish Chrome setup first.", 409, True)
            if context:
                state = context.state
                changes = {
                    key: deepcopy(state[key])
                    for key in (*FLAGS, "excluded_domains", "excluded_bundle_ids")
                }
                changes["browser_enabled"] = enabled
                if enabled:
                    changes["enabled"] = True
                try:
                    await context.command(
                        {
                            "action": "configure",
                            "request_id": uuid.uuid4().hex,
                            "based_on_revision": state["revision"],
                            **changes,
                        }
                    )
                    await self.chat.context_capture.refresh_policy()
                except ContextError as exc:
                    raise ConnectionError(str(exc), exc.status) from exc
            if not enabled:
                self.chat.proactive.control("off", "eilo-connection-manager")
        else:
            raise ConnectionError("Unknown connection.", 404)
        self.chat.changed()

    async def probe(self, server):
        identity = server["id"]
        path = self.path.parent / ("mcp-probe-" + uuid.uuid4().hex + ".json")
        try:
            write_private(path, server)
            code, out, _ = await self.chat.command(
                [str(self.root / "app/mcp_probe.py"), str(path)],
                executable=(runtime_directory(self.root) / "run-python")
                if (runtime_directory(self.root) / "run-python").exists()
                else runtime_directory(self.root) / "venv/bin/python",
                timeout=35,
            )
            result = json.loads(out) if code == 0 else {}
            count = result.get("tool_count")
            okay = result.get("ok") is True and type(count) is int and 0 <= count <= 10000
            error = (
                None
                if okay
                else "Connection check failed. Verify the address or command; servers needing authentication are not supported by this setup yet."
            )
            servers = deepcopy(self.data["servers"])
            current = next((s for s in servers if s["id"] == identity), None)
            if current:
                current.update(
                    tool_count=count if okay else None,
                    error=error,
                    last_checked_at=datetime.now(UTC).isoformat(),
                )
                self.commit(servers)
        except asyncio.CancelledError:
            raise
        except Exception:
            servers = deepcopy(self.data["servers"])
            current = next((s for s in servers if s["id"] == identity), None)
            if current:
                current.update(error="The connection test did not finish.", tool_count=None)
                self.commit(servers)
        finally:
            path.unlink(missing_ok=True)
            self.jobs.pop(identity, None)
            self.chat.changed()

    async def close(self):
        jobs = list(self.jobs.values())
        for job in jobs:
            job.cancel()
        if jobs:
            await asyncio.gather(*jobs, return_exceptions=True)
