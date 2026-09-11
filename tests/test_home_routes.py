import socket
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer

from app.briefing import Briefing
from app.google_calendar import GoogleCalendarConnection
from app.http_api.application import create_app
from app.paths import ROOT


class FakeChat:
    async def initialize(self):
        pass

    async def close(self):
        pass

    async def wait_for_state(self, after):
        return {"status": "ready"}


class HomeRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / ".tmp")
        chat = FakeChat()
        chat.calendar = GoogleCalendarConnection(Path(self.directory.name))
        chat.meta = {}
        chat.save_meta = lambda: None
        chat.changed = lambda: None
        chat.briefing = Briefing(chat, Path(self.directory.name))
        self.server = TestServer(create_app(chat, self.port), host="127.0.0.1", port=self.port)
        self.client = TestClient(self.server)
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.directory.cleanup()

    async def test_home_redirect_and_live_canonical_marker(self):
        for entry in ("/", "/workspace", "/workspace/", "/home", "/?next=https://example.test"):
            redirect = await self.client.get(entry, allow_redirects=False)
            self.assertEqual(redirect.status, 308, entry)
            self.assertEqual(redirect.headers["Location"], "/home/", entry)
            landed = await self.client.get(entry)
            self.assertEqual(landed.url.path, "/home/", entry)
            self.assertIn('data-source="live"', await landed.text(), entry)
        page = await self.client.get("/home/")
        self.assertEqual(page.status, 200)
        self.assertIn(
            '<html lang="en" data-typography="plex" data-source="live">', await page.text()
        )
        direct_index = await self.client.get("/home/index.html")
        self.assertEqual(direct_index.status, 200)
        self.assertIn('data-source="live"', await direct_index.text())

    async def test_extension_setup_returns_to_current_activity_and_uses_connection_page(self):
        class Links(HTMLParser):
            def __init__(self):
                super().__init__()
                self.hrefs = []

            def handle_starttag(self, tag, attrs):
                if tag == "a":
                    self.hrefs.append(dict(attrs).get("href"))

        setup = await self.client.get("/activity-setup.html")
        self.assertEqual(setup.status, 200)
        parser = Links()
        parser.feed(await setup.text())
        self.assertEqual(parser.hrefs[0], "/home/#activity")
        self.assertIn("/activity-connect", parser.hrefs)
        for href in parser.hrefs:
            self.assertIn(href, ("/home/#activity", "/activity-connect"))
            destination = await self.client.get(href.split("#")[0])
            self.assertEqual(destination.status, 200)
            if href.startswith("/home/"):
                self.assertIn('data-source="live"', await destination.text())

    async def test_desktop_identity_uses_existing_local_boundaries(self):
        response = await self.client.get("/api/desktop", headers={"X-Eilo-Client": "local-chat"})
        self.assertEqual(response.status, 200)
        self.assertEqual(
            await response.json(), {"app": "eilo", "protocol": 1, "workspace": str(ROOT)}
        )
        for headers in ({}, {"X-Eilo-Client": "local-chat", "Origin": "https://example.test"}):
            denied = await self.client.get("/api/desktop", headers=headers)
            self.assertEqual(denied.status, 403)

    async def test_only_allowlisted_home_assets_are_served(self):
        for path in (
            "/home/index.html",
            "/home/home/layout.js",
            "/home/workspace/views.js",
            "/home/workspace/views.css",
            "/home/workspace/item-controls.js",
            "/home/workspace/item-controls.css",
            "/home/goals/editor.js",
            "/home/goals/data.js",
            "/home/connections/calendar.js",
            "/home/connections/calendar.css",
            "/home/activity/setup.js",
            "/home/activity/setup-page.js",
            "/home/activity/setup.css",
            "/home/calendar/agenda.js",
            "/home/assets/fonts/ibm-plex-sans.woff2",
        ):
            response = await self.client.get(path)
            self.assertEqual(response.status, 200, path)
        for path in (
            "/home/server.py",
            "/home/.state/local-chat.json",
            "/home/%2e%2e/.state/local-chat.json",
        ):
            response = await self.client.get(path)
            self.assertEqual(response.status, 404, path)

    async def test_existing_boundaries_and_headers_remain_strict(self):
        root = await self.client.get("/")
        workspace = await self.client.get("/workspace")
        self.assertEqual(root.status, 200)
        self.assertEqual(workspace.status, 200)
        state = await self.client.get("/api/state", headers={"X-Eilo-Client": "local-chat"})
        self.assertEqual(state.status, 200)
        self.assertIn("font-src 'self'", state.headers["Content-Security-Policy"])
        missing_client = await self.client.get("/api/state")
        self.assertEqual(missing_client.status, 403)
        bad_origin = await self.client.get("/home/", headers={"Origin": "http://example.test"})
        self.assertEqual(bad_origin.status, 403)
        bad_host = await self.client.get("/home/", headers={"Host": "example.test"})
        self.assertEqual(bad_host.status, 403)

    async def test_checkin_status_assets_are_available_without_exposing_tests(self):
        for asset in ("activity/checkins.js", "activity/checkin-data.js", "activity/checkins.css"):
            response = await self.client.get("/home/" + asset)
            self.assertEqual(response.status, 200, asset)
        response = await self.client.get("/home/activity/checkin-data.test.js")
        self.assertEqual(response.status, 404)

    async def test_unconfigured_calendar_uses_real_connector_and_rejects_cross_site_access(self):
        response = await self.client.get(
            "/api/integrations/google-calendar", headers={"X-Eilo-Client": "local-chat"}
        )
        self.assertEqual(response.status, 200)
        value = await response.json()
        self.assertEqual(value["state"], "unavailable")
        self.assertIs(value["configured"], False)
        self.assertIsNone(value["account"])
        self.assertEqual(value["events"], [])
        self.assertNotIn("authorization_url", value)
        denied = await self.client.get(
            "/api/integrations/google-calendar",
            headers={"X-Eilo-Client": "local-chat", "Origin": "https://example.com"},
        )
        self.assertEqual(denied.status, 403)
        begin = await self.client.post(
            "/api/integrations/google-calendar",
            headers={"X-Eilo-Client": "local-chat"},
            json={"action": "begin", "based_on_revision": 0},
        )
        self.assertEqual(begin.status, 503)
        self.assertEqual((await begin.json())["code"], "not_configured")
