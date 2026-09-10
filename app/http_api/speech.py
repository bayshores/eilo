"""Bounded microphone transcription routes."""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import json
import re

from aiohttp import web

from app.transcription import Transcriber, TranscriptionError


def register(app: web.Application, transcriber: Transcriber) -> None:
    async def status(request: web.Request) -> web.Response:
        return web.json_response(transcriber.status())

    async def transcribe(request: web.Request) -> web.Response:
        data = bytearray()
        async for chunk in request.content.iter_chunked(65_536):
            data.extend(chunk)
            if len(data) > 5_300_000:
                raise web.HTTPRequestEntityTooLarge(max_size=5_300_000, actual_size=len(data))
        try:
            body = json.loads(data)
            if not isinstance(body, dict) or set(body) != {"request_id", "audio"}:
                raise ValueError()
            if not isinstance(body["request_id"], str) or not re.fullmatch(
                r"[A-Za-z0-9_-]{12,80}", body["request_id"]
            ):
                raise ValueError()
            if not isinstance(body["audio"], str):
                raise ValueError()
            wav = base64.b64decode(body["audio"], validate=True)
        except (ValueError, TypeError, binascii.Error):
            return web.json_response({"error": "Send a valid microphone recording."}, status=400)
        work = asyncio.create_task(transcriber.transcribe(wav, body["request_id"]))
        try:
            while not work.done():
                await asyncio.wait({work}, timeout=0.2)
                if request.transport is None or request.transport.is_closing():
                    await transcriber.cancel(body["request_id"])
                    work.cancel()
                    raise asyncio.CancelledError()
            return web.json_response({"text": await work, "request_id": body["request_id"]})
        except asyncio.CancelledError:
            work.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await work
            raise
        except TranscriptionError as exc:
            return web.json_response({"error": str(exc)}, status=exc.status)
        except Exception:
            return web.json_response(
                {"error": "Local transcription could not finish. You can still type your message."},
                status=503,
            )

    async def cancel(request: web.Request) -> web.Response:
        body = await request.json()
        if (
            not isinstance(body, dict)
            or set(body) != {"request_id"}
            or not isinstance(body["request_id"], str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", body["request_id"])
        ):
            return web.json_response({"error": "Invalid recording request."}, status=400)
        await transcriber.cancel(body["request_id"])
        return web.json_response({"cancelled": True})

    app.router.add_get("/api/speech", status)
    app.router.add_post("/api/transcribe", transcribe)
    app.router.add_post("/api/transcribe/cancel", cancel)
