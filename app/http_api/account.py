"""Account controls reuse the loopback and same-origin HTTP boundary."""

from aiohttp import web

from app.account_service import AccountError


def register(app, chat):
    async def command(request):
        try:
            await chat.account.command(await request.json())
            return web.json_response(chat.snapshot())
        except AccountError as exc:
            return web.json_response({"error": str(exc)}, status=exc.status)

    app.router.add_post("/api/account/commands", command)
