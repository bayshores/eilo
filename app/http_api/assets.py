"""Serve only manifest-listed UI files; never expose a directory or source tree."""

import json

from aiohttp import web

from app.paths import WEB

# The preview server consumes this same manifest. New modules must be deliberately
# added, so a test, credential file, or development tool cannot become a route.
MANIFEST = json.loads((WEB / "asset-manifest.json").read_text())
HOME_ASSETS = frozenset(MANIFEST["home"])
PAGE_ROUTES = MANIFEST["routes"]


async def static_page(request: web.Request) -> web.FileResponse:
    return web.FileResponse(WEB / PAGE_ROUTES[request.path])


async def home_redirect(request: web.Request) -> None:
    raise web.HTTPPermanentRedirect(location="/home/")


async def home_index(request: web.Request) -> web.Response:
    index = (WEB / "index.html").read_text()
    marker = 'data-source="sample"'
    if marker not in index:
        raise RuntimeError("Home must declare its sample/live source boundary.")
    return web.Response(
        text=index.replace(marker, 'data-source="live"', 1), content_type="text/html"
    )


async def home_asset(request: web.Request) -> web.StreamResponse:
    asset = request.match_info["asset"]
    if asset not in HOME_ASSETS:
        raise web.HTTPNotFound()
    if asset == "index.html":
        return await home_index(request)
    return web.FileResponse(WEB / asset)


def register(app: web.Application) -> None:
    for route in PAGE_ROUTES:
        app.router.add_get(route, static_page)
    for route in ("/", "/workspace", "/workspace/", "/home"):
        app.router.add_get(route, home_redirect)
    app.router.add_get("/home/", home_index)
    app.router.add_get("/home/{asset:.*}", home_asset)
