"""Isolated interactive integration fixture. No real model, capture, or accounts."""

import argparse
import asyncio
import re
import sys
import tempfile
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aiohttp import web
from cryptography.fernet import Fernet

from app.chat_service import LocalChat
from app.context_capture import ContextCapture
from app.context_service import ContextService
from app.http_api.application import create_app
from app.onboarding import active_onboarding
from app.paths import ROOT
from app.runtime_contract import MODEL, PROVIDER


async def sample_analysis(request):
    title = request["evidence"][0]["text"][:90].rstrip(".")
    return {
        "request_id": request["request_id"],
        "policy_epoch": request["policy_epoch"],
        "audit": {"model": MODEL, "provider": PROVIDER, "tool_schema_count": 0, "persisted": False},
        "proposal": {
            "title": title,
            "summary": "A synthetic context for interaction testing.",
            "return_point": "Revisit the opening paragraph.",
            "confidence": "explicit",
            "evidence_ids": [request["evidence"][0]["id"]],
            "task_ids": [],
            "components": [
                {
                    "id": "resume",
                    "kind": "resume",
                    "title": "Where you left it",
                    "emphasis": "primary",
                    "text": "The opening paragraph is ready to revisit.",
                },
                {
                    "id": "note",
                    "kind": "note",
                    "title": "Your notes",
                    "emphasis": "normal",
                    "text": "",
                },
                {
                    "id": "outline",
                    "kind": "outline",
                    "title": "Shape of the draft",
                    "emphasis": "quiet",
                    "items": ["The idea", "Supporting examples", "The next question"],
                },
            ],
        },
    }


def sample_activity(snapshot):
    """Presentation fixture only; generated records never enter the real collector/store."""
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    amounts = [1800, 2400, 0, 4500, 5400, 3900, 6600]
    usage = {
        "timezone": "UTC",
        "scope": "retained_sessions",
        "total_observed_seconds": sum(amounts),
        "days": [
            {
                "date": (today - timedelta(days=6 - index)).date().isoformat(),
                "observed_seconds": seconds,
            }
            for index, seconds in enumerate(amounts)
        ],
        "sites": [
            {"origin": "https://docs.google.com", "observed_seconds": 10200},
            {"origin": "https://figma.com", "observed_seconds": 7800},
            {"origin": "https://github.com", "observed_seconds": 4200},
            {"origin": "https://notion.so", "observed_seconds": 2400},
        ],
    }
    scenarios = [
        ("outline", "Shape the project story", "desktop", "Pages", "", 8.5, 9.4, 1800),
        (
            "sources",
            "Gather references",
            "browser",
            "Chrome",
            "https://docs.google.com",
            9.3,
            10.2,
            2000,
        ),
        ("draft", "Write the opening", "desktop", "Pages", "", 10.4, 11.8, 3000),
        ("design", "Explore visual directions", "desktop", "Figma", "", 12.5, 14.1, 4200),
        (
            "compare",
            "Compare the options",
            "browser",
            "Chrome",
            "https://figma.com",
            14.3,
            15.5,
            3000,
        ),
        ("review", "Review changes", "browser", "Chrome", "https://github.com", 16.0, 17.0, 1600),
    ]
    episodes = []
    for days_ago in range(7):
        day = today - timedelta(days=days_ago)
        browser_amount = amounts[6 - days_ago]
        for ident, title, source, app, origin, start, end, seconds in scenarios:
            if source == "browser":
                if browser_amount == 0:
                    continue
                seconds = seconds * browser_amount / 6600
            episodes.append(
                {
                    "id": f"sample-{days_ago}-{ident}",
                    "title": title,
                    "source_id": source,
                    "app_name": app,
                    "origin": origin,
                    "started_at": day.timestamp() + start * 3600,
                    "ended_at": day.timestamp() + end * 3600,
                    "duration_seconds": seconds,
                }
            )
    snapshot["adaptive"]["episodes"] = episodes
    snapshot["adaptive"]["usage"]["browser"] = usage
    snapshot["adaptive"]["policy"]["browser_enabled"] = True
    snapshot["adaptive"]["capture_status"] = {
        "desktop": {"enabled": True, "status": "permission_required"},
        "browser": {"enabled": True, "status": "ready"},
    }
    snapshot["adaptive"]["current_work_context"] = {
        "id": "sample-project",
        "episode_ids": ["sample-0-draft"],
        "return_point": "The opening is drafted. Choose the example that explains the idea best.",
    }
    snapshot["integrations"]["google_calendar"] = {"state": "connected", "selected_ids": ["sample"]}
    snapshot["integrations"]["briefing_sources"] = {
        "calendar": {"available": True, "enabled": False, "selected_count": 1},
        "accounts": [{"enabled": True, "state": "connected"}],
    }
    return snapshot


