"""Routes for per-chat capability profiles."""

from aiohttp import web

from app.capabilities import CapabilityError


def register(app, chat):
    async def capabilities(request):
        try:
            if request.method == "GET":
                return web.json_response(chat.capabilities.snapshot())
            return web.json_response(chat.capabilities.control(await request.json()))
        except CapabilityError as exc:
            return web.json_response({"error": str(exc)}, status=exc.status)
        except (OSError, TypeError, KeyError):
            return web.json_response(
                {"error": "Capability settings could not be saved."}, status=503
            )

    app.router.add_get("/api/capabilities", capabilities)
    app.router.add_post("/api/capabilities", capabilities)
