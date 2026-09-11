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