def sample_records(snapshot):
    """Presentation-only legacy records; this does not enable activity collection."""
    now = datetime.now(UTC).timestamp()
    day = datetime.fromtimestamp(now, UTC).date()
    snapshot["accountability"]["observed_activity"] = {
        "timezone": "UTC",
        "revision": 1,
        "recent_sessions": [
            {
                "id": "sample-legacy-reading",
                "origin": "https://leetcode.com",
                "start": now - 4_200,
                "end": now - 3_000,
                "last_seen": now - 3_000,
                "sample_count": 12,
                "observed_seconds": 720,
            }
        ],
        "trash_sessions": [
            {
                "id": "sample-legacy-trashed",
                "origin": "https://developer.mozilla.org",
                "start": now - 9_000,
                "end": now - 7_800,
                "last_seen": now - 7_800,
                "sample_count": 10,
                "observed_seconds": 600,
            }
        ],
        "active_session": None,
        "today_observed_seconds_by_origin": {},
        "usage": {
            "timezone": "UTC",
            "scope": "retained_sessions",
            "days": [
                {
                    "date": (day - timedelta(days=offset)).isoformat(),
                    "observed_seconds": 0,
                }
                for offset in range(6, -1, -1)
            ],
            "sites": [],
            "total_observed_seconds": 0,
        },
    }
    sample_message = {
        "id": "sample-check-in",
        "role": "assistant",
        "text": "Want to take a quick look at the next step?",
        "origin": "check_in",
        "event_id": "sample-check-in-event",
    }
    snapshot["messages"] = [
        *(message for message in snapshot["messages"] if message.get("id") != sample_message["id"]),
        sample_message,
    ]
    check_ins = snapshot["accountability"]["check_ins"]
    snapshot["accountability"]["check_ins"] = {
        **check_ins,
        "history": [
            {
                "outcome": "delivered",
                "created_at": now - 900,
                "finished_at": now - 880,
            },
            {
                "outcome": "quiet",
                "created_at": now - 3_600,
                "finished_at": now - 3_580,
            },
        ],
    }
    return snapshot


def sample_checkin(snapshot, phase):
    """Presentation fixture only; this does not alter check-in policy or transport."""
    snapshot["accountability"]["check_ins"] = {
        "version": 1,
        "enabled": phase != "off",
        "phase": phase,
        "eligible_at": None,
        "evaluated_at": datetime.now(UTC).timestamp(),
        "last_observation": None,
        "rules": {},
        "history": [],
        "notification_event_ids": [],
    }
    return snapshot


