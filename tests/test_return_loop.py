import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app.return_loop import ReturnLoop
from app.tasks import apply_operations, initial_tasks

TITLE = "eilo-ui-" + "b" * 32
ROOT = Path(__file__).resolve().parents[1]


def tasks():
    value, _ = apply_operations(
        initial_tasks(),
        [
            {
                "op": "add",
                "temp_id": "new_one",
                "title": "Finish the lab report",
                "due_text": "Friday",
                "due_on": "2026-09-25",
                "target_count": None,
                "unit": None,
            },
            {"op": "focus", "task_id": "new_one"},
        ],
        based_on_revision=0,
        request_id="fixture-goal",
        source={"kind": "human"},
        now=1,
        id_factory=lambda: "task-one",
    )
    return value


class SourceTurn:
    def __init__(self):
        self.valid_value = True
        self.closed = False

    def valid(self):
        return self.valid_value

    def capability(self):
        return {"url": "http://127.0.0.1:1024/read", "token": "a" * 43}

    async def close(self):
        self.closed = True


class Briefing:
    def __init__(self):
        self.turn = SourceTurn()
        self.calls = []

    async def open_return(self, delivery_id, on_invalidated=None):
        self.calls.append((delivery_id, on_invalidated))
        return self.turn


class Chat:
    def __init__(self, directory):
        self.meta_path = Path(directory) / "pointer.json"
        self.meta = {
            "title": TITLE,
            "session_id": "session-root",
            "pending": False,
            "pending_turn": None,
            "pending_publication": None,
            "tasks": tasks(),
            "accountability": {"human_epoch": 0},
        }
        self.lock = asyncio.Lock()
        self.native_lock = asyncio.Lock()
        self.busy = False
        self.blocked = False
        self.proactive = SimpleNamespace(state=self.meta["accountability"])
        self.briefing = Briefing()
        self.commands = []
        self.publications = []
        self.refreshed = 0
        self.changes = 0
        self.wait_for_command = None
        self.after_command = None

    def save_meta(self):
        self.meta_path.write_text(json.dumps(self.meta))

    def changed(self):
        self.changes += 1

    async def command(self, arguments, **kwargs):
        self.commands.append((arguments, kwargs))
        if self.wait_for_command is not None:
            self.wait_for_command.set()
            await self.command_release.wait()
        if self.after_command:
            self.after_command()
        payload = json.loads(await asyncio.to_thread(Path(arguments[1]).read_text))
        return (
            0,
            json.dumps(
                {
                    "session_id": payload["session_id"],
                    "delivery_id": payload["delivery_id"],
                    "decision": {
                        "delivery_id": payload["delivery_id"],
                        "decision": self.decision,
                        "message": self.message if self.decision == "deliver" else "",
                    },
                    "provenance": {
                        "version": 1,
                        "task_revision": payload["task_state"]["revision"],
                        "sources": [
                            {"source": "conversation", "status": "used"},
                            {"source": "goals", "status": "used"},
                        ],
                    },
                    "audit": {
                        "model": "gpt-5.6-luna",
                        "provider": "openai-codex",
                        "tool_schema_count": 5,
                        "persisted": False,
                    },
                }
            ),
            "",
        )

    def publish_return(self, publication, *, lookup=False):
        self.publications.append((publication, lookup))
        return {
            "delivery_id": publication["delivery_id"],
            "assistant_id": self.lookup_assistant_id if lookup else 42,
        }

    async def refresh(self):
        self.refreshed += 1


class ReturnLoopTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / ".tmp")
        self.chat = Chat(self.directory.name)
        self.chat.decision = "deliver"
        self.chat.message = "Your report is still open. What do you want to do first?"
        self.chat.lookup_assistant_id = 17
        self.loop = ReturnLoop(self.chat, now=lambda: 100, today=lambda: "2026-09-19")

    async def asyncTearDown(self):
        await self.loop.close()
        self.directory.cleanup()

    async def deliver(self, request_id="return-request-001", reason="daily", day="2026-09-19"):
        state = await self.loop.request(request_id, reason, day)
        await self.loop.task
        return state

    async def test_delivered_return_is_durable_and_uses_the_short_source_lane(self):
        state = await self.deliver()
        self.assertTrue(state["pending"])
        event = next(iter(self.loop.state["events"].values()))
        self.assertEqual(event["status"], "delivered")
        self.assertEqual(len(self.chat.publications), 1)
        self.assertEqual(self.chat.publications[0][0]["decision"]["decision"], "deliver")
        self.assertEqual(self.chat.commands[0][0][0], "--input")
        self.assertEqual(self.chat.commands[0][1]["launcher"], "hermes-return")
        self.assertTrue(self.chat.briefing.turn.closed)
        self.assertEqual(self.chat.refreshed, 1)

    async def test_same_reason_day_and_chat_is_deduplicated_even_with_a_new_request_id(self):
        await self.deliver()
        second = await self.loop.request("return-request-002", "daily", "2026-09-19")
        self.assertFalse(second["pending"])
        self.assertEqual(len(self.chat.commands), 1)
        self.assertEqual(len(self.loop.state["events"]), 1)

    async def test_daily_and_long_absence_are_distinct_once_each(self):
        await self.deliver()
        await self.deliver("return-request-002", "absence")
        self.assertEqual(len(self.chat.commands), 2)
        self.assertEqual(
            {event["reason"] for event in self.loop.state["events"].values()}, {"daily", "absence"}
        )

    async def test_draft_or_invalid_request_starts_no_automatic_work(self):
        state = await self.loop.request(
            "return-request-003", "daily", "2026-09-19", draft_present=True
        )
        self.assertFalse(state["pending"])
        self.assertEqual(self.loop.state["events"], {})
        await self.loop.request("return-request-004", "daily", "not-a-day")
        await self.loop.request("return-request-004", "daily", "2026-09-20")
        self.assertEqual(self.loop.state["events"], {})

    async def test_only_one_return_inference_can_run_at_a_time(self):
        self.chat.wait_for_command = asyncio.Event()
        self.chat.command_release = asyncio.Event()
        await self.loop.request("return-request-005", "daily", "2026-09-19")
        await asyncio.wait_for(self.chat.wait_for_command.wait(), 1)
        duplicate = await self.loop.request("return-request-006", "absence", "2026-09-19")
        self.assertTrue(duplicate["pending"])
        self.assertEqual(len(self.loop.state["events"]), 1)
        self.chat.command_release.set()
        await self.loop.wait_for_preempted_event()

    async def test_active_onboarding_never_starts_an_automatic_return(self):
        self.chat.meta["onboarding"] = {"status": "draft"}
        state = await self.loop.request("return-request-007", "daily", "2026-09-19")
        self.assertFalse(state["pending"])
        self.assertEqual(self.loop.state["events"], {})

    async def test_return_can_catch_up_without_an_open_goal_but_never_during_a_break(self):
        self.chat.meta["tasks"]["tasks"] = []
        self.chat.meta["tasks"]["focus_id"] = None
        await self.deliver("return-request-007")
        self.assertEqual(len(self.chat.commands), 1)
        self.assertEqual(next(iter(self.loop.state["events"].values()))["status"], "delivered")

        blocked = Chat(self.directory.name)
        blocked.meta["tasks"]["break_active"] = True
        loop = ReturnLoop(blocked, now=lambda: 200, today=lambda: "2026-09-19")
        state = await loop.request("return-request-008", "daily", "2026-09-19")
        self.assertFalse(state["pending"])
        self.assertEqual(loop.state["events"], {})
        await loop.close()

    async def test_human_input_cancels_prepublication_work_without_a_native_append(self):
        self.chat.wait_for_command = asyncio.Event()
        self.chat.command_release = asyncio.Event()
        await self.loop.request("return-request-005", "daily", "2026-09-19")
        await asyncio.wait_for(self.chat.wait_for_command.wait(), 1)
        self.chat.proactive.state["human_epoch"] += 1
        self.loop.on_human("I am back", "human-request-001")
        await self.loop.wait_for_preempted_event()
        event = next(iter(self.loop.state["events"].values()))
        self.assertEqual(event["status"], "stale")
        self.assertEqual(self.chat.publications, [])

    async def test_local_day_rollover_prevents_a_stale_catch_up_from_publishing(self):
        self.chat.after_command = lambda: setattr(self.loop, "today", lambda: "2026-09-20")
        await self.deliver("return-request-009")
        event = next(iter(self.loop.state["events"].values()))
        self.assertEqual(event["status"], "stale")
        self.assertEqual(self.chat.publications, [])

    async def test_goal_change_or_source_revocation_prevents_delivery_after_inference(self):
        def change_goal():
            self.chat.meta["tasks"]["revision"] += 1

        self.chat.after_command = change_goal
        await self.deliver()
        event = next(iter(self.loop.state["events"].values()))
        self.assertEqual(event["status"], "stale")
        self.assertEqual(self.chat.publications, [])

        self.loop = ReturnLoop(self.chat, now=lambda: 200, today=lambda: "2026-09-19")
        self.chat.after_command = lambda: setattr(self.chat.briefing.turn, "valid_value", False)
        await self.deliver("return-request-006", reason="absence")
        latest = sorted(self.loop.state["events"].values(), key=lambda item: item["created_at"])[-1]
        self.assertEqual(latest["status"], "stale")
        self.assertEqual(self.chat.publications, [])

    async def test_quiet_never_appends_or_notifies(self):
        self.chat.decision = "quiet"
        await self.deliver()
        event = next(iter(self.loop.state["events"].values()))
        self.assertEqual(event["status"], "quiet")
        self.assertEqual(self.chat.publications, [])

    async def test_recovery_only_looks_up_an_existing_publication(self):
        publication = {
            "delivery_id": "return-" + "c" * 32,
            "return_key": "return-key-recover",
            "reason": "daily",
            "local_day": "2026-09-19",
            "task_revision": self.chat.meta["tasks"]["revision"],
            "human_epoch": 0,
        }
        self.loop.state["events"][publication["delivery_id"]] = {
            **publication,
            "status": "publishing",
            "publication": publication,
            "created_at": 20,
        }
        await self.loop.recover_publications()
        event = self.loop.state["events"][publication["delivery_id"]]
        self.assertEqual(event["status"], "delivered")
        self.assertTrue(event["recovered"])
        self.assertTrue(self.chat.publications[-1][1])
        self.assertEqual(self.chat.refreshed, 1)


if __name__ == "__main__":
    unittest.main()
