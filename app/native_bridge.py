"""Private Unix-socket bridge between felis and its Chrome native host."""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import os
import re
import secrets
import stat
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MAX_MESSAGE_BYTES = 128 * 1024
CLIENT_SEND_TIMEOUT_SECONDS = 2
POLICY_FIELDS = {
    "kind",
    "schema_version",
    "session_id",
    "policy_epoch",
    "enabled",
    "text_enabled",
    "excluded_domains",
}


class NativeBridgeError(ValueError):
    """The local native bridge received an untrusted or malformed message."""


def _secure_mode(path: Path, expected: int) -> bool:
    try:
        return stat.S_IMODE(path.stat().st_mode) == expected
    except OSError:
        return False


def _json_line(value: dict[str, Any]) -> bytes:
    payload = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(payload) > MAX_MESSAGE_BYTES:
        raise NativeBridgeError("Message exceeds the native bridge limit.")
    return payload + b"\n"


def _decode_line(raw: bytes) -> dict[str, Any]:
    if not raw or len(raw) > MAX_MESSAGE_BYTES or not raw.endswith(b"\n"):
        raise NativeBridgeError("Invalid native bridge frame.")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise NativeBridgeError("Invalid native bridge JSON.") from exc
    if not isinstance(value, dict):
        raise NativeBridgeError("Native bridge messages must be objects.")
    return value


def _decode_chrome_payload(raw: bytes) -> dict[str, Any]:
    if not raw or len(raw) > MAX_MESSAGE_BYTES:
        raise NativeBridgeError("Invalid Chrome frame.")
    return _decode_line(raw + b"\n")


def _chrome_frame(value: dict[str, Any]) -> bytes:
    payload = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if not payload or len(payload) > MAX_MESSAGE_BYTES:
        raise NativeBridgeError("Native output exceeds limit.")
    return len(payload).to_bytes(4, "little") + payload


def _valid_identifier(value: Any) -> bool:
    return (
        isinstance(value, str)
        and 1 <= len(value) <= 160
        and value.replace("_", "a").replace("-", "a").replace(".", "a").replace(":", "a").isalnum()
    )


def _valid_policy(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != POLICY_FIELDS:
        raise NativeBridgeError("Invalid native policy.")
    if value.get("kind") != "policy" or value.get("schema_version") != 1:
        raise NativeBridgeError("Invalid native policy.")
    if (
        not _valid_identifier(value.get("session_id"))
        or type(value.get("policy_epoch")) is not int
        or value["policy_epoch"] < 0
    ):
        raise NativeBridgeError("Invalid native policy.")
    if type(value.get("enabled")) is not bool or type(value.get("text_enabled")) is not bool:
        raise NativeBridgeError("Invalid native policy.")
    domains = value.get("excluded_domains")
    if (
        not isinstance(domains, list)
        or len(domains) > 128
        or any(not isinstance(item, str) or len(item) > 253 for item in domains)
    ):
        raise NativeBridgeError("Invalid native policy.")
    return value


def _fresh_timestamp(value: Any) -> bool:
    now = time.time()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        stamp = float(value)
    elif isinstance(value, str):
        try:
            stamp = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC).timestamp()
        except ValueError:
            return False
    else:
        return False
    return now - 120 <= stamp <= now + 30


def _valid_event(value: dict[str, Any], policy: dict[str, Any]) -> bool:
    required = {
        "schema_version",
        "id",
        "source_id",
        "session_id",
        "policy_epoch",
        "captured_at",
        "kind",
        "bundle_id",
        "app_name",
        "origin",
        "title",
        "text",
    }
    if (
        not policy["enabled"]
        or not required <= set(value)
        or set(value) - required - {"resource_url"}
    ):
        return False
    if (
        value["schema_version"] != 1
        or value["source_id"] != "browser"
        or value["kind"] != "browser"
    ):
        return False
    if (
        value["session_id"] != policy["session_id"]
        or value["policy_epoch"] != policy["policy_epoch"]
    ):
        return False
    if not all(_valid_identifier(value[key]) for key in ("id", "bundle_id")):
        return False
    if not all(
        isinstance(value[key], str) and len(value[key]) <= limit
        for key, limit in (("app_name", 180), ("origin", 280), ("title", 180), ("text", 8000))
    ):
        return False
    return _fresh_timestamp(value["captured_at"])


class _Client:
    def __init__(self, writer: asyncio.StreamWriter, origin: str):
        self.writer = writer
        self.origin = origin
        self.lock = asyncio.Lock()
        self.setup_verified = False
        self.grant_verified = False
        self.verified_policy: tuple[str, int] | None = None

    async def send(self, value: dict[str, Any]) -> None:
        async with self.lock:
            self.writer.write(_json_line(value))
            await self.writer.drain()


