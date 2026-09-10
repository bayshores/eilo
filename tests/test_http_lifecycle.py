"""Partially started services must release every resource without starting inference."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.http_api.application import create_app


class ApplicationLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_startup_closes_all_owned_resources(self):
        failure = RuntimeError("fixture startup failure")
        chat = SimpleNamespace(
            initialize=AsyncMock(side_effect=failure),
            close=AsyncMock(),
            calendar=SimpleNamespace(start=AsyncMock(), close=AsyncMock()),
            briefing=SimpleNamespace(close=AsyncMock()),
        )
        transcriber = SimpleNamespace(close=AsyncMock())
        with patch("app.http_api.application.Transcriber", return_value=transcriber):
            app = create_app(chat, 8765)
        app.freeze()
        with self.assertRaisesRegex(RuntimeError, "fixture startup failure"):
            await app.startup()
        chat.calendar.start.assert_not_awaited()
        for closer in (chat.calendar.close, chat.close, chat.briefing.close, transcriber.close):
            closer.assert_awaited_once()
        await app.cleanup()

    async def test_one_cleanup_failure_does_not_leak_remaining_resources(self):
        chat = SimpleNamespace(
            initialize=AsyncMock(),
            close=AsyncMock(),
            calendar=SimpleNamespace(
                start=AsyncMock(),
                close=AsyncMock(side_effect=RuntimeError("fixture close failure")),
            ),
            briefing=SimpleNamespace(close=AsyncMock()),
        )
        transcriber = SimpleNamespace(close=AsyncMock())
        with patch("app.http_api.application.Transcriber", return_value=transcriber):
            app = create_app(chat, 8765)
        app.freeze()
        await app.startup()
        with self.assertRaisesRegex(RuntimeError, "fixture close failure"):
            await app.cleanup()
        for closer in (chat.close, chat.briefing.close, transcriber.close):
            closer.assert_awaited_once()
