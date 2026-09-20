from __future__ import annotations

import asyncio
import json
import os
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.native_bridge import (
    MAX_MESSAGE_BYTES,
    ContextBroker,
    NativeBridgeError,
    _chrome_frame,
    _decode_chrome_payload,
    _decode_line,
    _json_line,
)

ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"


def policy(*, enabled=True, epoch=1):
    return {
        "kind": "policy",
        "schema_version": 1,
        "session_id": "session-1",
        "policy_epoch": epoch,
        "enabled": enabled,
        "text_enabled": False,
        "excluded_domains": [],
    }


async def attach(directory: Path, *, token=None, origin=ORIGIN):
    metadata = json.loads((directory / "broker.json").read_text())
    reader, writer = await asyncio.open_unix_connection(metadata["socket_path"])
    writer.write(
        _json_line({"kind": "attach", "token": token or metadata["token"], "origin": origin})
    )
    await writer.drain()
    return reader, writer


class ContextBrokerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name) / "context"
        self.current = policy()
        self.events = []
        self.statuses = []
        self.broker = ContextBroker(
            self.directory, self.events.append, lambda: self.current, {ORIGIN}, self.statuses.append
        )
        await self.broker.start()

    async def asyncTearDown(self):
        await self.broker.close()
        self.temp.cleanup()

    async def test_private_token_attach_policy_event_and_cleanup(self):
        self.assertEqual(stat.S_IMODE((self.directory / "broker.json").stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.directory / "context.sock").stat().st_mode), 0o600)
        reader, writer = await attach(self.directory)
        self.assertEqual(_decode_line(await reader.readline()), policy())
        writer.write(
            _json_line(
                {"kind": "hello", "protocol": 1, "extension_id": "abcdefghijklmnopabcdefghijklmnop"}
            )
        )
        await writer.drain()
        event = {
            "schema_version": 1,
            "id": "browser-1",
            "source_id": "browser",
            "session_id": "session-1",
            "policy_epoch": 1,
            "captured_at": time.time(),
            "kind": "browser",
            "bundle_id": "com.google.Chrome",
            "app_name": "Google Chrome",
            "origin": "https://example.test",
            "title": "Example",
            "text": "",
        }
        writer.write(_json_line(event))
        await writer.drain()
        for _ in range(10):
            if self.events:
                break
            await asyncio.sleep(0.01)
        self.assertEqual(self.events, [event])
        writer.close()
        await writer.wait_closed()
        for _ in range(10):
            if any(item["status"] == "disconnected" for item in self.statuses):
                break
            await asyncio.sleep(0.01)
        self.assertEqual(self.statuses[0]["status"], "connected")
        self.assertIn("disconnected", [item["status"] for item in self.statuses])
        await self.broker.close()
        self.assertFalse((self.directory / "broker.json").exists())
        self.assertFalse((self.directory / "context.sock").exists())

    async def test_bad_token_unknown_origin_and_malformed_messages_close(self):
        for token, origin in (
            ("wrong", ORIGIN),
            (None, "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/"),
        ):
            reader, writer = await attach(self.directory, token=token, origin=origin)
            self.assertEqual(await reader.readline(), b"")
            writer.close()
            await writer.wait_closed()
        reader, writer = await attach(self.directory)
        await reader.readline()
        writer.write(b"not-json\n")
        await writer.drain()
        self.assertEqual(await reader.readline(), b"")
        writer.close()
        await writer.wait_closed()

    async def test_revoke_refresh_stops_sample_requests(self):
        reader, writer = await attach(self.directory)
        await reader.readline()
        self.current = policy(enabled=False, epoch=2)
        await self.broker.refresh_policy()
        self.assertEqual(_decode_line(await reader.readline()), self.current)
        with self.assertRaises(TimeoutError):
            await asyncio.wait_for(reader.readline(), timeout=0.05)
        writer.close()
        await writer.wait_closed()

    async def test_stalled_policy_client_does_not_block_a_settings_write(self):
        class Writer:
            closed = False

            def close(self):
                self.closed = True

        class Client:
            setup_verified = grant_verified = False
            verified_policy = None

            def __init__(self):
                self.writer = Writer()

            async def send(self, _value):
                await asyncio.Future()

        client = Client()
        self.broker._clients.add(client)
        self.current = policy(epoch=2)

        with patch("app.native_bridge.CLIENT_SEND_TIMEOUT_SECONDS", 0.01):
            await asyncio.wait_for(self.broker.refresh_policy(), timeout=0.2)

        self.assertNotIn(client, self.broker._clients)
        self.assertTrue(client.writer.closed)

    async def test_stale_epoch_is_ignored(self):
        reader, writer = await attach(self.directory)
        await reader.readline()
        event = {
            "schema_version": 1,
            "id": "old-1",
            "source_id": "browser",
            "session_id": "session-1",
            "policy_epoch": 0,
            "captured_at": time.time(),
            "kind": "browser",
            "bundle_id": "com.google.Chrome",
            "app_name": "Google Chrome",
            "origin": "https://example.test",
            "title": "",
            "text": "",
        }
        writer.write(_json_line(event))
        await writer.drain()
        await asyncio.sleep(0.02)
        self.assertEqual(self.events, [])
        writer.close()
        await writer.wait_closed()

    async def test_ready_ack_requires_current_policy_and_verifies_only_that_client(self):
        reader, writer = await attach(self.directory)
        await reader.readline()
        writer.write(
            _json_line(
                {"kind": "status", "state": "ready", "session_id": "session-1", "policy_epoch": 0}
            )
        )
        await writer.drain()
        await asyncio.sleep(0.02)
        self.assertNotIn("ready", [item["status"] for item in self.statuses])
        writer.write(
            _json_line(
                {"kind": "status", "state": "ready", "session_id": "session-1", "policy_epoch": 1}
            )
        )
        await writer.drain()
        for _ in range(10):
            if any(item["status"] == "ready" for item in self.statuses):
                break
            await asyncio.sleep(0.01)
        ready = [item for item in self.statuses if item["status"] == "ready"][-1]
        self.assertTrue(ready["connected"])
        self.assertTrue(ready["setup_verified"])
        self.assertTrue(ready["grant_verified"])
        self.current = policy(epoch=2)
        await self.broker.refresh_policy()
        self.assertEqual(_decode_line(await reader.readline()), self.current)
        updated = [item for item in self.statuses if item["status"] == "policy_updated"][-1]
        self.assertFalse(updated["setup_verified"])
        writer.close()
        await writer.wait_closed()

    async def test_disabled_policy_accepts_setup_ack_without_sampling(self):
        self.current = policy(enabled=False)
        reader, writer = await attach(self.directory)
        self.assertEqual(_decode_line(await reader.readline()), self.current)
        writer.write(
            _json_line(
                {"kind": "status", "state": "ready", "session_id": "session-1", "policy_epoch": 1}
            )
        )
        await writer.drain()
        for _ in range(10):
            if any(item["status"] == "ready" for item in self.statuses):
                break
            await asyncio.sleep(0.01)
        ready = [item for item in self.statuses if item["status"] == "ready"][-1]
        self.assertTrue(ready["setup_verified"])
        self.assertTrue(ready["grant_verified"])
        with self.assertRaises(TimeoutError):
            await asyncio.wait_for(reader.readline(), timeout=0.05)
        writer.close()
        await writer.wait_closed()

    async def test_one_client_closing_preserves_surviving_ready_client(self):
        first_reader, first_writer = await attach(self.directory)
        await first_reader.readline()
        second_reader, second_writer = await attach(self.directory)
        await second_reader.readline()
        second_writer.write(
            _json_line(
                {"kind": "status", "state": "ready", "session_id": "session-1", "policy_epoch": 1}
            )
        )
        await second_writer.drain()
        for _ in range(10):
            if any(item["status"] == "ready" for item in self.statuses):
                break
            await asyncio.sleep(0.01)
        first_writer.close()
        await first_writer.wait_closed()
        for _ in range(10):
            detached = [item for item in self.statuses if item["status"] == "disconnected"]
            if detached:
                break
            await asyncio.sleep(0.01)
        detached = [item for item in self.statuses if item["status"] == "disconnected"][-1]
        self.assertTrue(detached["connected"])
        self.assertTrue(detached["setup_verified"])
        second_writer.close()
        await second_writer.wait_closed()

    async def test_new_policy_before_second_attach_does_not_keep_first_client_verified(self):
        first_reader, first_writer = await attach(self.directory)
        await first_reader.readline()
        first_writer.write(
            _json_line(
                {"kind": "status", "state": "ready", "session_id": "session-1", "policy_epoch": 1}
            )
        )
        await first_writer.drain()
        for _ in range(10):
            if any(item["status"] == "ready" for item in self.statuses):
                break
            await asyncio.sleep(0.01)
        self.current = policy(epoch=2)
        second_reader, second_writer = await attach(self.directory)
        self.assertEqual(_decode_line(await second_reader.readline()), self.current)
        connected = [item for item in self.statuses if item["status"] == "connected"][-1]
        self.assertFalse(connected["setup_verified"])
        await self.broker.refresh_policy()
        updated = [item for item in self.statuses if item["status"] == "policy_updated"]
        self.assertEqual(updated, [])
        self.assertFalse(next(iter(self.broker._clients)).setup_verified)
        second_writer.write(
            _json_line(
                {"kind": "status", "state": "ready", "session_id": "session-1", "policy_epoch": 2}
            )
        )
        await second_writer.drain()
        for _ in range(10):
            if [item for item in self.statuses if item["status"] == "ready"][-1]["setup_verified"]:
                break
            await asyncio.sleep(0.01)
        self.assertTrue(
            [item for item in self.statuses if item["status"] == "ready"][-1]["setup_verified"]
        )
        first_writer.close()
        second_writer.close()
        await first_writer.wait_closed()
        await second_writer.wait_closed()

    async def test_native_host_exits_when_broker_disconnects_and_rejects_bad_origin(self):
        root = Path(__file__).parent.parent
        env = {**os.environ, "EILO_DATA_HOME": str(self.temp.name)}
        host = await asyncio.create_subprocess_exec(
            sys.executable,
            str(root / "scripts/native-context-host"),
            ORIGIN,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        header = await asyncio.wait_for(host.stdout.readexactly(4), 2)
        payload = await host.stdout.readexactly(int.from_bytes(header, "little"))
        self.assertEqual(json.loads(payload)["kind"], "policy")
        await self.broker.close()
        await asyncio.wait_for(host.wait(), 2)
        self.assertEqual(host.returncode, 0)
        bad = await asyncio.create_subprocess_exec(
            sys.executable,
            str(root / "scripts/native-context-host"),
            "chrome-extension://bad/",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        await asyncio.wait_for(bad.wait(), 2)
        self.assertNotEqual(bad.returncode, 0)

    async def test_policy_and_message_bounds_fail_closed(self):
        with self.assertRaises(NativeBridgeError):
            _json_line({"text": "x" * MAX_MESSAGE_BYTES})
        with self.assertRaises(NativeBridgeError):
            _decode_line(b"x" * (MAX_MESSAGE_BYTES + 1))
        self.current = {"kind": "policy"}
        reader, writer = await attach(self.directory)
        self.assertEqual(await reader.readline(), b"")
        writer.close()
        await writer.wait_closed()

    def test_jsonl_and_chrome_frames_are_bounded(self):
        self.assertEqual(
            _decode_line(_json_line({"kind": "sample", "session_id": "s", "policy_epoch": 1})),
            {"kind": "sample", "session_id": "s", "policy_epoch": 1},
        )
        frame = _chrome_frame({"kind": "policy"})
        self.assertEqual(int.from_bytes(frame[:4], "little"), len(frame) - 4)
        self.assertEqual(_decode_chrome_payload(frame[4:]), {"kind": "policy"})


if __name__ == "__main__":
    unittest.main()