class ContextBroker:
    """Owns an ephemeral, same-user Unix socket for one or more browser hosts."""

    def __init__(
        self,
        directory: Path | str,
        on_event: Callable[[dict[str, Any]], Any],
        get_policy: Callable[[], Any],
        allowed_origins: set[str] | frozenset[str] | list[str],
        on_status: Callable[[dict[str, Any]], Any] | None = None,
    ):
        self.directory = Path(directory)
        self.on_event = on_event
        self.get_policy = get_policy
        self.allowed_origins = frozenset(allowed_origins)
        self.on_status = on_status
        self.socket_path = self.directory / "context.sock"
        self.broker_path = self.directory / "broker.json"
        self._token = ""
        self._server: asyncio.AbstractServer | None = None
        self._clients: set[_Client] = set()
        self._last_policy: tuple[str, int] | None = None

    async def start(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)
        if self.socket_path.exists() or self.broker_path.exists():
            raise NativeBridgeError("Native bridge state already exists.")
        self._token = secrets.token_urlsafe(32)
        self._server = await asyncio.start_unix_server(
            self._handle_client, path=str(self.socket_path)
        )
        os.chmod(self.socket_path, 0o600)
        self.broker_path.write_bytes(
            _json_line({"socket_path": str(self.socket_path), "token": self._token})
        )
        os.chmod(self.broker_path, 0o600)

    async def close(self) -> None:
        for client in tuple(self._clients):
            client.writer.close()
        self._clients.clear()
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        for path in (self.socket_path, self.broker_path):
            with contextlib.suppress(FileNotFoundError):
                path.unlink()
        self._token = ""

    async def refresh_policy(self) -> None:
        policy = await self._policy()
        policy_id = (policy["session_id"], policy["policy_epoch"])
        changed = self._last_policy != policy_id
        if changed:
            self._last_policy = policy_id
        # A new attach may have already observed the current policy ID.  Compare
        # each acknowledgement itself instead of relying only on the aggregate
        # transition flag, so an older client cannot remain verified.
        for client in self._clients:
            if client.verified_policy != policy_id:
                client.setup_verified = client.grant_verified = False
                client.verified_policy = None
        for client in tuple(self._clients):
            await self._send_or_drop(client, policy)
        if changed:
            await self._status(self._health(status="policy_updated"))

    async def _send_or_drop(self, client: _Client, value: dict[str, Any]) -> bool:
        """Keep a stale local bridge from blocking a privacy-control write."""
        try:
            await asyncio.wait_for(client.send(value), timeout=CLIENT_SEND_TIMEOUT_SECONDS)
            return True
        except (TimeoutError, ConnectionError, OSError, NativeBridgeError):
            self._clients.discard(client)
            client.writer.close()
            return False

    async def update_allowed_origins(self, origins: set[str] | frozenset[str]) -> None:
        """Apply the current validated registration file and drop removed origins."""
        self.allowed_origins = frozenset(origins)
        for client in tuple(self._clients):
            if client.origin not in self.allowed_origins:
                self._clients.discard(client)
                client.writer.close()

    def _health(self, *, status: str, origin: str | None = None) -> dict[str, Any]:
        connected = bool(self._clients)
        verified = [
            client
            for client in self._clients
            if client.setup_verified and client.verified_policy == self._last_policy
        ]
        return {
            "status": status,
            "origin": origin,
            "connected": connected,
            "setup_verified": bool(verified),
            "grant_verified": any(client.grant_verified for client in verified),
            "clients": len(self._clients),
        }

    async def _policy(self) -> dict[str, Any]:
        value = self.get_policy()
        if inspect.isawaitable(value):
            value = await value
        return _valid_policy(value)

    async def _status(self, value: dict[str, Any]) -> None:
        if not self.on_status:
            return
        result = self.on_status(value)
        if inspect.isawaitable(result):
            await result

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        client: _Client | None = None
        try:
            attach = _decode_line(await reader.readline())
            if (
                set(attach) != {"kind", "token", "origin"}
                or attach.get("kind") != "attach"
                or not secrets.compare_digest(attach.get("token", ""), self._token)
                or attach.get("origin") not in self.allowed_origins
            ):
                return
            client = _Client(writer, attach["origin"])
            self._clients.add(client)
            policy = await self._policy()
            self._last_policy = (policy["session_id"], policy["policy_epoch"])
            if not await self._send_or_drop(client, policy):
                return
            await self._status(self._health(status="connected", origin=client.origin))
            while True:
                try:
                    raw = await asyncio.wait_for(reader.readline(), timeout=5)
                except TimeoutError:
                    policy = await self._policy()
                    if policy["enabled"]:
                        if not await self._send_or_drop(
                            client,
                            {
                                "kind": "sample",
                                "session_id": policy["session_id"],
                                "policy_epoch": policy["policy_epoch"],
                            },
                        ):
                            return
                    continue
                if not raw:
                    return
                message = _decode_line(raw)
                if (
                    message.get("kind") == "hello"
                    and set(message) == {"kind", "protocol", "extension_id"}
                    and message.get("protocol") == 1
                    and _valid_identifier(message.get("extension_id"))
                ):
                    continue
                policy = await self._policy()
                if message.get("kind") == "browser" and _valid_event(message, policy):
                    result = self.on_event(message)
                    if inspect.isawaitable(result):
                        await result
                elif message.get("kind") == "status" and set(message) <= {
                    "kind",
                    "state",
                    "session_id",
                    "policy_epoch",
                }:
                    matching_policy = (
                        message.get("session_id") == policy["session_id"]
                        and message.get("policy_epoch") == policy["policy_epoch"]
                    )
                    # Setup acknowledgement is useful while collection is off: it
                    # proves the installed extension received the current policy,
                    # but does not make disabled policy eligible for sampling.
                    if message.get("state") == "ready" and matching_policy:
                        client.setup_verified = client.grant_verified = True
                        client.verified_policy = (policy["session_id"], policy["policy_epoch"])
                        await self._status(self._health(status="ready", origin=client.origin))
                    elif message.get("state") == "privacy_changed" and matching_policy:
                        client.setup_verified = client.grant_verified = False
                        client.verified_policy = None
                        await self._status(
                            self._health(status="privacy_changed", origin=client.origin)
                        )
                    continue
                else:
                    return
        except (NativeBridgeError, ConnectionError, OSError, asyncio.IncompleteReadError):
            return
        finally:
            if client:
                self._clients.discard(client)
                with contextlib.suppress(Exception):
                    await self._status(self._health(status="disconnected", origin=client.origin))
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()


