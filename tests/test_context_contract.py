from __future__ import annotations

import unittest

from app.context_contract import ContextValidationError, validate_event, validate_settings


class ContextContractTest(unittest.TestCase):
    def test_desktop_event_and_revocation(self):
        policy = {
            "enabled": True,
            "session_id": "session-1",
            "policy_epoch": 2,
            "desktop_enabled": True,
            "browser_enabled": True,
            "text_enabled": True,
            "visuals_enabled": False,
            "excluded_bundle_ids": [],
            "excluded_domains": [],
        }
        event = {
            "schema_version": 1,
            "id": "event-1",
            "source_id": "desktop",
            "session_id": "session-1",
            "policy_epoch": 2,
            "captured_at": 100,
            "kind": "app",
            "bundle_id": "com.example.Editor",
            "app_name": "Editor",
            "title": "",
            "text": "",
        }
        self.assertEqual(validate_event(event, policy, 100)["id"], "event-1")
        event.update(
            kind="text",
            title="Private page",
            text="Withheld",
            bundle_id="com.google.Chrome.app.example",
        )
        self.assertIsNone(validate_event(event, policy, 100))
        policy["enabled"] = False
        self.assertIsNone(validate_event(event, policy, 100))

    def test_browser_text_is_admitted_and_private_origin_is_rejected(self):
        policy = {
            "enabled": True,
            "session_id": "session-1",
            "policy_epoch": 2,
            "desktop_enabled": True,
            "browser_enabled": True,
            "text_enabled": True,
            "visuals_enabled": False,
            "excluded_bundle_ids": [],
            "excluded_domains": [],
        }
        event = {
            "schema_version": 1,
            "id": "event-1",
            "source_id": "browser",
            "session_id": "session-1",
            "policy_epoch": 2,
            "captured_at": 100,
            "kind": "browser",
            "bundle_id": "browser",
            "app_name": "Browser",
            "title": "rich",
            "text": "approved text",
            "origin": "https://example.com",
        }
        self.assertEqual(validate_event(event, policy, 100)["text"], "approved text")
        event["origin"] = "http://127.0.0.1"
        with self.assertRaises(ContextValidationError):
            validate_event(event, policy, 100)

    def test_settings_fail_closed(self):
        defaults = {"revision": 0, "policy_epoch": 0, "mode": "manual", "enabled": False}
        self.assertEqual(validate_settings({"revision": "bad"}, defaults), defaults)
        self.assertTrue(
            validate_settings(
                {"revision": 1, "policy_epoch": 2, "mode": "adaptive", "enabled": True}, defaults
            )["enabled"]
        )


if __name__ == "__main__":
    unittest.main()
