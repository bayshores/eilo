import unittest
from copy import deepcopy

from app.chat_catalog import (
    CatalogError,
    apply_catalog,
    ensure_catalog,
    import_sessions,
    snapshot_catalog,
)


def legacy_meta():
    return {
        "title": "eilo-ui-" + "a" * 32,
        "session_id": "native-1",
        "started": True,
        "accepted_requests": ["request-1"],
        "pending": False,
        "goals": [{"id": "goal-1"}],
        "tasks": {"revision": 4},
        "activity": {"enabled": False},
        "source_settings": {"mail": False},
    }


def action(meta, **body):
    return apply_catalog(meta, {"based_on_revision": snapshot_catalog(meta)["revision"], **body})


class ChatCatalogTests(unittest.TestCase):
    def test_migration_preserves_global_state_and_native_pointer(self):
        original = legacy_meta()
        migrated = ensure_catalog(original)
        chat = snapshot_catalog(migrated)["chats"][0]
        self.assertIsNone(original.get("chat_catalog"))
        self.assertEqual(migrated["goals"], original["goals"])
        self.assertEqual(migrated["tasks"], original["tasks"])
        self.assertEqual(chat["session_id"], "native-1")
        self.assertEqual(
            migrated["chat_catalog"]["chats"][0]["conversation"]["title"], original["title"]
        )
        self.assertNotIn("accepted_requests", chat)
        self.assertEqual(chat["name"], "Personal conversation")

    def test_switch_back_restores_native_conversation_without_changing_goals(self):
        state = ensure_catalog(legacy_meta())
        goals = deepcopy(state["goals"])
        first = snapshot_catalog(state)["active_chat_id"]
        state = action(state, action="new_chat", name="Second")
        second = snapshot_catalog(state)["active_chat_id"]
        state["accepted_requests"] = ["new-request"]
        state["session_id"] = "native-2"
        state = action(state, action="switch_chat", chat_id=first)
        self.assertEqual(
            (state["session_id"], state["accepted_requests"]), ("native-1", ["request-1"])
        )
        state = action(state, action="switch_chat", chat_id=second)
        self.assertEqual(
            (state["session_id"], state["accepted_requests"]), ("native-2", ["new-request"])
        )
        self.assertEqual(state["goals"], goals)

    def test_stale_revision_and_noop_control(self):
        state = ensure_catalog(legacy_meta())
        revision = snapshot_catalog(state)["revision"]
        state = apply_catalog(state, {"action": "new_chat", "based_on_revision": revision})
        with self.assertRaises(CatalogError) as error:
            apply_catalog(state, {"action": "new_chat", "based_on_revision": revision})
        self.assertEqual(error.exception.status, 409)
        active = snapshot_catalog(state)["active_chat_id"]
        self.assertEqual(
            snapshot_catalog(action(state, action="pin_chat", chat_id=active, pinned=False))[
                "revision"
            ],
            snapshot_catalog(state)["revision"],
        )

    def test_archive_guards_and_invalid_controls(self):
        state = action(ensure_catalog(legacy_meta()), action="create_project", name="School")
        project_id = snapshot_catalog(state)["projects"][0]["id"]
        state = action(state, action="archive_project", project_id=project_id, archived=True)
        active = snapshot_catalog(state)["active_chat_id"]
        with self.assertRaises(CatalogError):
            action(state, action="archive_chat", chat_id=active, archived=True)
        with self.assertRaises(CatalogError):
            action(state, action="move_chat", chat_id=active, project_id=project_id)
        for body in (
            {"action": "new_chat", "name": "bad\nname"},
            {"action": "new_chat", "unexpected": True},
            {"action": "rename_chat", "chat_id": "bad id", "name": "Fine"},
            {"action": "create_project", "name": ""},
        ):
            with self.subTest(body=body):
                with self.assertRaises(CatalogError) as error:
                    apply_catalog(ensure_catalog(legacy_meta()), {"based_on_revision": 0, **body})
                self.assertEqual(error.exception.status, 400)

    def test_project_names_new_chat_defaults_and_validation(self):
        state = action(ensure_catalog(legacy_meta()), action="create_project", name="Coursework")
        with self.assertRaises(CatalogError):
            action(state, action="create_project", name="coursework")
        state = action(state, action="new_chat")
        self.assertIsNone(state["session_id"])
        self.assertRegex(state["title"], r"^eilo-ui-[0-9a-f]{32}$")
        self.assertFalse(state["started"])
        self.assertFalse(state["pending"])
        self.assertEqual(state["accepted_requests"], [])
        for key in ("pending_message", "pending_turn", "pending_publication", "workflow_run"):
            self.assertIsNone(state[key])
        state = ensure_catalog(legacy_meta())
        before = state["chat_catalog"]["chats"][0]["updated_at"]
        snapshot_catalog(state)
        self.assertEqual(ensure_catalog(state)["chat_catalog"]["chats"][0]["updated_at"], before)
        state["chat_catalog"]["revision"] = True
        with self.assertRaises(CatalogError):
            ensure_catalog(state)

    def test_session_import_is_compact_idempotent_and_has_no_task_history(self):
        state = ensure_catalog(legacy_meta())
        active = snapshot_catalog(state)["active_chat_id"]
        row = {
            "id": "native-older",
            "title": "eilo-ui-" + "b" * 32,
            "created_at": "2026-09-01T12:00:00Z",
            "updated_at": "2026-09-02T12:00:00Z",
            "message_count": 4,
        }
        imported = import_sessions(state, [row])
        self.assertEqual(snapshot_catalog(imported)["active_chat_id"], active)
        history = next(
            c
            for c in imported["chat_catalog"]["chats"]
            if c["conversation"]["session_id"] == "native-older"
        )
        self.assertEqual(history["name"], "Earlier conversation")
        self.assertEqual(history["conversation"]["accepted_requests"], [])
        self.assertNotIn("goals", history)
        self.assertNotIn("tasks", history)
        self.assertEqual(
            snapshot_catalog(import_sessions(imported, [row]))["revision"],
            snapshot_catalog(imported)["revision"],
        )
        named = import_sessions(imported, [{**row, "name": "A saved project discussion"}])
        restored = next(
            c
            for c in named["chat_catalog"]["chats"]
            if c["conversation"]["session_id"] == "native-older"
        )
        self.assertEqual(restored["name"], "A saved project discussion")
        renamed = action(
            named, action="rename_chat", chat_id=restored["id"], name="My custom title"
        )
        reimported = import_sessions(renamed, [{**row, "name": "A changed preview"}])
        self.assertEqual(
            next(c for c in reimported["chat_catalog"]["chats"] if c["id"] == restored["id"])[
                "name"
            ],
            "My custom title",
        )


if __name__ == "__main__":
    unittest.main()
