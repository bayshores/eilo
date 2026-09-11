"""Cancellable, bounded stdin transport to the isolated analysis process."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import signal

from app.adaptive_driver import MAX_INPUT, AnalysisError, decode_json, validate_input
from app.paths import ROOT


async def analyze_context(request, *, launcher=None):
    request = validate_input(request)
    data = json.dumps(request, ensure_ascii=False, allow_nan=False).encode()
    if len(data) > MAX_INPUT:
        raise AnalysisError("Context input exceeded its limit.")
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
        str(launcher or ROOT / "scripts/adaptive-driver"),
        cwd=ROOT,
        env=env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True,
        limit=128 * 1024,
    )

    async def exchange():
        process.stdin.write(data)
        await process.stdin.drain()
        process.stdin.close()
        chunks, total = [], 0
        while chunk := await process.stdout.read(8192):
            total += len(chunk)
            if total > 128 * 1024:
                raise AnalysisError("Context output exceeded its limit.")
            chunks.append(chunk)
        await process.wait()
        if process.returncode:
            raise AnalysisError("Context analysis is unavailable.")
        return decode_json(b"".join(chunks))

    try:
        return await asyncio.wait_for(exchange(), timeout=75)
    finally:
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), timeout=2)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
