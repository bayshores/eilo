"""Server task/publication transaction boundaries with mocked native receipts only."""

import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from app.chat_service import LocalChat
from app.errors import ChatError
from app.runtime_contract import visible_messages
from app.tasks import TaskConflict, TaskError, bind_model_proposal


def update_receipt(chat, request_id="request_task_001"):
    return {
        "session_id": "fixture_session",
        "request_id": request_id,
        "assistant_id": 2,
        "user_id": 1,
        "proposal": {
            "request_id": request_id,
            "based_on_revision": 0,
            "kind": "update",
            "reply": "Tentative.",
            "operations": [
                {
                    "op": "add",
                    "temp_id": "new_one",
                    "title": "Read notes",
                    "due_text": None,
                    "target_count": None,
                    "unit": None,
                }
            ],
        },
    }


class TransactionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(
            dir=Path(__file__).resolve().parents[1] / ".tmp"
        )
        self.path = Path(self.directory.name) / "pointer.json"
        self.chat = LocalChat(meta_path=self.path)
        self.chat.meta.update(
            session_id="fixture_session",
            pending=True,
            pending_turn={"request_id": "request_task_001", "based_on_revision": 0},
        )
        self.chat.command = self.command
        self.commands = []
        self.finalize_code, self.finalize_output = 0, None

    async def asyncTearDown(self):
        await self.chat.close()
        self.directory.cleanup()

    async def command(self, arguments, **kwargs):
        self.commands.append((arguments, kwargs))
        if arguments[0] == "--finalize":
            if self.finalize_output is not None:
                return self.finalize_code, self.finalize_output, ""
            publication = self.chat.meta["pending_publication"]
            return (
                self.finalize_code,
                json.dumps(
                    {
                        "session_id": publication["session_id"],
                        "request_id": publication["request_id"],
                        "assistant_id": publication["assistant_id"],
                        "published": True,
                    }
                ),
                "",
            )
        return 0, "", ""

    async def test_durable_stage_failure_never_changes_memory_or_publishes(self):
        before = deepcopy(self.chat.meta["tasks"])
        with patch("app.chat_service.write_private", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.chat.stage_publication(update_receipt(self.chat))
        self.assertEqual(self.chat.meta["tasks"], before)
        self.assertIsNone(self.chat.meta.get("pending_publication"))
        self.assertEqual(self.commands, [])

    async def test_commit_precedes_final_publication(self):
        self.chat.stage_publication(update_receipt(self.chat))
        self.assertEqual(self.chat.meta["tasks"]["tasks"][0]["title"], "Read notes")
        self.assertIsNotNone(self.chat.meta["pending_publication"])
        self.assertEqual(self.commands, [])

    async def test_failed_finalization_keeps_journal_and_blocks_new_send(self):
        self.chat.stage_publication(update_receipt(self.chat))
        self.finalize_code = 1
        with self.assertRaises(ChatError):
            await self.chat.publish_staged_reply()
        self.assertIsNotNone(self.chat.meta["pending_publication"])
        with self.assertRaises(ChatError):
            await self.chat.send("Another message", "request_task_002")

    async def test_recovery_stages_once_without_model_call_or_user_duplication(self):
        proposal = update_receipt(self.chat)["proposal"]
        raw = json.dumps({key: proposal[key] for key in ("kind", "reply", "operations")})
        self.chat.native_record = {
            "messages": [
                {
                    "id": 1,
                    "role": "user",
                    "content": "Read notes",
                    "display_metadata": {
                        "lane": "eilo_human",
                        "request_id": "request_task_001",
                        "based_on_revision": 0,
                    },
                },
                {
                    "id": 2,
                    "role": "assistant",
                    "content": raw,
                    "display_kind": "eilo_human_proposal",
                    "display_metadata": {"request_id": "request_task_001", "based_on_revision": 0},
                },
            ]
        }
        with patch.object(self.chat, "refresh", new=unittest.mock.AsyncMock()):
            await self.chat.recover_publication()
        self.assertEqual(
            [task["title"] for task in self.chat.meta["tasks"]["tasks"]], ["Read notes"]
        )
        self.assertEqual(len([call for call in self.commands if call[0][0] == "--input"]), 0)
        self.assertEqual(
            len([row for row in self.chat.native_record["messages"] if row["role"] == "user"]), 1
        )

    async def test_wrong_model_echo_does_not_replace_ordinary_chat_with_a_task_error(self):
        raw = json.dumps(
            {
                "request_id": "wrong-echo",
                "based_on_revision": 44,
                "kind": "chat",
                "reply": "Fair. That nudge missed.",
                "operations": [],
            }
        )
        receipt = update_receipt(self.chat)
        receipt["proposal"] = bind_model_proposal(raw, request_id="request_task_001", revision=0)
        before = deepcopy(self.chat.meta["tasks"])
        self.chat.stage_publication(receipt)
        self.assertEqual(
            self.chat.meta["pending_publication"]["public_reply"], "Fair. That nudge missed."
        )
        self.assertEqual(self.chat.meta["pending_publication"]["disposition"], "chat")
        self.assertEqual(self.chat.meta["tasks"], before)

    async def test_wrong_transport_identity_is_still_rejected(self):
        receipt = update_receipt(self.chat, request_id="another-request")
        before = deepcopy(self.chat.meta["tasks"])
        with self.assertRaises(ChatError):
            self.chat.stage_publication(receipt)
        self.assertEqual(self.chat.meta["tasks"], before)
        self.assertIsNone(self.chat.meta.get("pending_publication"))

    async def test_stale_task_revision_still_prevents_a_model_update(self):
        self.chat.meta["tasks"]["revision"] = 1
        before = deepcopy(self.chat.meta["tasks"])
        self.chat.stage_publication(update_receipt(self.chat))
        self.assertEqual(self.chat.meta["pending_publication"]["disposition"], "rejected")
        self.assertEqual(self.chat.meta["tasks"], before)

    async def test_recovery_requires_matching_native_revision_metadata(self):
        self.chat.native_record = {
            "messages": [
                {
                    "id": 1,
                    "role": "user",
                    "content": "hello",
                    "display_metadata": {
                        "lane": "eilo_human",
                        "request_id": "request_task_001",
                        "based_on_revision": 0,
                    },
                },
                {
                    "id": 2,
                    "role": "assistant",
                    "content": '{"kind":"chat","reply":"Hello","operations":[]}',
                    "display_kind": "eilo_human_proposal",
                    "display_metadata": {"request_id": "request_task_001", "based_on_revision": 99},
                },
            ]
        }
        with self.assertRaises(ChatError):
            await self.chat.recover_publication()
        self.assertIsNone(self.chat.meta.get("pending_publication"))
        self.assertEqual(self.commands, [])

    async def test_malformed_proposal_keeps_user_visible_but_hides_raw_and_changes_no_tasks(self):
        self.chat.native_record = {
            "messages": [
                {
                    "id": 1,
                    "role": "user",
                    "content": "Could you add this?",
                    "display_metadata": {"lane": "eilo_human", "request_id": "request_task_001"},
                },
                {
                    "id": 2,
                    "role": "assistant",
                    "content": "not JSON",
                    "display_kind": "eilo_human_proposal",
                    "display_metadata": {"request_id": "request_task_001"},
                },
            ]
        }
        self.chat.stage_publication(
            {
                "session_id": "fixture_session",
                "request_id": "request_task_001",
                "assistant_id": 2,
                "user_id": 1,
                "proposal": None,
            }
        )
        self.chat.messages = visible_messages(self.chat.native_record)
        self.assertEqual(self.chat.meta["tasks"]["tasks"], [])
        self.assertEqual(
            self.chat.messages, [{"id": "1", "role": "user", "text": "Could you add this?"}]
        )
        self.assertNotIn("not JSON", [message["text"] for message in self.chat.messages])
        self.assertEqual(self.chat.meta["pending_publication"]["disposition"], "rejected")
        self.assertNotIn("task controls", self.chat.meta["pending_publication"]["public_reply"])
        self.assertNotIn("clarify", self.chat.meta["pending_publication"]["public_reply"])

    async def test_direct_controls_use_task_validator(self):
        with self.assertRaises(TaskError):
            await self.chat.control_tasks(
                [
                    {
                        "op": "add",
                        "temp_id": "new_one",
                        "title": "Bad",
                        "due_text": None,
                        "target_count": True,
                        "unit": None,
                    }
                ],
                "request_control_001",
                0,
            )
        result = await self.chat.control_tasks(
            [
                {
                    "op": "add",
                    "temp_id": "new_one",
                    "title": "Control task",
                    "due_text": None,
                    "target_count": None,
                    "unit": None,
                }
            ],
            "request_control_002",
            0,
        )
        self.assertEqual(result["tasks"]["tasks"][0]["title"], "Control task")
        with self.assertRaises(TaskConflict):
            await self.chat.control_tasks([], "request_control_003", 0)
