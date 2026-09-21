from __future__ import annotations

import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from app.capabilities import CapabilityError
from app.http_api.capabilities import register


class Capabilities:
    def __init__(self):
        self.calls = []
        self.value = {
            "version": 1,
            "revision": 2,
            "chat_id": "chat-one",
            "chat_name": "Focus",
            "connectors": [],
            "skills": [],
            "mcps": [],
            "plugins": [],
        }

    def snapshot(self):
        return self.value

    def control(self, body):
        self.calls.append(body)
        if body.get("id") == "stale":
            raise CapabilityError("Capabilities changed.", 409)
        return {**self.value, "revision": 3}


class Chat:
    def __init__(self):
        self.capabilities = Capabilities()


class CapabilitiesApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.chat = Chat()
        app = web.Application()
        register(app, self.chat)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_get_and_revisioned_change(self):
        response = await self.client.get("/api/capabilities")
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["chat_id"], "chat-one")

        body = {
            "action": "set_enabled",
            "based_on_revision": 2,
            "chat_id": "chat-one",
            "kind": "skill",
            "id": "focus",
            "enabled": True,
        }
        response = await self.client.post("/api/capabilities", json=body)
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["revision"], 3)
        self.assertEqual(self.chat.capabilities.calls, [body])

    async def test_domain_conflict_status_is_preserved(self):
        response = await self.client.post("/api/capabilities", json={"id": "stale"})
        self.assertEqual(response.status, 409)
        self.assertEqual((await response.json())["error"], "Capabilities changed.")


if __name__ == "__main__":
    unittest.main()
