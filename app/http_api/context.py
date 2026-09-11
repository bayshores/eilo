"""Presentation/capture controls; observations never enter through HTTP."""

from aiohttp import web

from app.context_service import ContextError

HOME_ACTIONS = {"set_mode", "pin", "unpin", "undo", "feedback", "preference"}
CONTEXT_ACTIONS = {"configure", "correct", "forget", "note"}


def register(app, chat):
    async def command(request):
        body = await request.json()
        actions = HOME_ACTIONS if request.path == "/api/home/commands" else CONTEXT_ACTIONS
        if not isinstance(body, dict) or body.get("action") not in actions:
            return web.json_response({"error": "Unsupported workspace command."}, status=400)
        try:
            await chat.context.command(body)
            if body["action"] in {"configure", "forget"}:
                await chat.context_capture.refresh_policy()
            return web.json_response(chat.snapshot())
        except ContextError as exc:
            return web.json_response({"error": str(exc)}, status=exc.status)

    async def capabilities(request):
        if set(request.query) - {"source"}:
            return web.json_response({"error": "Unsupported capabilities query."}, status=400)
        source = request.query.get("source", "desktop")
        if source not in {"desktop", "browser"}:
            return web.json_response({"error": "Unsupported capture source."}, status=400)
        try:
            # This is a non-starting preflight.  The matching source health is
            # published through the ordinary state snapshot after the request.
            return web.json_response(await chat.context_capture.refresh_health(source))
        except (OSError, ValueError, TimeoutError):
            return web.json_response({"error": "The context helper is unavailable."}, status=503)

    app.router.add_post("/api/home/commands", command)
    app.router.add_post("/api/context/commands", command)
    app.router.add_get("/api/context/capabilities", capabilities)