class DemoChat(LocalChat):
    show_sample_activity = False
    show_sample_records = False
    checkin_phase = None
    chat_context_fixture = None

    def snapshot(self):
        snapshot = super().snapshot()
        if self.chat_context_fixture:
            snapshot["chat_context"] = dict(self.chat_context_fixture)
        if self.show_sample_activity:
            snapshot = sample_activity(snapshot)
        if self.checkin_phase:
            snapshot = sample_checkin(snapshot, self.checkin_phase)
        return sample_records(snapshot) if self.show_sample_records else snapshot

    async def compress_context(self, body):
        if not self.chat_context_fixture:
            return await super().compress_context(body)
        self.chat_context_fixture["status"] = "compressing"
        self.chat_context_fixture["can_compress"] = False
        self.changed()

        async def finish():
            await asyncio.sleep(1)
            self.chat_context_fixture.update(
                status="compressed",
                used_tokens=14000,
                remaining_tokens=258000,
                percent_used=5.1,
                can_compress=True,
            )
            self.changed()

        self.task = asyncio.create_task(finish())
        return self.snapshot()

    async def initialize(self):
        self.changed()

    async def send(self, text, request_id, **_kwargs):
        self.messages.extend(
            [
                {"id": uuid.uuid4().hex, "role": "user", "text": text},
                {
                    "id": uuid.uuid4().hex,
                    "role": "assistant",
                    "text": "Sample context updated. This preview uses no AI or tracking.",
                },
            ]
        )
        self.meta["accepted_requests"].append(request_id)
        self.context.on_human(text)
        self.context.resume_after_human()
        if self.context.job:
            await self.context.job
        self.changed()
        return self.snapshot()


@web.middleware
async def sample_notice(request, handler):
    response = await handler(request)
    if isinstance(response, web.Response) and response.content_type == "text/html":
        response.text = response.text.replace(
            "<body>",
            '<body class="activity-preview"><aside class="activity-preview-notice">'
            "Sample data · This preview does not track your activity.</aside>",
            1,
        )
    return response


