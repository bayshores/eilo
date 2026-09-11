"""Synthetic device-flow processes: no network, account, or native permissions."""

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

from app.account_service import AccountError, AccountService
from app.runtime_auth import isolate_account


class AccountTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.launcher = Path(self.temp.name) / "fake-account"
        self.service = AccountService(launcher=self.launcher, auto_status=False)

    async def asyncTearDown(self):
        await self.service.close()
        self.temp.cleanup()

    def fixture(self, content):
        self.launcher.write_text(f"#!{sys.executable}\n" + content)
        self.launcher.chmod(0o700)

    async def command(self, action, request_id):
        return await self.service.command(
            {
                "action": action,
                "request_id": request_id,
                "based_on_revision": self.service.state["revision"],
            }
        )

    async def test_complete_cancel_and_stale_commands(self):
        self.fixture('print(\'{"state":"connected"}\', flush=True)\n')
        await self.command("start", "request-connect-1")
        await self.service.job
        self.assertEqual(self.service.snapshot()["state"], "connected")
        with self.assertRaises(AccountError):
            await self.service.command(
                {"action": "start", "request_id": "request-connect-2", "based_on_revision": 0}
            )
        event = json.dumps(
            {
                "state": "awaiting_sign_in",
                "user_code": "ABCD-1234",
                "verification_url": "https://auth.openai.com/codex/device",
            }
        )
        self.fixture(f"import time\nprint({event!r}, flush=True)\ntime.sleep(30)\n")
        pending = asyncio.Event()
        self.service.changed = lambda: (
            pending.set() if self.service.state["state"] == "awaiting_sign_in" else None
        )
        await self.command("start", "request-connect-3")
        await asyncio.wait_for(pending.wait(), 3)
        await self.command("cancel", "request-cancel-1")
        self.assertEqual(self.service.snapshot()["state"], "needs_sign_in")
        self.assertNotIn("user_code", self.service.snapshot())
        self.assertIsNone(self.service.job)

    async def test_invalid_output_is_not_forwarded(self):
        self.fixture(
            'print(\'{"state":"awaiting_sign_in","user_code":"secret","verification_url":"https://untrusted.test"}\', flush=True)\n'
        )
        await self.command("start", "request-invalid-1")
        await self.service.job
        self.assertEqual(self.service.snapshot()["state"], "unavailable")
        self.assertNotIn("secret", json.dumps(self.service.snapshot()))

    def test_runtime_recovery_cannot_import_another_apps_account(self):
        package = ModuleType("hermes_cli")
        package.auth, package.auth_codex = ModuleType("auth"), ModuleType("auth_codex")
        with patch.dict(sys.modules, {"hermes_cli": package}):
            isolate_account()
        for module in (package.auth, package.auth_codex):
            self.assertIsNone(module._import_codex_cli_tokens())
            self.assertIsNone(module._recover_codex_tokens_from_cli("expired"))


if __name__ == "__main__":
    unittest.main()
