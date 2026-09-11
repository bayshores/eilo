from __future__ import annotations

import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from app.http_api.context import register


class Capture:
    def __init__(self):
        self.sources = []

    async def refresh_health(self, source):
        self.sources.append(source)
        return {"source": source}

    async def refresh_policy(self):
        pass


class Context:
    async def command(self, body):
        return None


class Chat:
    def __init__(self):
        self.context_capture = Capture()
        self.context = Context()

    def snapshot(self):
        return {}


class ContextApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.chat = Chat()
        app = web.Application()
        register(app, self.chat)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_browser_capabilities_routes_without_desktop_preflight(self):
        response = await self.client.get("/api/context/capabilities?source=browser")
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.json(), {"source": "browser"})
        self.assertEqual(self.chat.context_capture.sources, ["browser"])

    async def test_default_desktop_and_unknown_query_are_validated(self):
        response = await self.client.get("/api/context/capabilities")
        self.assertEqual(response.status, 200)
        self.assertEqual(self.chat.context_capture.sources, ["desktop"])
        response = await self.client.get("/api/context/capabilities?source=unknown")
        self.assertEqual(response.status, 400)
        response = await self.client.get("/api/context/capabilities?source=browser&extra=1")
        self.assertEqual(response.status, 400)


if __name__ == "__main__":
    unittest.main()
