"""Conversation, catalog, goal, task, and recovery HTTP routes."""

from __future__ import annotations

import re

from aiohttp import web

from app.accountability import canonical_goal_message
from app.chat_catalog import snapshot_catalog
from app.chat_service import MAX_MESSAGE, LocalChat
from app.onboarding import OnboardingError
from app.tasks import TaskConflict, TaskError

REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{12,80}")


def register(app: web.Application, chat: LocalChat) -> None:
    async def state(request: web.Request) -> web.Response:
        return web.json_response(await chat.wait_for_state(request.query.get("after")))

    async def catalog(request: web.Request) -> web.Response:
        if request.method == "GET":
            return web.json_response(snapshot_catalog(chat.meta))
        return web.json_response(await chat.control_catalog(await request.json()))

    async def message(request: web.Request) -> web.Response:
        body = await request.json()
        if not isinstance(body, dict) or set(body) not in (
            {"text", "request_id"},
            {"text", "request_id", "chat_id"},
        ):
            return web.json_response(
                {"error": "Send a plain message with a request ID."}, status=400
            )
        text, request_id = body["text"], body["request_id"]
        if "chat_id" in body and (
            not isinstance(body["chat_id"], str)
            or not re.fullmatch(r"[a-z][a-z0-9_-]{0,79}", body["chat_id"])
        ):
            return web.json_response({"error": "The chat reference is invalid."}, status=400)
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_MESSAGE:
            return web.json_response(
                {"error": "Enter a message of 1–12,000 characters."}, status=400
            )
        if text.lstrip().startswith(("/", "!")):
            return web.json_response(
                {
                    "error": "This chat accepts natural messages. Native commands are not enabled here."
                },
                status=400,
            )
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            return web.json_response({"error": "The message request ID is invalid."}, status=400)
        return web.json_response(
            await chat.send(text, request_id, chat_id=body.get("chat_id")), status=202
        )

    async def new(request: web.Request) -> web.Response:
        if await request.json() != {}:
            return web.json_response({"error": "Invalid conversation request."}, status=400)
        return web.json_response(await chat.new_conversation())

    async def goal(request: web.Request) -> web.Response:
        body = await request.json()
        try:
            if not isinstance(body, dict) or set(body) not in (
                {"action", "text", "request_id"},
                {"action", "text", "request_id", "chat_id"},
            ):
                raise ValueError("Invalid goal control.")
            if not all(
                isinstance(body[key], str) for key in ("action", "text", "request_id")
            ) or not REQUEST_ID.fullmatch(body["request_id"]):
                raise ValueError("Invalid goal request ID.")
            return web.json_response(
                await chat.send(
                    canonical_goal_message(body["action"], body["text"]),
                    body["request_id"],
                    chat_id=body.get("chat_id"),
                ),
                status=202,
            )
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def tasks(request: web.Request) -> web.Response:
        body = await request.json()
        try:
            if (
                not isinstance(body, dict)
                or set(body)
                not in (
                    {"operations", "request_id", "based_on_revision"},
                    {"operations", "request_id", "based_on_revision", "conversation_id"},
                )
                or not isinstance(body["request_id"], str)
                or not REQUEST_ID.fullmatch(body["request_id"])
            ):
                raise TaskError("Invalid task request.")
            if body.get("conversation_id") is not None and (
                not isinstance(body["conversation_id"], str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", body["conversation_id"])
            ):
                raise TaskError("Invalid conversation reference.")
            return web.json_response(
                await chat.control_tasks(
                    body["operations"],
                    body["request_id"],
                    body["based_on_revision"],
                    conversation_id=body.get("conversation_id"),
                )
            )
        except TaskConflict as exc:
            return web.json_response({"error": str(exc)}, status=409)
        except TaskError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def onboarding(request: web.Request) -> web.Response:
        try:
            return web.json_response(await chat.control_onboarding(await request.json()))
        except OnboardingError as exc:
            return web.json_response({"error": str(exc)}, status=exc.status)
        except TaskConflict as exc:
            return web.json_response({"error": str(exc)}, status=409)
        except TaskError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    async def recover(request: web.Request) -> web.Response:
        if await request.json() != {}:
            return web.json_response({"error": "Invalid recovery request."}, status=400)
        async with chat.lock:
            if chat.busy:
                return web.json_response({"error": "A reply is still in progress."}, status=409)
            async with chat.native_lock:
                await chat.refresh()
                await chat.recover_publication()
                await chat.proactive.recover_publications()
                chat.error, chat.blocked = None, False
                chat.changed()
        return web.json_response(chat.snapshot())

    async def chat_context(request: web.Request) -> web.Response:
        return web.json_response(await chat.compress_context(await request.json()), status=202)

    app.router.add_post("/api/chat/context", chat_context)
    app.router.add_get("/api/state", state)
    app.router.add_get("/api/workspace/catalog", catalog)
    app.router.add_post("/api/workspace/catalog", catalog)
    app.router.add_post("/api/message", message)
    app.router.add_post("/api/new", new)
    app.router.add_post("/api/goal", goal)
    app.router.add_post("/api/tasks", tasks)
    app.router.add_post("/api/onboarding/commands", onboarding)
    app.router.add_post("/api/recover", recover)
