"""HTTP stream boundaries; no account, provider, model or live state is touched."""

import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from app.google_calendar import CalendarError, GoogleCalendarConnection, _read_bounded_body


class ChunkedBody:
    def __init__(self, parts):
        self.parts = parts
        self.consumed = 0

    async def iter_chunked(self, _size):
        for part in self.parts:
            self.consumed += 1
            yield part


class CalendarBodyTests(unittest.IsolatedAsyncioTestCase):
    async def test_complete_json_survives_small_and_split_utf8_fragments(self):
        expected = {"kind": "calendar#events", "items": [{"summary": "Café demo"}]}
        encoded = json.dumps(expected, ensure_ascii=False).encode()
        for width in (1, 3, 11, len(encoded)):
            body = ChunkedBody([encoded[i : i + width] for i in range(0, len(encoded), width)])
            raw = await _read_bounded_body(body)
            self.assertEqual(json.loads(raw), expected)
            self.assertEqual(body.consumed, len(body.parts))

    async def test_size_limit_is_enforced_across_fragments_without_reading_the_rest(self):
        body = ChunkedBody([b"123", b"456", b"789", b"never read"])
        with self.assertRaises(CalendarError) as caught:
            await _read_bounded_body(body, limit=8)
        self.assertEqual(caught.exception.code, "response_size")
        self.assertEqual(body.consumed, 3)

    async def test_exact_limit_and_empty_stream_are_allowed(self):
        self.assertEqual(
            await _read_bounded_body(ChunkedBody([b"123", b"456"]), limit=6), b"123456"
        )
        self.assertEqual(await _read_bounded_body(ChunkedBody([])), b"")

    async def test_begin_creates_pkce_authorization_without_keychain_or_network(self):
        class AvailableStore:
            available = True

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / ".state"
            state.mkdir()
            (state / "google-calendar-client.json").write_text(
                json.dumps({"client_id": "12345-fixture.apps.googleusercontent.com"})
            )
            connection = GoogleCalendarConnection(root, store=AvailableStore())
            try:
                result = await connection.control({"action": "begin", "based_on_revision": 0})
                query = parse_qs(urlsplit(result["authorization_url"]).query)

                self.assertEqual(result["state"], "authorizing")
                self.assertEqual(query["client_id"], ["12345-fixture.apps.googleusercontent.com"])
                self.assertEqual(query["code_challenge_method"], ["S256"])
                self.assertEqual(query["state"], [connection.flow["state"]])
                self.assertEqual(query["redirect_uri"], [connection.flow["redirect_uri"]])
            finally:
                await connection.close()
