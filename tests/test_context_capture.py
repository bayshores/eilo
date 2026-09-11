from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.context_capture import ContextCapture


class Writer:
    def __init__(self):
        self.messages = []

    def write(self, value):
        self.messages.append(json.loads(value))

    async def drain(self):
        pass


class Reader:
    def __init__(self, values=()):
        self.values = asyncio.Queue()
        [self.values.put_nowait(value) for value in values]

    async def readline(self):
        return await self.values.get()


class Process:
    def __init__(self, values=()):
        self.stdin, self.stdout, self.returncode = Writer(), Reader(values), None
        self.terminated = False

    def terminate(self):
        self.terminated = True
        self.returncode = 0

    async def wait(self):
        self.returncode = 0
        return 0


class Broker:
    instances = []

    def __init__(self, directory, on_event, get_policy, origins, on_status):
        self.on_event, self.get_policy, self.origins, self.on_status = (
            on_event,
            get_policy,
            origins,
            on_status,
        )
        self.started = self.closed = False
        self.refreshes = 0
        self.instances.append(self)

    async def start(self):
        self.started = True

    async def close(self):
        self.closed = True

    async def refresh_policy(self):
        self.refreshes += 1


class Service:
    def __init__(self):
        self.desktop = self.browser = True
        self.health = []
        self.events = []
        self.boundary_changes = 0

    def collector_policy(self, source):
        enabled = self.desktop if source == "desktop" else self.browser
        return {
            "session_id": "session-1",
            "policy_epoch": 3,
            "enabled": enabled,
            "text_enabled": True,
            "visuals_enabled": False,
            "excluded_bundle_ids": [],
            "excluded_domains": [],
        }

    async def ingest(self, event):
        self.events.append(event)
        return {"accepted": True}

    def set_capture_health(self, source, status, details):
        self.health.append((source, status, details))

    def capture_health(self, source):
        return {
            "status": next(
                (status for item, status, _ in reversed(self.health) if item == source), "disabled"
            ),
            "enabled": self.collector_policy(source)["enabled"],
        }

    def source_boundary_changed(self):
        self.boundary_changes += 1


class ContextCaptureTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.service = Service()
        self.processes = []

        async def factory(*args, **kwargs):
            response = (
                (
                    b'{"schema_version":1,"kind":"check","accessibility_capable":true,"accessibility_permission":false,"visuals_capable":true,"screen_recording_permission":false,"browser_text_controlled_by_extension":true}\n',
                )
                if "--check" in args
                else ()
            )
            process = Process(response)
            self.processes.append((args, process))
            return process

        self.capture = ContextCapture(
            self.directory,
            self.service,
            "/fake/helper",
            process_factory=factory,
            broker_factory=Broker,
        )
        Broker.instances.clear()

    async def asyncTearDown(self):
        await self.capture.close()
        self.temp.cleanup()

    async def test_start_is_policy_bound_and_sends_exact_start(self):
        await self.capture.start()
        self.assertEqual(len(self.processes), 1)
        self.assertEqual(
            self.processes[0][1].stdin.messages[0],
            {
                "schema_version": 1,
                "session_id": "session-1",
                "policy_epoch": 3,
                "action": "start",
                "policy": {
                    "text_enabled": True,
                    "visuals_enabled": False,
                    "excluded_bundle_ids": [],
                    "excluded_domains": [],
                },
            },
        )
        self.assertEqual(self.capture.broker.origins, set())

    async def test_enabled_browser_without_registered_origins_requires_registration(self):
        await self.capture.start()
        self.assertIn(
            ("browser", "registration_required", {"registration": "missing"}), self.service.health
        )

    async def test_enabled_browser_with_registered_origins_waits_for_native_connection(self):
        path = self.directory / "allowed-origins.json"
        path.write_text(
            '{"allowed_origins":["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]}'
        )
        path.chmod(0o600)

        await self.capture.start()

        self.assertEqual(
            self.capture.broker.origins,
            {"chrome-extension://abcdefghijklmnopabcdefghijklmnop/"},
        )
        self.assertIn(("browser", "waiting", {"registration": "ready"}), self.service.health)

    async def test_browser_reenable_reports_registration_or_connection_wait(self):
        await self.capture.start()
        self.service.browser = False
        await self.capture.refresh_policy()
        self.service.browser = True
        await self.capture.refresh_policy()
        self.assertEqual(
            [status for source, status, _ in self.service.health if source == "browser"][-1],
            "registration_required",
        )

        await self.capture.close()
        path = self.directory / "allowed-origins.json"
        path.write_text(
            '{"allowed_origins":["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]}'
        )
        path.chmod(0o600)
        self.capture = ContextCapture(
            self.directory,
            self.service,
            "/fake/helper",
            process_factory=self.capture.process_factory,
            broker_factory=Broker,
        )
        await self.capture.start()
        self.service.browser = False
        await self.capture.refresh_policy()
        self.service.browser = True
        await self.capture.refresh_policy()
        self.assertEqual(
            [status for source, status, _ in self.service.health if source == "browser"][-1],
            "waiting",
        )

    async def test_browser_refresh_preserves_observed_connection_statuses(self):
        path = self.directory / "allowed-origins.json"
        path.write_text(
            '{"allowed_origins":["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]}'
        )
        path.chmod(0o600)
        await self.capture.start()

        for status in ("connected", "ready", "sampling", "disconnected"):
            self.capture._health("browser", status, {})
            await self.capture.refresh_policy()
            self.assertEqual(
                [value for source, value, _ in self.service.health if source == "browser"][-1],
                status,
            )

        self.assertEqual(len(Broker.instances), 1)

    async def test_disconnected_refresh_preserves_the_source_boundary(self):
        await self.capture.start()
        await self.capture._on_broker_status({"status": "connected"})
        await self.capture._on_broker_status({"status": "disconnected"})
        await self.capture.refresh_policy()

        self.assertEqual(self.service.boundary_changes, 1)
        self.assertEqual(
            [status for source, status, _ in self.service.health if source == "browser"][-1],
            "disconnected",
        )

    async def test_revocation_pauses_terminates_and_refreshes(self):
        await self.capture.start()
        process = self.processes[0][1]
        self.service.desktop = False
        await self.capture.refresh_policy()
        self.assertTrue(process.terminated)
        self.assertEqual(process.stdin.messages[-1]["action"], "pause")
        self.assertEqual(self.capture.broker.refreshes, 1)
        self.assertIn(("desktop", "disabled", {}), self.service.health)

    async def test_stale_or_disabled_events_are_rejected_before_ingest(self):
        await self.capture.start()
        stale = {
            "schema_version": 1,
            "id": "event-1",
            "source_id": "desktop",
            "session_id": "old",
            "policy_epoch": 2,
            "captured_at": 1,
            "kind": "observation",
            "bundle_id": "com.example.Editor",
            "app_name": "Editor",
            "title": "Work",
            "text": "",
        }
        await self.capture._on_desktop_event(stale)
        self.service.desktop = False
        await self.capture._on_desktop_event(
            {**stale, "session_id": "session-1", "policy_epoch": 3}
        )
        self.service.browser = False
        await self.capture._on_browser_event(
            {**stale, "source_id": "browser", "session_id": "session-1", "policy_epoch": 3}
        )
        self.service.browser = True
        await self.capture._on_browser_event({**stale, "source_id": "browser"})
        self.assertEqual(self.service.events, [])

    async def test_helper_status_waiting_and_accepted_event_health_are_truthful(self):
        await self.capture.start()
        self.capture._helper_status({"status": "permission_required"})
        await self.capture._on_broker_status({"status": "connected"})
        await self.capture._on_broker_status({"status": "waiting"})
        event = {
            "schema_version": 1,
            "id": "event-1",
            "source_id": "browser",
            "session_id": "session-1",
            "policy_epoch": 3,
            "captured_at": 1,
            "kind": "observation",
            "bundle_id": "com.google.Chrome",
            "app_name": "Google Chrome",
            "title": "",
            "text": "",
            "origin": "https://example.test",
        }
        await self.capture._on_browser_event(event)
        self.assertIn(("desktop", "permission_required", {}), self.service.health)
        self.assertIn(
            ("browser", "connected", {"connected": True, "registration": "missing"}),
            self.service.health,
        )
        self.assertNotIn(("browser", "waiting", {}), self.service.health)
        self.assertIn(("browser", "sampling", {}), self.service.health)
        self.assertEqual(self.service.events, [event])

    async def test_ingestion_failure_reports_error_and_later_acceptance_recovers(self):
        event = {
            "schema_version": 1,
            "id": "event-failed-write",
            "source_id": "browser",
            "session_id": "session-1",
            "policy_epoch": 3,
            "captured_at": 1,
            "kind": "observation",
            "bundle_id": "com.google.Chrome",
            "app_name": "Google Chrome",
            "title": "",
            "text": "",
            "origin": "https://example.test",
        }
        with patch.object(self.service, "ingest", side_effect=OSError("Synthetic write failure")):
            await self.capture._on_browser_event(event)
        self.assertEqual(self.service.health[-1], ("browser", "error", {"stage": "ingest"}))
        self.assertEqual(self.service.events, [])
        await self.capture._on_browser_event(event)
        self.assertEqual(self.service.health[-1], ("browser", "sampling", {}))
        self.assertEqual(self.service.events, [event])

    async def test_explicit_check_uses_helper_preflight_only(self):
        self.assertEqual((await self.capture.check())["kind"], "check")
        self.assertEqual(self.processes[0][0], ("/fake/helper", "--check"))
        self.assertIn(
            (
                "desktop",
                "checked",
                {
                    "accessibility_capable": True,
                    "accessibility_permission": False,
                    "visuals_capable": True,
                    "screen_recording_permission": False,
                    "browser_text_controlled_by_extension": True,
                },
            ),
            self.service.health,
        )

    async def test_preflight_is_cached_single_flight_and_never_starts_capture(self):
        first, second = await asyncio.gather(
            self.capture.refresh_health(), self.capture.refresh_health()
        )
        self.assertEqual(first["kind"], "check")
        self.assertEqual(second["kind"], "check")
        self.assertEqual(len(self.processes), 1)
        self.assertIsNone(self.capture.process)
        self.assertIsNone(self.capture.broker)
        await self.capture.refresh_health()
        self.assertEqual(len(self.processes), 1)
        self.assertNotIn(("desktop", "checked", {}), self.service.health)

    async def test_browser_preflight_only_reloads_registration_without_helper(self):
        value = await self.capture.refresh_health("browser")
        self.assertEqual(value, {"status": "registration_required", "enabled": True})
        self.assertEqual(self.processes, [])
        self.assertIsNone(self.capture.process)
        self.assertIsNone(self.capture.broker)

    async def test_preflight_preserves_runtime_health_when_permission_is_denied(self):
        self.capture._health("desktop", "sampling", {})
        await self.capture.refresh_health()
        self.assertEqual(self.service.health[-1][0:2], ("desktop", "sampling"))
        self.assertFalse(self.service.health[-1][2]["accessibility_permission"])

    async def test_close_cancels_pending_preflight_without_late_health_update(self):
        processes = []

        async def blocking_factory(*args, **kwargs):
            process = Process()
            processes.append(process)
            return process

        capture = ContextCapture(
            self.directory,
            self.service,
            "/fake/helper",
            process_factory=blocking_factory,
            broker_factory=Broker,
        )
        task = asyncio.create_task(capture.refresh_health())
        for _ in range(10):
            if processes:
                break
            await asyncio.sleep(0.01)
        await capture.close()
        with self.assertRaises(asyncio.CancelledError):
            await task
        await asyncio.sleep(0)
        self.assertTrue(processes[0].terminated)
        self.assertNotIn(("desktop", "checked", {}), self.service.health)

    async def test_registration_refresh_marks_invalid_and_never_expands_unchecked_origins(self):
        path = self.directory / "allowed-origins.json"
        path.write_text(
            '{"allowed_origins":["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]}'
        )
        path.chmod(0o600)
        await self.capture.start()
        path.write_text('{"not_allowed_origins":[]}')
        await self.capture.refresh_health()
        self.assertEqual(self.capture._browser_registration, "invalid")
        self.assertEqual(self.capture._registered_origins, frozenset())


if __name__ == "__main__":
    unittest.main()
