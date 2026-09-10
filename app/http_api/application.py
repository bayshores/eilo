"""Loopback HTTP application assembly, security boundary, and lifecycle."""

from __future__ import annotations

import json
from contextlib import AsyncExitStack

from aiohttp import web

from app.chat_catalog import CatalogError
from app.chat_service import LocalChat
from app.errors import ChatError
from app.http_api import activity, assets, conversations, integrations, speech
from app.paths import ROOT
from app.transcription import Transcriber


def create_app(chat: LocalChat, port: int) -> web.Application:
    """Assemble the local-only UI boundary around one chat instance."""

    @web.middleware
    async def boundaries(request: web.Request, handler):
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if (
            request.host not in allowed_hosts
            or request.headers.get("Origin") not in (None, f"http://{request.host}")
            or request.headers.get("Sec-Fetch-Site") == "cross-site"
        ):
            raise web.HTTPForbidden()
        if request.path.startswith("/api/"):
            if request.headers.get("X-Eilo-Client") != "local-chat":
                raise web.HTTPForbidden()
            if request.method == "POST" and request.content_type != "application/json":
                raise web.HTTPUnsupportedMediaType()
        try:
            return await handler(request)
        except ChatError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except CatalogError as exc:
            return web.json_response({"error": str(exc)}, status=exc.status)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return web.json_response({"error": "Send a valid message."}, status=400)

    app = web.Application(middlewares=[boundaries], client_max_size=64 * 1024)

    async def headers(request: web.Request, response: web.StreamResponse) -> None:
        response.headers.update(
            {
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "Referrer-Policy": "no-referrer",
                "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
            }
        )

    transcriber = Transcriber(ROOT)
    app.on_response_prepare.append(headers)
    assets.register(app)
    integrations.register(app, chat)
    speech.register(app, transcriber)
    conversations.register(app, chat)
    activity.register(app, chat)

    async def desktop_identity(request: web.Request) -> web.Response:
        return web.json_response({"app": "eilo", "protocol": 1, "workspace": str(ROOT)})

    async def health(request: web.Request) -> web.Response:
        return web.json_response({"ok": True})

    async def lifecycle(application: web.Application):
        # Register cleanup before starting anything. A partially failed startup
        # must release its resources, and one close failure must not skip others.
        async with AsyncExitStack() as cleanup:
            cleanup.push_async_callback(transcriber.close)
            cleanup.push_async_callback(chat.briefing.close)
            cleanup.push_async_callback(chat.close)
            cleanup.push_async_callback(chat.calendar.close)
            await chat.initialize()
            await chat.calendar.start()
            yield

    app.router.add_get("/api/desktop", desktop_identity)
    app.router.add_get("/health", health)
    app.cleanup_ctx.append(lifecycle)
    return app
