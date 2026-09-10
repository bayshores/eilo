"""Opt-in activity sampling and activity-record control routes."""

from __future__ import annotations

import re

from aiohttp import web

from app.chat_service import LocalChat
from app.tasks import TaskConflict, TaskError


def register(app: web.Application, chat: LocalChat) -> None:
    def require_client(body: object, keys: tuple[str, ...]) -> dict:
        if (
            not isinstance(body, dict)
            or set(body) != set(keys)
            or not isinstance(body.get("client_id"), str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", body["client_id"])
        ):
            raise ValueError("Invalid activity request.")
        return body

    async def records(request: web.Request) -> web.Response:
        body = await request.json()
        try:
            if (
                not isinstance(body, dict)
                or set(body)
                != {"action", "session_id", "request_id", "based_on_revision", "conversation_id"}
                or not isinstance(body["request_id"], str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{12,80}", body["request_id"])
                or (
                    body["conversation_id"] is not None
                    and (
                        not isinstance(body["conversation_id"], str)
                        or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", body["conversation_id"])
                    )
                )
            ):
                raise TaskError("Invalid activity record request.")
            return web.json_response(await chat.control_activity_records(**body))
        except TaskConflict as exc:
            return web.json_response({"error": str(exc)}, status=409)
        except TaskError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def control(request: web.Request) -> web.Response:
        try:
            body = require_client(await request.json(), ("action", "client_id"))
            chat.proactive.control(body["action"], body["client_id"])
            return web.json_response(chat.snapshot())
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def lease(request: web.Request) -> web.Response:
        try:
            body = require_client(await request.json(), ("client_id",))
            chat.proactive.renew(body["client_id"])
            return web.json_response(chat.snapshot())
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=409)

    async def observation(request: web.Request) -> web.Response:
        try:
            body = require_client(await request.json(), ("client_id", "nonce", "observation"))
            if not isinstance(body["nonce"], str) or not re.fullmatch(
                r"[a-f0-9]{32}", body["nonce"]
            ):
                raise ValueError("Invalid sample request.")
            await chat.proactive.observe(body["client_id"], body["nonce"], body["observation"])
            return web.json_response(chat.snapshot())
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    app.router.add_post("/api/activity/records", records)
    app.router.add_post("/api/activity", control)
    app.router.add_post("/api/activity/lease", lease)
    app.router.add_post("/api/activity/observation", observation)
