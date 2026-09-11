from __future__ import annotations

import unittest

from app.account_driver import AccountDriverError, login, status


class AccountDriverTest(unittest.TestCase):
    def test_pending_to_connected_without_secret_output(self):
        saved = []
        flow = login(
            lambda: {"user_code": "ABCD"},
            lambda _: "code",
            lambda _: {"access_token": "secret", "refresh_token": "refresh"},
            lambda value, **_: saved.append(value),
            lambda _: None,
            lambda: "now",
        )
        self.assertEqual(
            next(flow),
            {
                "state": "awaiting_sign_in",
                "verification_url": "https://auth.openai.com/codex/device",
                "user_code": "ABCD",
            },
        )
        self.assertEqual(next(flow), {"state": "connected"})
        self.assertEqual(len(saved), 1)

    def test_failure_and_status_are_sanitized(self):
        self.assertEqual(status(lambda: {"logged_in": True}), {"state": "connected"})
        self.assertEqual(
            status(lambda: (_ for _ in ()).throw(RuntimeError("secret"))), {"state": "unavailable"}
        )
        with self.assertRaises(AccountDriverError):
            list(
                login(
                    lambda: {},
                    lambda _: None,
                    lambda _: None,
                    lambda *_, **__: None,
                    lambda _: None,
                    lambda: "",
                )
            )


if __name__ == "__main__":
    unittest.main()
