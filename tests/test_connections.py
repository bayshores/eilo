"""No-network connection lifecycle tests using real imports and scoped fixtures."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from app.connections import ConnectionError, Connections

CORE = Path(__file__).resolve().parents[1]


class Calendar:
    def __init__(self):
        self.data = {"account": None, "selected_ids": [], "state": "off", "revision": 0}
        self.calls = []

    def snapshot(self):
        return {**self.data, "selected_ids": list(self.data["selected_ids"])}

    async def control(self, body):
        self.calls.append(body)
        self.data["state"] = "connected" if body["action"] == "resume" else "off"
        self.data["revision"] += 1


class Mail:
    def __init__(self):
        self.data = {"accounts": [], "revision": 0}
        self.calls = []

    def snapshot(self):
        return {
            "accounts": [dict(a) for a in self.data["accounts"]],
            "revision": self.data["revision"],
        }

    async def control(self, body):
        self.calls.append(body)
        next(a for a in self.data["accounts"] if a["id"] == body["account_id"])["enabled"] = body[
            "enabled"
        ]
        self.data["revision"] += 1


class Briefing:
    def __init__(self):
        self.mail = Mail()
        self.source_change_count = 0

    def sources_changed(self):
        self.source_change_count += 1


class Proactive:
    def __init__(self):
        self.state = "off"
        self.calls = []

    def snapshot(self):
        return {"activity": {"state": self.state}}

    def control(self, action, source):
        self.calls.append((action, source))
        self.state = "off" if action == "off" else self.state


class Chat:
    def __init__(self):
        self.calendar = Calendar()
        self.briefing = Briefing()
        self.proactive = Proactive()
        self.changed_count = 0
        self.command_started = asyncio.Event()
        self.command_release = asyncio.Event()

    def changed(self):
        self.changed_count += 1

    async def command(self, *_args, **_kwargs):
        self.command_started.set()
        await self.command_release.wait()
        return 0, '{"ok": true, "tool_count": 2}', ""


class ConnectionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        security = types.ModuleType("hermes_cli.mcp_security")
        security.validate_mcp_server_entry = lambda _name, _entry: False
        package = types.ModuleType("hermes_cli")
        package.__path__ = []
        self.hermes_modules = patch.dict(
            sys.modules,
            {"hermes_cli": package, "hermes_cli.mcp_security": security},
        )
        self.hermes_modules.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.chat = Chat()
        self.connections = Connections(self.chat, self.root)

    async def asyncTearDown(self):
        await self.connections.close()
        self.temp.cleanup()
        self.hermes_modules.stop()

    def revision(self):
        return self.connections.snapshot()["revision"]

    async def add(self, name="Local test"):
        return await self.connections.control(
            {
                "action": "add_mcp",
                "based_on_revision": self.revision(),
                "name": name,
                "transport": "stdio",
                "command": "/usr/bin/true",
                "args": [],
            }
        )

    async def test_add_is_disabled_and_persists_without_execution(self):
        result = await self.add()
        item = result["mcps"][0]
        self.assertFalse(item["enabled"])
        self.assertEqual(item["state"], "Off")
        self.assertFalse(self.chat.command_started.is_set())
        self.assertFalse(
            json.loads((self.root / ".state/mcp-connections.json").read_text())["servers"][0][
                "enabled"
            ]
        )
        self.assertEqual(
            Connections(self.chat, self.root).snapshot()["mcps"][0]["name"], "Local test"
        )

    async def test_revision_and_config_are_strict(self):
        revision = self.revision()
        with self.assertRaises(ConnectionError):
            await self.connections.control(
                {
                    "action": "add_mcp",
                    "based_on_revision": revision,
                    "name": "x",
                    "transport": "http",
                    "url": "http://example.test",
                }
            )
        await self.add()
        identity = self.connections.snapshot()["mcps"][0]["id"]
        with self.assertRaises(ConnectionError) as stale:
            await self.connections.control(
                {
                    "action": "set_enabled",
                    "based_on_revision": revision,
                    "id": identity,
                    "enabled": True,
                }
            )
        self.assertEqual(stale.exception.status, 409)
        with self.assertRaises(ConnectionError):
            await self.connections.control(
                {
                    "action": "set_enabled",
                    "based_on_revision": self.revision(),
                    "id": identity,
                    "enabled": True,
                    "extra": 1,
                }
            )

    async def test_probe_requires_enable_and_has_real_testing_transition(self):
        await self.add()
        identity = self.connections.snapshot()["mcps"][0]["id"]
        with self.assertRaises(ConnectionError) as error:
            await self.connections.control(
                {"action": "test_mcp", "based_on_revision": self.revision(), "id": identity}
            )
        self.assertEqual(error.exception.status, 409)
        await self.connections.control(
            {
                "action": "set_enabled",
                "based_on_revision": self.revision(),
                "id": identity,
                "enabled": True,
            }
        )
        await self.connections.control(
            {"action": "test_mcp", "based_on_revision": self.revision(), "id": identity}
        )
        await asyncio.wait_for(self.chat.command_started.wait(), 0.2)
        self.assertEqual(self.connections.snapshot()["mcps"][0]["state"], "Testing")
        self.chat.command_release.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        item = self.connections.snapshot()["mcps"][0]
        self.assertEqual(item["state"], "Enabled")
        self.assertEqual(item["tool_count"], 2)
        self.assertIsNone(item["error"])

    async def test_disable_or_remove_during_probe_cannot_publish_late_result(self):
        for action in ("set_enabled", "remove_mcp"):
            with self.subTest(action=action):
                await self.connections.close()
                self.temp.cleanup()
                self.temp = tempfile.TemporaryDirectory()
                self.root = Path(self.temp.name)
                self.chat = Chat()
                self.connections = Connections(self.chat, self.root)
                await self.add()
                identity = self.connections.snapshot()["mcps"][0]["id"]
                await self.connections.control(
                    {
                        "action": "set_enabled",
                        "based_on_revision": self.revision(),
                        "id": identity,
                        "enabled": True,
                    }
                )
                await self.connections.control(
                    {"action": "test_mcp", "based_on_revision": self.revision(), "id": identity}
                )
                await asyncio.wait_for(self.chat.command_started.wait(), 0.2)
                body = {"action": action, "based_on_revision": self.revision(), "id": identity}
                if action == "set_enabled":
                    body["enabled"] = False
                await self.connections.control(body)
                self.chat.command_release.set()
                await asyncio.sleep(0)
                listed = self.connections.snapshot()["mcps"]
                if action == "remove_mcp":
                    self.assertEqual(listed, [])
                else:
                    self.assertFalse(listed[0]["enabled"])
                    self.assertIsNone(listed[0]["tool_count"])
                    self.assertIsNone(listed[0]["error"])

    async def test_builtin_setup_and_actual_off_controls(self):
        for identity in ("gmail", "google-calendar", "browser-activity"):
            with self.assertRaises(ConnectionError) as error:
                await self.connections.control(
                    {
                        "action": "set_enabled",
                        "based_on_revision": self.revision(),
                        "id": identity,
                        "enabled": True,
                    }
                )
            self.assertEqual((error.exception.status, error.exception.needs_setup), (409, True))
        self.chat.briefing.mail.data["accounts"] = [
            {"id": "mail-a", "enabled": True, "state": "connected"}
        ]
        await self.connections.control(
            {
                "action": "set_enabled",
                "based_on_revision": self.revision(),
                "id": "gmail",
                "enabled": False,
            }
        )
        self.assertFalse(self.chat.briefing.mail.calls[-1]["enabled"])
        self.chat.calendar.data.update(
            account={"email": "a@example.test"}, selected_ids=["primary"], state="connected"
        )
        await self.connections.control(
            {
                "action": "set_enabled",
                "based_on_revision": self.revision(),
                "id": "google-calendar",
                "enabled": False,
            }
        )
        self.assertEqual(self.chat.calendar.calls[-1]["action"], "pause")
        await self.connections.control(
            {
                "action": "set_enabled",
                "based_on_revision": self.revision(),
                "id": "browser-activity",
                "enabled": False,
            }
        )
        self.assertEqual(self.chat.proactive.calls[-1][0], "off")

    async def test_browser_inventory_and_off_action_use_native_context(self):
        from cryptography.fernet import Fernet

        from app.context_service import ContextService

        key = Fernet.generate_key()
        context = ContextService(
            self.root / ".state/context",
            get_tasks=lambda: [],
            changed=self.chat.changed,
            key_provider=lambda **_: key,
        )
        self.chat.context = context
        from unittest.mock import AsyncMock

        self.chat.context_capture = types.SimpleNamespace(refresh_policy=AsyncMock())
        try:
            context.state["enabled"] = True
            context.state["browser_enabled"] = True
            context.state["desktop_enabled"] = False
            context.state["text_enabled"] = False
            context.state["ai_enabled"] = False
            context.set_capture_health(
                "browser", "connected", {"connected": True, "setup_verified": False}
            )
            item = next(
                item
                for item in self.connections.snapshot()["apps"]
                if item["id"] == "browser-activity"
            )
            self.assertEqual(item["state"], "Setup needed")
            self.assertTrue(item["enabled"])
            context.set_capture_health(
                "browser",
                "ready",
                {"connected": True, "setup_verified": True, "grant_verified": True},
            )
            item = next(
                item
                for item in self.connections.snapshot()["apps"]
                if item["id"] == "browser-activity"
            )
            self.assertEqual(item["state"], "Connected")
            await self.connections.builtin("browser-activity", False)
            self.assertFalse(context.state["browser_enabled"])
            self.assertFalse(context.state["text_enabled"])
            self.assertFalse(context.state["ai_enabled"])
            self.chat.context_capture.refresh_policy.assert_awaited_once()
        finally:
            await context.aclose()

    async def test_gmail_master_resume_keeps_other_inboxes_disabled(self):
        self.chat.briefing.mail.data["accounts"] = [
            {"id": "mail-one", "enabled": True, "state": "connected"},
            {"id": "mail-two", "enabled": False, "state": "connected"},
        ]
        await self.connections.builtin("gmail", False)
        self.assertFalse(any(a["enabled"] for a in self.chat.briefing.mail.data["accounts"]))
        await self.connections.builtin("gmail", True)
        self.assertEqual(
            [a["enabled"] for a in self.chat.briefing.mail.data["accounts"]], [True, False]
        )


class ProbeBoundaryTests(unittest.TestCase):
    def test_probe_entrypoint_returns_only_tool_count(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "server.json"
            config.write_text(
                json.dumps(
                    {
                        "name": "Fixture",
                        "transport": "stdio",
                        "command": "/usr/bin/true",
                        "args": [],
                    }
                )
            )
            fake = types.ModuleType("hermes_cli.mcp_config")
            package = types.ModuleType("hermes_cli")
            package.__path__ = []
            security = types.ModuleType("hermes_cli.mcp_security")
            security.validate_mcp_server_entry = lambda _name, _entry: False
            calls = []

            def probe(name, transport, connect_timeout):
                calls.append((name, transport, connect_timeout))
                return [{"name": "ping"}]

            fake._probe_single_server = probe
            with patch.dict(
                sys.modules,
                {
                    "hermes_cli": package,
                    "hermes_cli.mcp_config": fake,
                    "hermes_cli.mcp_security": security,
                },
            ):
                spec = importlib.util.spec_from_file_location(
                    "staged_mcp_probe", CORE / "app/mcp_probe.py"
                )
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                with (
                    patch.object(sys, "argv", ["mcp_probe.py", str(config)]),
                    patch("sys.stdout") as output,
                ):
                    self.assertEqual(module.main(), 0)
                    payload = "".join(str(c.args[0]) for c in output.write.call_args_list)
            self.assertEqual(json.loads(payload), {"ok": True, "tool_count": 1})
            self.assertEqual(calls, [("eilo_probe", {"command": "/usr/bin/true", "args": []}, 12)])


if __name__ == "__main__":
    unittest.main()
