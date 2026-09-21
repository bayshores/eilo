import json
import tempfile
import unittest
from pathlib import Path

import yaml

from app.capabilities import Capabilities, CapabilityError


class Connections:
    def snapshot(self):
        return {
            "revision": 1,
            "apps": [
                {
                    "id": "gmail",
                    "name": "Gmail",
                    "description": "Mail",
                    "enabled": True,
                    "state": "On",
                }
            ],
            "mcps": [
                {
                    "id": "mcp-" + "a" * 24,
                    "name": "Notes",
                    "description": "Tools",
                    "enabled": True,
                    "state": "Enabled",
                }
            ],
        }


class Chat:
    def __init__(self, root):
        self.meta_path = root / "local-chat.json"
        self.meta = {
            "chat_catalog": {
                "active_chat_id": "chat-one",
                "chats": [{"id": "chat-one", "name": "One"}],
            }
        }
        self.connections = Connections()
        self.changed_count = 0

    def changed(self):
        self.changed_count += 1


class CapabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        skill = self.root / "hermes/skills/focus"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(
            "---\nname: focus\ndescription: Help maintain focus.\n---\nUse it.\n"
        )
        self.chat = Chat(self.root)
        plugin = self.root / "hermes/plugins/helper/skills/coach"
        plugin.mkdir(parents=True)
        (plugin.parent.parent / "plugin.yaml").write_text(
            "name: helper\ndescription: A coaching bundle.\n"
        )
        (plugin / "SKILL.md").write_text(
            "---\nname: coach\ndescription: Coach this chat.\n---\nUse it.\n"
        )
        (self.root / "hermes/config.yaml").write_text("plugins:\n  enabled:\n    - helper\n")
        self.capabilities = Capabilities(self.chat)

    def tearDown(self):
        self.temp.cleanup()

    def change(self, kind, identity, enabled):
        current = self.capabilities.snapshot()
        return self.capabilities.control(
            {
                "action": "set_enabled",
                "based_on_revision": current["revision"],
                "chat_id": current["chat_id"],
                "kind": kind,
                "id": identity,
                "enabled": enabled,
            }
        )

    def test_profile_is_per_chat_and_takes_effect_in_active_projection(self):
        self.change("skill", "focus", True)
        self.change("connector", "gmail", False)
        self.change("mcp", "mcp-" + "a" * 24, True)
        self.change("plugin", "helper", True)
        self.assertEqual(
            self.capabilities.active(),
            {
                "sources": [],
                "skills": ["focus", "helper:coach"],
                "mcp_servers": ["mcp-" + "a" * 24],
                "plugins": ["helper"],
            },
        )
        saved = json.loads((self.root / "capability-profiles.json").read_text())
        self.assertIn("chat-one", saved["profiles"])
        self.assertEqual(self.chat.changed_count, 4)

    def test_stale_chat_and_unknown_capability_fail_closed(self):
        current = self.capabilities.snapshot()
        with self.assertRaises(CapabilityError) as stale:
            self.capabilities.control(
                {
                    "action": "set_enabled",
                    "based_on_revision": current["revision"],
                    "chat_id": "chat-other",
                    "kind": "skill",
                    "id": "focus",
                    "enabled": True,
                }
            )
        self.assertEqual(stale.exception.status, 409)
        with self.assertRaises(CapabilityError) as missing:
            self.change("skill", "missing", True)
        self.assertEqual(missing.exception.status, 404)

    def test_nested_plugin_uses_the_runtime_registry_key(self):
        nested = self.root / "hermes/plugins/research/helper/skills/plan"
        nested.mkdir(parents=True)
        (nested.parent.parent / "plugin.yaml").write_text(
            "name: research-helper\ndescription: Nested helper.\n"
        )
        (nested / "SKILL.md").write_text(
            "---\nname: plan\ndescription: Plan research.\n---\nUse it.\n"
        )
        (self.root / "hermes/config.yaml").write_text(
            "plugins:\n  enabled:\n    - helper\n    - research/helper\n"
        )
        plugin = next(
            item
            for item in self.capabilities.snapshot()["plugins"]
            if item["id"] == "research/helper"
        )
        self.assertTrue(plugin["available"])
        self.assertEqual(plugin["skill_ids"], ["research-helper:plan"])

    def test_machine_scope_skill_change_applies_without_restarting(self):
        current = self.capabilities.snapshot()
        disabled = self.capabilities.control(
            {
                "action": "set_global_enabled",
                "based_on_revision": current["revision"],
                "chat_id": current["chat_id"],
                "kind": "skill",
                "id": "focus",
                "enabled": False,
            }
        )
        focus = next(item for item in disabled["skills"] if item["id"] == "focus")
        self.assertFalse(focus["globally_enabled"])
        self.assertIn(
            "focus",
            yaml.safe_load((self.root / "hermes/config.yaml").read_text())["skills"]["disabled"],
        )
        enabled = self.capabilities.control(
            {
                "action": "set_global_enabled",
                "based_on_revision": disabled["revision"],
                "chat_id": disabled["chat_id"],
                "kind": "skill",
                "id": "focus",
                "enabled": True,
            }
        )
        focus = next(item for item in enabled["skills"] if item["id"] == "focus")
        self.assertTrue(focus["globally_enabled"])

    def test_machine_disabled_skill_cannot_be_added_to_a_chat(self):
        (self.root / "hermes/config.yaml").write_text(
            "plugins:\n  enabled:\n    - helper\nskills:\n  disabled:\n    - focus\n"
        )
        current = self.capabilities.snapshot()
        self.assertFalse(current["skills"][0]["available"])
        with self.assertRaises(CapabilityError) as unavailable:
            self.change("skill", "focus", True)
        self.assertEqual(unavailable.exception.status, 409)

    def test_unavailable_resource_cannot_be_enabled_for_a_chat(self):
        self.chat.connections.snapshot = lambda: {
            "revision": 2,
            "apps": [
                {
                    "id": "gmail",
                    "name": "Gmail",
                    "description": "Mail",
                    "enabled": False,
                    "state": "Off",
                }
            ],
            "mcps": [],
        }
        current = self.capabilities.snapshot()
        self.assertFalse(current["connectors"][0]["enabled"])
        with self.assertRaises(CapabilityError) as unavailable:
            self.change("connector", "gmail", True)
        self.assertEqual(unavailable.exception.status, 409)
