"""Open-page consent lease and one serialized, cancellable native event lane."""
from __future__ import annotations

import asyncio
import contextlib
import json
from pathlib import Path
import time
import uuid

from app.accountability import (LEASE_SECONDS, SAMPLE_SECONDS, admit, fingerprint,
                                initial_state, record_human, sanitize_observation,
                                validate_decision)
from app.tasks import has_open_work, public_state


class ProactiveLoop:
    def __init__(self, chat, *, helper: Path, now=time.time):
        self.chat = chat
        self.helper = helper
        self.now = now
        self.state = chat.meta.setdefault("accountability", initial_state())
        self.client_id = None
        self.lease_until = 0
        self.lease_timer = None
        self.mode = "off"
        self.reason = "Activity is off."
        self.sample_request = None
        self.preview = {"kind": "activity_unshared"}
        self.latest = None
        self.stable_since = 0
        self.foreground_at = 0
        self.chrome_available = False
        self.collector = None
        self.event_task = None
        self.event_id = None

    def active(self):
        return self.mode == "active" and self.client_id is not None and self.now() < self.lease_until

    def snapshot(self):
        tasks = self.chat.meta["tasks"]
        open_tasks = [task for task in tasks["tasks"] if task["status"] == "open"]
        focused = next((task for task in open_tasks if task["id"] == tasks["focus_id"]), None)
        legacy_task = focused or (open_tasks[0] if open_tasks else None)
        legacy_goal = {"text": legacy_task["title"] if legacy_task else "",
                       "status": "break" if tasks["break_active"] else "active" if legacy_task else "none",
                       "version": tasks["revision"]}
        return {"goal": legacy_goal, "tasks": public_state(tasks),
                "deciding": bool(self.event_task and not self.event_task.done()),
                "activity": {"state": self.mode if self.active() or self.mode != "active" else "paused",
                             "reason": self.reason, "allowed_hosts": self.state["allowed_hosts"],
                             "helper_available": self.helper.is_file(), "chrome_available": self.chrome_available,
                             "consent_owner": self.active(), "lease_client_id": self.client_id if self.active() else None,
                             "sample_request": self.sample_request if self.active() else None,
                             "preview": self.preview if self.active() else {"kind": "activity_unshared"}}}

    def persist(self):
        self.chat.save_meta()

    def invalidate(self):
        if self.event_task and not self.event_task.done():
            if self.event_id:
                self.state["events"][self.event_id]["status"] = "stale"
            self.event_task.cancel()

    def on_human(self, text, request_id):
        record_human(self.state, text, request_id, self.now())
        self.invalidate()

    def control(self, action, client_id):
        if action == "enable":
            if not self.helper.is_file():
                raise ValueError("The local foreground helper is not built yet. Conversation and goal controls still work.")
            if self.active() and client_id != self.client_id:
                raise ValueError("Another open page owns activity collection. Pause it before enabling this page.")
            self.invalidate()
            self.client_id, self.lease_until = client_id, self.now() + LEASE_SECONDS
            self.mode, self.reason = "active", "Enabled for this open page; Chrome context requires the extension and selected site grants."
            self.arm_lease_timer()
            self.latest, self.stable_since, self.sample_request = None, 0, None
            self.chrome_available = False
            if not self.collector or self.collector.done():
                self.collector = asyncio.create_task(self.collect(), name="consented-open-page-activity")
        elif action in ("pause", "off"):
            # Any local page can make the stop effective; only the owner may extend consent.
            self.stop("paused" if action == "pause" else "off", "Activity is paused." if action == "pause" else "Activity is off.")
        else:
            raise ValueError("Choose enable, pause or off.")
        self.chat.changed()

    def renew(self, client_id):
        if not self.active() or client_id != self.client_id:
            raise ValueError("Activity lease ended. Enable it explicitly in this page to start again.")
        self.lease_until = self.now() + LEASE_SECONDS
        self.arm_lease_timer()

    def arm_lease_timer(self):
        if self.lease_timer:
            self.lease_timer.cancel()
        def expire():
            if self.mode != "active":
                return
            if self.now() < self.lease_until:
                self.arm_lease_timer()
                return
            self.stop("paused", "The open-page lease expired. Activity stopped; enable it explicitly to resume.")
            self.chat.changed()
        self.lease_timer = asyncio.get_running_loop().call_later(max(0, self.lease_until - self.now()), expire)

    def stop(self, mode="off", reason="Activity is off."):
        if self.lease_timer:
            self.lease_timer.cancel()
            self.lease_timer = None
        self.mode, self.reason = mode, reason
        self.client_id, self.lease_until = None, 0
        self.sample_request, self.latest = None, None
        self.preview = {"kind": "activity_unshared"}
        self.chrome_available = False
        self.invalidate()
        if self.collector and not self.collector.done() and self.collector is not asyncio.current_task():
            self.collector.cancel()
        self.persist()

    async def foreground_is_chrome(self):
        try:
            code, out, _ = await self.chat.command(["--sample"], executable=self.helper, timeout=3)
            value = json.loads(out) if code == 0 else {}
            # No raw app name/bundle is retained or sent to a model for unshared activity.
            if not isinstance(value, dict) or value.get("kind") not in ("foreground_app", "activity_unknown"):
                return None
            return value.get("bundle_id") == "com.google.Chrome"
        except (OSError, ValueError, asyncio.TimeoutError):
            return None

    async def collect(self):
        last_sample = 0
        try:
            while self.active():
                now = self.now()
                if self.sample_request and now * 1000 > self.sample_request["expires_at"]:
                    self.sample_request = None
                    self.reason = "Chrome context is unavailable or unshared. No relevance conclusion is drawn."
                    self.chrome_available = False
                    self.update_context({"kind": "activity_unshared"}, now)
                    self.chat.changed()
                if now - last_sample >= SAMPLE_SECONDS:
                    last_sample = now
                    is_chrome = await self.foreground_is_chrome()
                    if not self.active():
                        break
                    if is_chrome is True:
                        self.foreground_at = self.now()
                        self.sample_request = {"nonce": uuid.uuid4().hex, "client_id": self.client_id,
                                               "expires_at": int(min(self.now() + 3, self.lease_until) * 1000)}
                    elif is_chrome is False:
                        self.sample_request = None
                        self.update_context({"kind": "activity_unshared"}, self.now())
                    else:
                        self.sample_request = None
                        self.latest = None
                        self.preview = {"kind": "activity_unknown"}
                        self.reason = "The foreground sample is unavailable. No background decision was made."
                        self.invalidate()
                    self.chat.changed()
                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            raise
        finally:
            if self.mode == "active" and not self.active():
                self.stop("paused", "The open-page lease expired. Activity stopped; enable it explicitly to resume.")
                self.chat.changed()

    async def observe(self, client_id, nonce, raw):
        request = self.sample_request
        if (not self.active() or client_id != self.client_id or not request or nonce != request["nonce"]
                or self.now() * 1000 > request["expires_at"]):
            raise ValueError("This activity sample is stale or its page lease has ended.")
        self.sample_request = None
        chrome = await self.foreground_is_chrome()
        if chrome is not True or not self.active():
            if self.active() and chrome is False:
                self.update_context({"kind": "activity_unshared"}, self.now())
            else:
                self.preview = {"kind": "activity_unknown"}
                self.latest = None
                self.invalidate()
            self.chat.changed()
            return
        observation = sanitize_observation(raw, self.state["allowed_hosts"])
        self.update_context(observation, self.now())
        self.chat.changed()

    def update_context(self, observation, now):
        if observation.get("kind") == "activity_invalid":
            self.latest = None
            self.preview = {"kind": "activity_unshared"}
            self.reason = "An invalid activity sample was discarded. No background decision was made."
            self.invalidate()
            return
        if not self.latest or fingerprint(self.latest) != fingerprint(observation):
            self.stable_since = now
            self.invalidate()
        self.latest = observation
        self.preview = observation
        self.chrome_available = observation["kind"] == "approved_study_context"
        self.reason = "Only this approved sample is eligible for context." if self.chrome_available else "Activity details are unshared. A limited goal/progress question may use this coarse signal; it is not evidence of distraction."
        self.maybe_decide(now)

    def maybe_decide(self, now=None):
        now = self.now() if now is None else now
        if not self.latest or not self.chat.meta.get("session_id") or self.chat.blocked:
            return
        if self.event_task and not self.event_task.done():
            return
        allowed, _ = admit(self.state, self.latest, now=now, stable_since=self.stable_since,
                           lease_active=self.active(), human_busy=self.chat.busy,
                           has_open_work=has_open_work(self.chat.meta["tasks"]))
        if not allowed:
            return
        event_id = uuid.uuid4().hex
        event = {"status": "running", "task_revision": self.chat.meta["tasks"]["revision"],
                 "human_epoch": self.state["human_epoch"], "fingerprint": fingerprint(self.latest),
                 "created_at": now, "assistant_id": None}
        self.state["events"][event_id] = event
        self.state["call_times"] = [stamp for stamp in self.state["call_times"] if now - stamp < 86400] + [now]
        self.state["last_decision_at"] = now
        self.state["last_fingerprint"] = event["fingerprint"]
        payload = {"session_id": self.chat.meta["session_id"], "event_id": event_id,
                   "task_state": public_state(self.chat.meta["tasks"]),
                   "human_epoch": event["human_epoch"], "observation": self.latest}
        self.persist()
        self.event_id = event_id
        self.event_task = asyncio.create_task(self.decide(payload), name="native-accountability-decision")

    def current(self, event):
        return (self.active() and not self.chat.busy and has_open_work(self.chat.meta["tasks"])
                and event["task_revision"] == self.chat.meta["tasks"]["revision"]
                and event["human_epoch"] == self.state["human_epoch"]
                and self.latest is not None and event["fingerprint"] == fingerprint(self.latest))

    async def decide(self, payload):
        event_id = payload["event_id"]
        event = self.state["events"][event_id]
        path = self.chat.meta_path.parent / (f"event-{event_id}.json")
        try:
            path.write_text(json.dumps(payload)); path.chmod(0o600)
            async with self.chat.native_lock:
                if not self.current(event):
                    event["status"] = "stale"
                    return
                code, out, _ = await self.chat.command(["--input", str(path)], launcher="hermes-event", timeout=120)
                value = json.loads(out) if code == 0 else {}
                audit = value.get("audit", {})
                if audit.get("model") != "gpt-5.6-luna" or audit.get("provider") != "openai-codex" or audit.get("tool_schema_count") != 0:
                    raise ValueError("Native event construction could not be verified.")
                decision = validate_decision(value.get("decision"), event_id)
                event["assistant_id"] = str(value.get("assistant_id"))
                if not self.current(event):
                    event["status"] = "stale"
                elif decision and decision["decision"] != "quiet":
                    event["status"] = "delivered"
                else:
                    event["status"] = "quiet"
                await self.chat.refresh()
        except asyncio.CancelledError:
            event["status"] = "stale"
            raise
        except Exception:
            event["status"] = "failed_quiet"
            self.reason = "A background check could not finish safely. No check-in was delivered."
        finally:
            path.unlink(missing_ok=True)
            self.event_id = None
            self.persist()
            self.chat.changed()

    async def wait_for_preempted_event(self):
        if self.event_task and not self.event_task.done():
            with contextlib.suppress(asyncio.CancelledError):
                await self.event_task

    async def close(self):
        self.stop()
        if self.collector and not self.collector.done():
            self.collector.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.collector
        await self.wait_for_preempted_event()