class OnboardingDemoChat(DemoChat):
    """Explicit UI-test fixture; the production human driver never uses this parser."""

    async def send(self, text, request_id, **_kwargs):
        if request_id in self.meta["accepted_requests"]:
            return self.snapshot()
        setup = self.meta.get("onboarding")
        operations = []
        reply = "What is one thing you would like to move forward?"
        if active_onboarding(setup):
            existing = [task for task in setup["draft_tasks"]["tasks"] if task["status"] == "open"]
            if "not sure" not in text.lower():
                if existing and "note" in text.lower():
                    widgets = [item for item in setup["widgets"] if item != "notes"]
                    if "remove" not in text.lower():
                        widgets = (widgets + ["notes"])[:3]
                    operations = [
                        {
                            "op": "workspace",
                            "widgets": widgets,
                            "support_source": setup["support_source"],
                        }
                    ]
                else:
                    count = re.search(r"\b(\d+)\s+(?:leetcode\s+)?problems?\b", text, re.I)
                    due = re.search(
                        r"\b(?:in|within) (?:\d+|one|two|three) months?\b|this month", text, re.I
                    )
                    fields = {
                        "title": text.strip()[:500],
                        "due_text": due.group(0) if due else None,
                        "target_count": int(count.group(1)) if count else None,
                        "unit": "problems" if count else None,
                    }
                    operation = (
                        {"op": "edit", "task_id": existing[0]["id"]}
                        if existing
                        else {"op": "add", "temp_id": "new_goal"}
                    )
                    operations = [
                        {**operation, **fields},
                        {
                            "op": "workspace",
                            "widgets": ["goals", "progress"] if count else ["goals"],
                            "support_source": "browser" if count else "desktop",
                        },
                    ]
            self.meta["session_id"] = "onboarding_fixture"
            self.meta["pending_turn"] = {
                "request_id": request_id,
                "based_on_revision": setup["draft_tasks"]["revision"],
                "onboarding_revision": setup["revision"],
            }
            self.stage_publication(
                {
                    "request_id": request_id,
                    "session_id": self.meta["session_id"],
                    "user_id": len(self.messages) + 1,
                    "assistant_id": len(self.messages) + 2,
                    "proposal": {
                        "request_id": request_id,
                        "based_on_revision": setup["draft_tasks"]["revision"],
                        "kind": "update" if operations else "clarify",
                        "reply": "" if operations else reply,
                        "operations": operations,
                    },
                }
            )
            reply = self.meta["pending_publication"]["public_reply"]
            self.meta.update(pending_turn=None, pending_publication=None, started=True)
        else:
            reply = (
                "This is a synthetic conversation for UI testing. Your approved workspace is kept."
            )
        self.messages.extend(
            [
                {"id": uuid.uuid4().hex, "role": "user", "text": text},
                {"id": uuid.uuid4().hex, "role": "assistant", "text": reply},
            ]
        )
        self.meta["accepted_requests"] = (self.meta["accepted_requests"] + [request_id])[-100:]
        self.save_meta()
        self.changed()
        return self.snapshot()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8769)
    parser.add_argument(
        "--chat-context", action="store_true", help="Exercise synthetic chat context controls"
    )
    parser.add_argument(
        "--sample-activity", action="store_true", help="Show generated visual-review data"
    )
    parser.add_argument(
        "--sample-records",
        action="store_true",
        help="Show generated legacy activity and check-in records",
    )
    parser.add_argument(
        "--onboarding", action="store_true", help="Exercise first setup with a synthetic model"
    )
    parser.add_argument(
        "--checkin-phase",
        choices=(
            "off",
            "no_conversation",
            "no_goals",
            "awaiting_observation",
            "eligible",
            "unavailable",
        ),
        help="Show a synthetic check-in status for visual review",
    )
    parser.add_argument(
        "--fail-checkin-toggle",
        action="store_true",
        help="Reject synthetic check-in toggle requests for visual review",
    )
    args = parser.parse_args()
    (ROOT / ".tmp").mkdir(mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="adaptive-fixture-", dir=ROOT / ".tmp") as folder:
        chat_class = OnboardingDemoChat if args.onboarding else DemoChat
        chat = chat_class(meta_path=Path(folder) / "local-chat.json")
        if args.onboarding:
            chat.account.state = {"revision": 0, "state": "connected"}
        else:
            chat.meta.pop("onboarding", None)
        chat.save_meta()
        chat.show_sample_activity = args.sample_activity
        chat.show_sample_records = args.sample_records
        chat.checkin_phase = args.checkin_phase
        if args.chat_context:
            chat.chat_context_fixture = {
                "window_tokens": 272000,
                "used_tokens": 178000,
                "remaining_tokens": 94000,
                "percent_used": 65.4,
                "measurement": "estimate",
                "threshold_tokens": 204000,
                "compression_enabled": True,
                "can_compress": True,
                "status": "idle",
                "usage": {"input_tokens": 845000, "output_tokens": 22000},
            }
        key = Fernet.generate_key()
        chat.context = ContextService(
            Path(folder) / "context",
            get_tasks=lambda: [],
            changed=chat.changed,
            analyze=sample_analysis,
            key_provider=lambda **_: key,
        )
        chat.context_capture = ContextCapture(
            Path(folder) / "context", chat.context, ROOT / ".tmp/absent-fixture-helper"
        )
        if args.fail_checkin_toggle:
            control = chat.proactive.control

            def reject_checkin_toggle(action, client_id):
                if action in {"enable_check_ins", "pause_check_ins"}:
                    raise ValueError("Synthetic fixture rejected the check-in change.")
                return control(action, client_id)

            chat.proactive.control = reject_checkin_toggle
        print(f"Synthetic integration fixture: http://127.0.0.1:{args.port}/home/", flush=True)
        app = create_app(chat, args.port)
        if (
            args.chat_context
            or args.sample_activity
            or args.sample_records
            or args.onboarding
            or args.checkin_phase
            or args.fail_checkin_toggle
        ):
            app.middlewares.append(sample_notice)
        web.run_app(
            app,
            host="127.0.0.1",
            port=args.port,
            access_log=None,
            print=None,
        )


if __name__ == "__main__":
    main()
