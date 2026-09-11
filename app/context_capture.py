"""Consent-bound orchestration for the browser bridge and desktop collector."""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import re
import stat
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.native_bridge import ContextBroker

MAX_HELPER_LINE = 6_000_000
_ORIGIN = re.compile(r"chrome-extension://[a-p]{32}/\Z")


class ContextCapture:
    """Starts no collector until the service's current policy explicitly enables it."""

    def __init__(
        self,
        directory: Path | str,
        service: Any,
        helper_path: Path | str,
        *,
        process_factory: Callable[..., Any] | None = None,
        broker_factory: Callable[..., ContextBroker] = ContextBroker,
    ):
        self.directory = Path(directory)
        self.service = service
        self.helper_path = str(helper_path)
        self.process_factory = process_factory or asyncio.create_subprocess_exec
        self.broker_factory = broker_factory
        self.broker: ContextBroker | None = None
        self._registered_origins: frozenset[str] = frozenset()
        self._browser_health = "disabled"
        self.process: Any | None = None
        self._reader_task: asyncio.Task | None = None
        self._intentional_stop = False
        self._closed = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        """Expose a dormant authenticated broker, then honor currently enabled policy."""
        async with self._lock:
            if self._closed:
                raise RuntimeError("Context capture is closed.")
            if not self.broker:
                origins = self._allowed_origins()
                self._registered_origins = frozenset(origins)
                self.broker = self.broker_factory(
                    self.directory,
                    self._on_browser_event,
                    self._browser_policy,
                    origins,
                    self._on_broker_status,
                )
                await self.broker.start()
            self._refresh_browser_health()
            await self._apply_desktop_policy()

    async def refresh_policy(self) -> None:
        """Apply revocation before returning; no helper is retained while disabled."""
        async with self._lock:
            if self._closed:
                return
            await self._apply_desktop_policy()
            if self.broker:
                await self.broker.refresh_policy()
            self._refresh_browser_health()

    async def close(self) -> None:
        async with self._lock:
            if self._closed:
                return
            self._closed = True
            await self._stop_helper("stop")
            if self.broker:
                await self.broker.close()
                self.broker = None
            self._health("desktop", "disabled", {})
            self._health("browser", "disabled", {})

    async def check(self) -> dict[str, Any]:
        """Run the helper's explicit preflight-only --check command."""
        process = await self.process_factory(
            self.helper_path,
            "--check",
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            limit=MAX_HELPER_LINE,
        )
        try:
            raw = await asyncio.wait_for(process.stdout.readline(), timeout=5)
            await asyncio.wait_for(process.wait(), timeout=5)
            value = self._decode_helper_line(raw)
            check_fields = {
                "schema_version",
                "kind",
                "accessibility_capable",
                "accessibility_permission",
                "visuals_capable",
                "screen_recording_permission",
                "browser_text_controlled_by_extension",
            }
            if (
                set(value) != check_fields
                or value.get("schema_version") != 1
                or value.get("kind") != "check"
                or any(
                    type(value[key]) is not bool
                    for key in check_fields - {"schema_version", "kind"}
                )
            ):
                raise ValueError("Invalid helper check response.")
            self._health(
                "desktop",
                "checked",
                {key: value[key] for key in check_fields - {"schema_version", "kind"}},
            )
            return value
        except Exception:
            self._health("desktop", "error", {"stage": "check"})
            raise
        finally:
            if getattr(process, "returncode", None) is None:
                with contextlib.suppress(Exception):
                    process.terminate()

    def _allowed_origins(self) -> set[str]:
        path = self.directory / "allowed-origins.json"
        if not path.exists():
            return set()
        try:
            if stat.S_IMODE(path.stat().st_mode) != 0o600:
                raise ValueError
            value = json.loads(path.read_text(encoding="utf-8"))
            origins = (
                value.get("allowed_origins")
                if isinstance(value, dict) and set(value) == {"allowed_origins"}
                else None
            )
            if (
                not isinstance(origins, list)
                or not origins
                or len(origins) > 8
                or len(set(origins)) != len(origins)
                or any(
                    not isinstance(origin, str) or not _ORIGIN.fullmatch(origin)
                    for origin in origins
                )
            ):
                raise ValueError
            return set(origins)
        except (OSError, ValueError, json.JSONDecodeError):
            self._health("browser", "error", {"stage": "registration"})
            return set()

    def _raw_policy(self, source: str) -> dict[str, Any]:
        value = self.service.collector_policy(source)
        required = {
            "session_id",
            "policy_epoch",
            "enabled",
            "text_enabled",
            "visuals_enabled",
            "excluded_bundle_ids",
            "excluded_domains",
        }
        if (
            not isinstance(value, dict)
            or not required <= set(value)
            or not isinstance(value["session_id"], str)
            or type(value["policy_epoch"]) is not int
        ):
            raise ValueError("Invalid collector policy.")
        return value

    def _browser_policy(self) -> dict[str, Any]:
        policy = self._raw_policy("browser")
        return {
            "kind": "policy",
            "schema_version": 1,
            "session_id": policy["session_id"],
            "policy_epoch": policy["policy_epoch"],
            "enabled": policy["enabled"],
            "text_enabled": policy["text_enabled"],
            "excluded_domains": policy["excluded_domains"],
        }

    @staticmethod
    def _desktop_command(policy: dict[str, Any], action: str) -> dict[str, Any]:
        command = {
            "schema_version": 1,
            "session_id": policy["session_id"],
            "policy_epoch": policy["policy_epoch"],
            "action": action,
        }
        if action in {"start", "update_policy"}:
            command["policy"] = {
                "text_enabled": policy["text_enabled"],
                "visuals_enabled": policy["visuals_enabled"],
                "excluded_bundle_ids": policy["excluded_bundle_ids"],
                "excluded_domains": policy["excluded_domains"],
            }
        return command

    async def _apply_desktop_policy(self) -> None:
        policy = self._raw_policy("desktop")
        if not policy["enabled"]:
            await self._stop_helper("pause")
            self._health("desktop", "disabled", {})
            return
        if not self.process:
            await self._start_helper(policy)
        else:
            await self._send_helper(self._desktop_command(policy, "update_policy"))
            self._health("desktop", "waiting", {})

    async def _start_helper(self, policy: dict[str, Any]) -> None:
        try:
            self._intentional_stop = False
            self.process = await self.process_factory(
                self.helper_path,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                limit=MAX_HELPER_LINE,
            )
            self._reader_task = asyncio.create_task(self._read_helper(self.process))
            await self._send_helper(self._desktop_command(policy, "start"))
            self._health("desktop", "waiting", {})
        except Exception:
            process, self.process = self.process, None
            if process:
                await self._terminate_process(process)
            if self._reader_task:
                self._reader_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self._reader_task
                self._reader_task = None
            self._health("desktop", "error", {"stage": "start"})

    async def _stop_helper(self, action: str) -> None:
        process, self.process = self.process, None
        if not process:
            return
        self._intentional_stop = True
        policy = self._raw_policy("desktop")
        with contextlib.suppress(Exception):
            await self._send_to(process, self._desktop_command(policy, action))
        await self._terminate_process(process)
        if self._reader_task:
            self._reader_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader_task
            self._reader_task = None

    async def _send_helper(self, command: dict[str, Any]) -> None:
        if self.process:
            await self._send_to(self.process, command)

    @staticmethod
    async def _terminate_process(process: Any) -> None:
        if getattr(process, "returncode", None) is None:
            with contextlib.suppress(Exception):
                process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=2)
        except TimeoutError:
            with contextlib.suppress(Exception):
                process.kill()
            await process.wait()

    @staticmethod
    async def _send_to(process: Any, command: dict[str, Any]) -> None:
        payload = json.dumps(command, separators=(",", ":")).encode("utf-8")
        if len(payload) > 128 * 1024:
            raise ValueError("Collector command is too large.")
        process.stdin.write(payload + b"\n")
        result = process.stdin.drain()
        if inspect.isawaitable(result):
            await result

    async def _read_helper(self, process: Any) -> None:
        try:
            while raw := await process.stdout.readline():
                value = self._decode_helper_line(raw)
                if value.get("kind") == "status":
                    self._helper_status(value)
                elif value.get("kind") in {"app", "text", "visual"}:
                    await self._on_desktop_event(value)
        except asyncio.CancelledError:
            raise
        except Exception:
            self._health("desktop", "error", {"stage": "protocol"})
        finally:
            if not self._intentional_stop and not self._closed:
                await self._terminate_process(process)
                self.process = None
                self._health("desktop", "error", {"stage": "exited"})

    @staticmethod
    def _decode_helper_line(raw: bytes) -> dict[str, Any]:
        if not raw or len(raw) > MAX_HELPER_LINE or not raw.endswith(b"\n"):
            raise ValueError("Invalid collector response.")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("Invalid collector response.")
        return value

    def _helper_status(self, value: dict[str, Any]) -> None:
        policy = self._raw_policy("desktop")
        if value.get("session_id") not in (None, policy["session_id"]) or value.get(
            "policy_epoch"
        ) not in (None, policy["policy_epoch"]):
            return
        status = value.get("status")
        if status not in {
            "started",
            "policy_updated",
            "paused",
            "stopped",
            "permission_required",
            "not_active",
            "invalid_command",
        }:
            self._health("desktop", "error", {"stage": "status"})
            return
        mapped = {
            "started": "ready",
            "policy_updated": "ready",
            "permission_required": "permission_required",
            "paused": "waiting",
            "stopped": "disabled",
            "not_active": "error",
            "invalid_command": "error",
        }[status]
        self._health("desktop", mapped, {})

    async def _on_desktop_event(self, value: dict[str, Any]) -> None:
        if self._matches_policy(value, "desktop"):
            await self._ingest("desktop", value)

    async def _on_browser_event(self, value: dict[str, Any]) -> None:
        if self._matches_policy(value, "browser"):
            await self._ingest("browser", value)

    def _matches_policy(self, value: Any, source: str) -> bool:
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
            "title",
            "text",
        }
        optional = {"origin", "resource_url", "image"}
        policy = self._raw_policy(source)
        return bool(
            isinstance(value, dict)
            and required <= set(value)
            and not (set(value) - required - optional)
            and policy["enabled"]
            and value.get("schema_version") == 1
            and value.get("source_id") == source
            and value.get("session_id") == policy["session_id"]
            and value.get("policy_epoch") == policy["policy_epoch"]
        )

    async def _ingest(self, source: str, event: dict[str, Any]) -> None:
        if not self._matches_policy(event, source):
            return
        try:
            result = self.service.ingest(event)
            if inspect.isawaitable(result):
                result = await result
            if isinstance(result, dict) and result.get("accepted") is True:
                self._health(source, "sampling", {})
        except Exception:
            # The service is the final admission authority; capture retains no copy.
            return

    async def _on_broker_status(self, value: dict[str, Any]) -> None:
        if not self._closed and value.get("status") in {"privacy_changed", "disconnected"}:
            boundary = getattr(self.service, "source_boundary_changed", None)
            if boundary:
                boundary()
                await self.refresh_policy()
        if value.get("status") in {"connected", "waiting", "disconnected"}:
            self._health("browser", value["status"], {})

    def _refresh_browser_health(self) -> None:
        """Project registration and observed broker state without changing the allowlist."""
        if not self._raw_policy("browser")["enabled"]:
            self._health("browser", "disabled", {})
        elif self._browser_health == "disabled":
            self._health(
                "browser",
                "registration_required" if not self._registered_origins else "waiting",
                {},
            )

    def _health(self, source: str, status: str, details: dict[str, Any]) -> None:
        if source == "browser":
            self._browser_health = status
        self.service.set_capture_health(source, status, details)