def _read_broker(directory: Path) -> tuple[str, str]:
    broker = directory / "broker.json"
    if not _secure_mode(broker, 0o600):
        raise NativeBridgeError("Native bridge metadata is not private.")
    value = _decode_line(broker.read_bytes())
    socket_path, token = value.get("socket_path"), value.get("token")
    if not isinstance(socket_path, str) or not isinstance(token, str) or not token:
        raise NativeBridgeError("Invalid native bridge metadata.")
    socket = Path(socket_path)
    if socket.parent != directory or not _secure_mode(socket, 0o600):
        raise NativeBridgeError("Invalid native bridge socket.")
    return socket_path, token


async def run_native_host(directory: Path | str, origin: str) -> None:
    """Bridge Chrome's length-prefixed stdio protocol to a verified local socket."""
    if not re.fullmatch(r"chrome-extension://[a-p]{32}/", origin):
        raise NativeBridgeError("Unknown Chrome extension origin.")
    directory = Path(directory)
    socket_path, token = _read_broker(directory)
    reader, writer = await asyncio.open_unix_connection(socket_path)
    writer.write(_json_line({"kind": "attach", "token": token, "origin": origin}))
    await writer.drain()
    pipe_reader = asyncio.StreamReader(limit=MAX_MESSAGE_BYTES)
    protocol = asyncio.StreamReaderProtocol(pipe_reader)
    pipe_transport, _ = await asyncio.get_running_loop().connect_read_pipe(
        lambda: protocol, sys.stdin.buffer
    )

    async def chrome_to_socket() -> None:
        while True:
            try:
                header = await pipe_reader.readexactly(4)
            except asyncio.IncompleteReadError:
                return
            size = int.from_bytes(header, "little")
            if not 0 < size <= MAX_MESSAGE_BYTES:
                raise NativeBridgeError("Invalid Chrome frame size.")
            payload = await pipe_reader.readexactly(size)
            message = _decode_chrome_payload(payload)
            writer.write(_json_line(message))
            await writer.drain()

    async def socket_to_chrome() -> None:
        while raw := await reader.readline():
            message = _decode_line(raw)
            sys.stdout.buffer.write(_chrome_frame(message))
            sys.stdout.buffer.flush()

    tasks = [asyncio.create_task(chrome_to_socket()), asyncio.create_task(socket_to_chrome())]
    try:
        _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        pipe_transport.close()
        writer.close()
        with contextlib.suppress(Exception):
            await writer.wait_closed()
