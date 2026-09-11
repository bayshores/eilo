"""Isolated interactive integration fixture. No real model, capture, or accounts."""

import argparse
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


class DemoChat(LocalChat):
    show_sample_activity = False

    def snapshot(self):
        snapshot = super().snapshot()
        return sample_activity(snapshot) if self.show_sample_activity else snapshot

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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8769)
    parser.add_argument(
        "--sample-activity", action="store_true", help="Show generated visual-review data"
    )
    args = parser.parse_args()
    (ROOT / ".tmp").mkdir(mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="adaptive-fixture-", dir=ROOT / ".tmp") as folder:
        chat = DemoChat(meta_path=Path(folder) / "local-chat.json")
        chat.show_sample_activity = args.sample_activity
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
        print(f"Synthetic integration fixture: http://127.0.0.1:{args.port}/home/", flush=True)
        app = create_app(chat, args.port)
        if args.sample_activity:
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
