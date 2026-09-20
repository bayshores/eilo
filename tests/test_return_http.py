import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from app.http_api.conversations import register


class Returns:
    def __init__(self):
        self.calls = []

    async def request(self, request_id, reason, local_day, *, draft_present):
        self.calls.append((request_id, reason, local_day, draft_present))


class Chat:
    def __init__(self):
        self.returns = Returns()

    def snapshot(self):
        return {"schema_version": 2, "revision": "fixture:1", "return_briefing": {"phase": "idle"}}

    async def wait_for_state(self, _after):
        return self.snapshot()


class ReturnHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.chat = Chat()
        app = web.Application()
        register(app, self.chat)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_return_route_passes_the_minimized_request_and_returns_full_state(self):
        response = await self.client.post(
            "/api/return/briefing",
            json={
                "request_id": "return_http_001",
                "reason": "daily",
                "local_day": "2026-09-19",
                "draft_present": False,
            },
        )
        self.assertEqual(response.status, 202)
        self.assertEqual((await response.json())["schema_version"], 2)
        self.assertEqual(
            self.chat.returns.calls,
            [("return_http_001", "daily", "2026-09-19", False)],
        )

    async def test_route_rejects_extra_or_wrongly_typed_data_before_starting_work(self):
        for body in (
            {},
            {
                "request_id": "return_http_001",
                "reason": "other",
                "local_day": "2026-09-19",
                "draft_present": False,
            },
            {
                "request_id": "return_http_001",
                "reason": "daily",
                "local_day": "2026-09-19",
                "draft_present": "false",
            },
            {
                "request_id": "return_http_001",
                "reason": "daily",
                "local_day": "2026-09-19",
                "draft_present": False,
                "extra": True,
            },
        ):
            response = await self.client.post("/api/return/briefing", json=body)
            self.assertEqual(response.status, 400)
        self.assertEqual(self.chat.returns.calls, [])


if __name__ == "__main__":
    unittest.main()
