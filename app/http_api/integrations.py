"""Routes for explicit connection and source-management actions."""

from __future__ import annotations

from aiohttp import web

from app.chat_service import LocalChat
from app.connections import ConnectionError
from app.google_calendar import CalendarError


def register(app: web.Application, chat: LocalChat) -> None:
    async def connections(request: web.Request) -> web.Response:
        if request.method == "GET":
            return web.json_response(chat.connections.snapshot())
        try:
            return web.json_response(await chat.connections.control(await request.json()))
        except ConnectionError as exc:
            return web.json_response(
                {"error": str(exc), "needs_setup": exc.needs_setup}, status=exc.status
            )
        except (OSError, TypeError, KeyError):
            return web.json_response(
                {
                    "error": "The connection change could not be saved. Review the current state before trying again."
                },
                status=503,
            )

    async def google_calendar(request: web.Request) -> web.Response:
        if request.method == "GET":
            return web.json_response(chat.calendar.snapshot(include_authorization=True))
        try:
            body = await request.json()
            prior_sub = (chat.calendar.data.get("account") or {}).get("sub")
            result = await chat.calendar.control(body)
            if body.get("action") == "disconnect":
                await chat.briefing.mail.calendar_disconnected(prior_sub)
            chat.briefing.sources_changed()
            return web.json_response(result)
        except CalendarError as exc:
            return web.json_response({"error": str(exc), "code": exc.code}, status=exc.status)
        except (OSError, TypeError, KeyError):
            return web.json_response(
                {"error": "Calendar setup could not be saved. Try again.", "code": "local_state"},
                status=503,
            )

    async def briefing_sources(request: web.Request) -> web.Response:
        if request.method == "GET":
            return web.json_response(chat.briefing.mail.snapshot(True))
        try:
            result = await chat.briefing.mail.control(await request.json())
            chat.briefing.sources_changed()
            return web.json_response(result)
        except CalendarError as exc:
            return web.json_response({"error": str(exc), "code": exc.code}, status=exc.status)
        except (OSError, TypeError, KeyError):
            return web.json_response(
                {"error": "Source setup could not be saved. Try again."}, status=503
            )

    async def cancel_workflow(request: web.Request) -> web.Response:
        body = await request.json()
        if (
            not isinstance(body, dict)
            or set(body) != {"request_id"}
            or not isinstance(body["request_id"], str)
        ):
            raise web.HTTPBadRequest()
        try:
            return web.json_response(await chat.briefing.cancel(body["request_id"]))
        except CalendarError as exc:
            return web.json_response({"error": str(exc)}, status=exc.status)

    app.router.add_get("/api/connections", connections)
    app.router.add_post("/api/connections", connections)
    app.router.add_get("/api/integrations/google-calendar", google_calendar)
    app.router.add_post("/api/integrations/google-calendar", google_calendar)
    app.router.add_get("/api/integrations/briefing-sources", briefing_sources)
    app.router.add_post("/api/integrations/briefing-sources", briefing_sources)
    app.router.add_post("/api/workflow/cancel", cancel_workflow)
