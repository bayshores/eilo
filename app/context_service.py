"""Consent-bound local work context; never owns or mutates commitments or chat."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import re
import time
import uuid
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlsplit

from app.adaptive_driver import ID, KINDS, validate_input, validate_proposal
from app.context_contract import ContextValidationError, validate_event, validate_settings
from app.context_keys import ContextKeyError, load_context_key
from app.context_store import ContextStore, ContextStoreError
from app.context_usage import add_interval, usage_summary
from app.persistence import write_private
from app.runtime_contract import MODEL, PROVIDER

FLAGS = (
    "enabled",
    "desktop_enabled",
    "browser_enabled",
    "text_enabled",
    "visuals_enabled",
    "ai_enabled",
)
DAY = 86400


class ContextError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def defaults():
    return {
        "revision": 0,
        "mode": "manual",
        "policy_epoch": 0,
        **dict.fromkeys(FLAGS, False),
        "excluded_bundle_ids": [],
        "excluded_domains": [],
        "pins": [],
        "seen_requests": {},
        "call_times": [],
        "current_context_id": None,
        "last_composition_id": None,
        "undo_ids": [],
    }


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ContextError("Invalid item reference.")
    return value


def short_text(value, limit, empty=False):
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        raise ContextError("Keep this correction brief.")
    return value.strip()


def token(value):
    return hashlib.sha256(value.encode()).hexdigest()[:24]


class ContextService:
    def __init__(
        self,
        directory,
        *,
        get_tasks=lambda: [],
        changed=lambda: None,
        analyze=None,
        is_human_busy=lambda: False,
        key_provider=load_context_key,
        clock=time.time,
        settle_seconds=45,
        visual_available=False,
    ):
        self.directory = Path(directory)
        self.settings_path = self.directory / "context-settings.json"
        self.get_tasks, self.changed, self.analyze = get_tasks, changed, analyze
        self.is_human_busy, self.key_provider, self.clock = is_human_busy, key_provider, clock
        self.settle_seconds, self.visual_available = settle_seconds, visual_available
        try:
            self.state = validate_settings(json.loads(self.settings_path.read_text()), defaults())
        except (OSError, ValueError):
            self.state = defaults()
        self.session_id = "capture-" + uuid.uuid4().hex
        self.store = self.job = self._settler = None
        self._closed, self._generation = False, 0
        self._candidate = self._image = self._pending_human = None
        self._last_automatic_attempt, self._requested_observation = 0, None
        self._seen_events, self._last = set(), {}
        self._health = {
            s: {"status": "disabled", "last_event_at": None} for s in ("desktop", "browser")
        }
        self.analysis_status = "off"
        self._lock = asyncio.Lock()

    def _ensure_store(self):
        if self.store is None:
            path = self.directory / "context.sqlite"
            try:
                self.store = ContextStore(
                    path, self.key_provider(create=not path.exists()), now=self.clock
                )
            except (ContextKeyError, ContextStoreError) as exc:
                raise ContextError(
                    "Local memory is locked. Unlock your Mac and try again.", 503
                ) from exc
        return self.store

    def memory_unavailable(self):
        self._cancel()
        self.state["enabled"] = self.state["ai_enabled"] = False
        self.analysis_status = "memory_unavailable"
        return {
            "revision": self.state["revision"],
            "mode": "manual",
            "policy_epoch": self.state["policy_epoch"],
            "policy": {
                key: deepcopy(self.state[key])
                for key in (*FLAGS, "excluded_bundle_ids", "excluded_domains")
            },
            "capture_status": {
                source: {"enabled": False, "status": "error"} for source in self._health
            },
            "current_work_context": None,
            "home_composition": None,
            "pins": [],
            "can_undo": False,
            "preferences": [],
            "episodes": [],
            "usage": {},
            "analysis": {"status": "memory_unavailable"},
            "visual_available": False,
        }

    def _save(self, revision=False):
        if revision:
            self.state["revision"] += 1
        write_private(self.settings_path, self.state)
        self.changed()

    async def start(self):
        if self.state["mode"] == "adaptive" or self.state["enabled"]:
            try:
                self._ensure_store()
            except ContextError:
                self.state.update(dict.fromkeys(FLAGS, False))
                self.analysis_status = "memory_locked"
                self._save()

    def _cancel(self):
        self._generation += 1
        try:
            current = asyncio.current_task()
        except RuntimeError:
            current = None
        for job in (self.job, self._settler):
            if job and job is not current:
                job.cancel()
        self.job = self._settler = self._image = self._candidate = None

    def _policy_change(self):
        self._cancel()
        self.state["policy_epoch"] += 1
        self._last.clear()
        self._pending_human = None

    def source_boundary_changed(self):
        """An extension grant/exclusion boundary invalidates queued derived work."""
        self._policy_change()
        self._save()

    def collector_policy(self, source):
        if source not in self._health:
            raise ContextError("Unsupported source.")
        enabled = self.state["enabled"] and self.state[f"{source}_enabled"] and not self._closed
        return {
            "source_id": source,
            "session_id": self.session_id,
            "policy_epoch": self.state["policy_epoch"],
            "enabled": enabled,
            "text_enabled": enabled and self.state["text_enabled"],
            "visuals_enabled": enabled and self.state["visuals_enabled"] and self.visual_available,
            "excluded_bundle_ids": list(self.state["excluded_bundle_ids"]),
            "excluded_domains": list(self.state["excluded_domains"]),
        }

    def set_capture_health(self, source, status, details=None):
        if source not in self._health:
            return
        allowed = {
            "disabled",
            "configured",
            "registration_required",
            "connected",
            "disconnected",
            "waiting",
            "sampling",
            "ready",
            "permission_required",
            "checked",
            "error",
            "paused",
            "unsupported",
        }
        if status not in allowed:
            return
        value = {**self._health[source], "status": status}
        if source == "browser" and status in {"connected", "disconnected"}:
            value["connected"] = status == "connected"
        if isinstance(details, dict):
            value["permissions"] = {
                k: details[k]
                for k in ("accessibility_permission", "screen_recording_permission")
                if type(details.get(k)) is bool
            }
        if value != self._health[source]:
            self._health[source] = value
            self.changed()

    def _record(self, kind, id):
        return self.store.get(kind, id) if self.store and id else None

    def _composition(self):
        record = self._record("composition", self.state["last_composition_id"])
        return deepcopy(record["payload"]) if record else None

    def _context(self):
        record = self._record("context", self.state["current_context_id"])
        return deepcopy(record["payload"]) if record else None

    def _archive_context(self, context):
        record = self._record("context", context["id"])
        archive_id = "context:archive:" + uuid.uuid4().hex
        self.store.put("context", archive_id, {**context, "archived": True}, record["source_ids"])
        return archive_id

    def _scope_allowed(self, scope):
        source = scope.get("source_id")
        if source == "conversation":
            return self.state["ai_enabled"]
        if source not in self._health or not self.collector_policy(source)["enabled"]:
            return False
        if scope.get("policy_epoch") != self.state["policy_epoch"]:
            return False
        if scope.get("bundle_id") in self.state["excluded_bundle_ids"]:
            return False
        host = urlsplit(scope.get("origin") or "").hostname
        return not host or not any(
            host == domain or host.endswith("." + domain)
            for domain in self.state["excluded_domains"]
        )

    def _component(self, id, allow_cached=False):
        compositions = [self._composition() or {}]
        if allow_cached and self.store:
            compositions.extend(record["payload"] for record in self.store.list("composition"))
        for composition in compositions:
            for index, component in enumerate(composition.get("components", [])):
                if component["id"] == id:
                    return component, index
        raise ContextError("That widget is no longer available.", 409)

    def _new_composition(self, payload, sources, remember=True):
        previous = self.state["last_composition_id"]
        if previous and remember and self._record("composition", previous):
            self.state["undo_ids"] = (self.state["undo_ids"] + [previous])[-12:]
        payload = {
            **deepcopy(payload),
            "id": "composition:" + uuid.uuid4().hex,
            "revision": self.state["revision"] + 1,
        }
        self._ensure_store().put(
            "composition", payload["id"], payload, source_ids=tuple(dict.fromkeys(sources))
        )
        self.state["last_composition_id"] = payload["id"]

    @staticmethod
    def _fields(body, extra=(), optional=()):
        required = {"request_id", "based_on_revision", "action", *extra}
        if not required <= set(body) or set(body) - required - set(optional):
            raise ContextError("Unsupported workspace command.")

    async def command(self, body):
        async with self._lock:
            if not isinstance(body, dict):
                raise ContextError("Unsupported workspace command.")
            request_id = identifier(body.get("request_id"))
            digest = token(json.dumps(body, sort_keys=True))
            seen = self.state["seen_requests"].get(request_id)
            if seen:
                if seen != digest:
                    raise ContextError("That request ID was already used.", 409)
                return self.snapshot()
            revision = body.get("based_on_revision")
            note_revision = (
                body.get("action") == "note"
                and type(revision) is int
                and 0 <= revision <= self.state["revision"]
            )
            if type(revision) is not int or (
                revision != self.state["revision"] and not note_revision
            ):
                raise ContextError("Home changed. Try the action again.", 409)
            before = deepcopy(self.state)
            try:
                self._apply_command(body)
                self.state["seen_requests"][request_id] = digest
                self.state["seen_requests"] = dict(list(self.state["seen_requests"].items())[-128:])
                self._save(revision=True)
            except Exception:
                self.state = before
                raise
            return self.snapshot()

    def _apply_command(self, body):
        action = body.get("action")
        if action == "set_mode":
            self._fields(body, {"mode"})
            if body["mode"] not in {"adaptive", "manual"}:
                raise ContextError("Choose Adaptive or Manual Home.")
            if body["mode"] == "adaptive":
                self._ensure_store()
            self.state["mode"] = body["mode"]
            self._cancel()
        elif action == "configure":
            self._configure(body)
        elif action in {"pin", "unpin"}:
            self._fields(body, {"component_id"})
            id = identifier(body["component_id"])
            component, slot = self._component(id)
            pref_id = "preference:pin:" + token(id)
            if action == "pin" and id not in self.state["pins"]:
                self.store.put(
                    "preference",
                    pref_id,
                    {
                        "component_id": id,
                        "component_kind": component["kind"],
                        "slot": slot,
                        "retained": True,
                        "explicit": True,
                        "pinned": True,
                    },
                )
                self.state["pins"].append(id)
            elif action == "unpin":
                self.state["pins"] = [item for item in self.state["pins"] if item != id]
                self.store.delete([pref_id])
        elif action == "undo":
            self._fields(body)
            while self.state["undo_ids"]:
                record = self._record("composition", self.state["undo_ids"].pop())
                if record:
                    self._cancel()
                    self.state["current_context_id"] = record["payload"]["context_id"]
                    self._new_composition(record["payload"], record["source_ids"], remember=False)
                    break
            else:
                raise ContextError("There is no earlier layout to restore.", 409)
        elif action == "correct":
            self._correct(body)
        elif action == "note":
            self._fields(body, {"component_id", "text"})
            id = identifier(body["component_id"])
            if self._component(id, allow_cached=True)[0]["kind"] != "note":
                raise ContextError("That widget is not a note.")
            value = short_text(body["text"], 2400, empty=True)
            self.store.put(
                "note",
                "note:chosen:" + token(id),
                {"component_id": id, "text": value, "retained": True},
            )
        elif action in {"feedback", "preference"}:
            self._feedback(body)
        elif action == "forget":
            self._forget(body)
        else:
            raise ContextError("Unsupported workspace command.")

    def _configure(self, body):
        self._fields(body, set(FLAGS) | {"excluded_domains", "excluded_bundle_ids"})
        if any(type(body[key]) is not bool for key in FLAGS):
            raise ContextError("Invalid capture settings.")
        if body["visuals_enabled"] and not self.visual_available:
            raise ContextError("Visual context is unavailable on this runtime.", 409)
        bundles, domains = body["excluded_bundle_ids"], body["excluded_domains"]
        if (
            not isinstance(bundles, list)
            or len(bundles) > 64
            or not isinstance(domains, list)
            or len(domains) > 64
        ):
            raise ContextError("Too many exclusions.")
        bundles = list(dict.fromkeys(identifier(value) for value in bundles))
        clean_domains = []
        for value in domains:
            value = short_text(value, 253).lower().strip(".")
            parsed = urlsplit("https://" + value)
            if (
                parsed.hostname != value
                or parsed.path
                or parsed.port
                or ":" in value
                or "@" in value
                or " " in value
            ):
                raise ContextError("Enter a domain, such as example.com.")
            clean_domains.append(value.encode("idna").decode())
        if body["enabled"] or body["ai_enabled"]:
            self._ensure_store()
        self.state.update({key: body[key] for key in FLAGS})
        self.state.update(
            excluded_bundle_ids=bundles, excluded_domains=list(dict.fromkeys(clean_domains))
        )
        self._policy_change()

    def _correct(self, body):
        self._fields(body, optional={"title", "return_point"})
        values = {
            key: short_text(body[key], 100 if key == "title" else 280, empty=key == "return_point")
            for key in ("title", "return_point")
            if key in body
        }
        context = self._context()
        if not context or not values:
            raise ContextError("There is no current context to correct.", 409)
        self._cancel()
        evidence_id = "observation:correction:" + uuid.uuid4().hex
        self.store.put(
            "observation",
            evidence_id,
            {
                "source_id": "conversation",
                "title": values.get("title", context["title"]),
                "text": values.get("return_point", ""),
                "captured_at": self.clock(),
            },
        )
        previous_id = self._archive_context(context)
        context.update(
            values,
            confidence="explicit",
            evidence_ids=[evidence_id],
            updated_at=self.clock(),
        )
        self.store.put("context", context["id"], context, [previous_id, evidence_id])
        self.state["current_context_id"] = context["id"]
        composition = self._composition()
        if composition:
            composition.update(title=context["title"], context_id=context["id"])
            for component in composition["components"]:
                if component["kind"] == "resume" and "return_point" in values:
                    component["text"] = values["return_point"]
            self._new_composition(composition, [context["id"]])

    def _feedback(self, body):
        action = body["action"]
        self._fields(
            body, {"component_id", "value"} if action == "feedback" else {"component_kind", "value"}
        )
        if body["value"] not in {"prefer", "less", "reset"}:
            raise ContextError("Unsupported presentation preference.")
        kind = (
            self._component(identifier(body["component_id"]))[0]["kind"]
            if action == "feedback"
            else body["component_kind"]
        )
        if kind not in KINDS:
            raise ContextError("Unsupported widget.")
        store = self._ensure_store()
        if action == "preference":
            id = "preference:chosen:" + kind
            if body["value"] == "reset":
                store.delete(
                    [id, "preference:learned:" + kind]
                    + [
                        r["id"]
                        for r in store.list("preference")
                        if r["payload"].get("component_kind") == kind
                        and not r["payload"].get("pinned")
                    ]
                )
                store.put(
                    "preference",
                    id,
                    {"component_kind": kind, "value": "reset", "explicit": True, "retained": True},
                )
            else:
                store.put(
                    "preference",
                    id,
                    {
                        "component_kind": kind,
                        "value": body["value"],
                        "explicit": True,
                        "retained": True,
                    },
                )
            return
        context = self._context()
        if not context or body["value"] == "reset":
            raise ContextError("No current context for that choice.", 409)
        id = "preference:choice:" + body["request_id"]
        store.put(
            "preference",
            id,
            {
                "component_kind": kind,
                "value": body["value"],
                "context_id": context["id"],
                "explicit": False,
                "choice": True,
            },
            [context["id"]],
        )
        reset = store.get("preference", "preference:chosen:" + kind)
        reset_at = reset["updated_at"] if reset and reset["payload"].get("value") == "reset" else 0
        choices = [
            r
            for r in store.list("preference")
            if r["payload"].get("choice")
            and r["payload"].get("component_kind") == kind
            and r["updated_at"] > reset_at
        ][:3]
        if (
            len(choices) == 3
            and len({r["payload"]["context_id"] for r in choices}) >= 2
            and all(r["payload"]["value"] == body["value"] for r in choices)
        ):
            store.put(
                "preference",
                "preference:learned:" + kind,
                {
                    "component_kind": kind,
                    "value": body["value"],
                    "explicit": False,
                    "learned": True,
                },
                [r["id"] for r in choices],
            )

    def _forget(self, body):
        self._fields(body, optional={"ids", "start", "end"})
        self._policy_change()
        if self.store or (self.directory / "context.sqlite").exists():
            store = self._ensure_store()
            if "ids" in body:
                if not isinstance(body["ids"], list) or not 1 <= len(body["ids"]) <= 256:
                    raise ContextError("Choose a valid history range.")
                store.delete([identifier(item) for item in body["ids"]])
            else:
                # Chosen independent notes/preferences and user-visible conversations are separate.
                for kind in ("observation", "episode", "context", "composition"):
                    while ids := store.find_ids(body.get("start"), body.get("end"), kind=kind):
                        store.delete(ids)
            self.state["undo_ids"] = [
                id for id in self.state["undo_ids"] if self._record("composition", id)
            ]
            if not self._context():
                self.state["current_context_id"] = None
            if not self._composition():
                self.state["last_composition_id"] = None
        self._seen_events.clear()

    async def ingest(self, raw):
        source = raw.get("source_id") if isinstance(raw, dict) else None
        if source not in self._health:
            raise ContextError("Unsupported source.")
        try:
            event = validate_event(raw, self.collector_policy(source), self.clock())
        except ContextValidationError as exc:
            raise ContextError(str(exc)) from exc
        if event is None:
            return {"accepted": False, "reason": "withheld"}
        if event["id"] in self._seen_events:
            return {"accepted": False, "reason": "duplicate"}
        if len(self._seen_events) >= 1024:
            self._seen_events.clear()
        self._seen_events.add(event["id"])
        store = self._ensure_store()
        stamp, title = event["captured_at"], event["title"] or event["app_name"]
        anchor = token(
            event.get("resource_url")
            or f"{event['bundle_id']}:{event.get('origin') or ''}:{event['title']}"
        )
        last = self._last.get(source)
        same = last and last["anchor"] == anchor and 0 <= stamp - last["at"] <= 15
        fingerprint = token(title + "\0" + event["text"])
        if same and last["fingerprint"] == fingerprint:
            observation_id = last["observation_id"]
        else:
            observation_id = "observation:" + event["id"]
            store.put(
                "observation",
                observation_id,
                {key: value for key, value in event.items() if key != "image"},
            )
        prior = self._record("episode", last["episode_id"]) if same else None
        if prior and observation_id not in prior["source_ids"] and len(prior["source_ids"]) >= 64:
            prior = None
        episode_id = prior["id"] if prior else "episode:" + uuid.uuid4().hex
        payload = (
            deepcopy(prior["payload"])
            if prior
            else {
                "id": episode_id,
                "title": title,
                "source_id": source,
                "app_name": event["app_name"],
                "anchor": anchor,
                "origin": event.get("origin"),
                "started_at": stamp,
                "duration_seconds": 0,
            }
        )
        payload["ended_at"] = stamp
        payload["duration_seconds"] += min(10, max(0, stamp - last["at"])) if same else 0
        daily = payload.setdefault("daily_seconds", {})
        if same:
            add_interval(daily, max(stamp - 10, last["at"]), stamp)
        sources = list(prior["source_ids"]) if prior else []
        if observation_id not in sources:
            sources.append(observation_id)
        store.put("episode", episode_id, payload, sources)
        self._last[source] = {
            "anchor": anchor,
            "at": stamp,
            "fingerprint": fingerprint,
            "observation_id": observation_id,
            "episode_id": episode_id,
        }
        self._health[source] = {
            **self._health[source],
            "status": "sampling",
            "last_event_at": stamp,
        }
        if event.get("image"):
            self._image = (self.state["policy_epoch"], stamp, event["image"])
        self.changed()
        if self._can_analyze():
            self._queue_context(anchor, observation_id, episode_id)
        return {"accepted": True, "observation_id": observation_id, "episode_id": episode_id}

    def _can_analyze(self):
        return bool(
            self.analyze
            and self.state["mode"] == "adaptive"
            and self.state["ai_enabled"]
            and not self._closed
            and not self.is_human_busy()
        )

    def _queue_context(self, anchor, observation_id, episode_id):
        if self._candidate and self._candidate["anchor"] == anchor:
            self._candidate.update(observation_id=observation_id, episode_id=episode_id)
            if (
                not self._settler
                and not self.job
                and observation_id != self._requested_observation
                and self.clock() - self._last_automatic_attempt >= 300
            ):
                self._settler = asyncio.create_task(self._settle(self._generation))
            return
        if self._settler:
            self._settler.cancel()
        self._candidate = {
            "anchor": anchor,
            "observation_id": observation_id,
            "episode_id": episode_id,
            "since": self.clock(),
        }
        self._settler = asyncio.create_task(self._settle(self._generation))

    async def _settle(self, generation):
        current = asyncio.current_task()
        try:
            await asyncio.sleep(self.settle_seconds)
            candidate = self._candidate
            if generation != self._generation or not candidate or not self._can_analyze():
                return
            self._last_automatic_attempt = self.clock()
            for record in self.store.search(candidate["anchor"], kind="context"):
                context = record["payload"]
                if context.get("archived"):
                    continue
                if candidate["anchor"] not in context.get("resource_keys", []):
                    continue
                cached = self.store.latest_composition(context["id"])
                if cached:
                    if self.state["current_context_id"] != context["id"]:
                        self.state["current_context_id"] = context["id"]
                        self._accept_composition(cached["payload"], [context["id"]])
                        self._save(revision=True)
                        self.analysis_status = "cached"
                        return
                    # The same resource can change while its tab remains open.
                    break
            self._schedule(
                [candidate["observation_id"]], [candidate["episode_id"]], candidate["anchor"]
            )
        finally:
            if self._settler is current:
                self._settler = None

    def on_human(self, text):
        self._cancel()
        if self.state["mode"] == "adaptive" and self.state["ai_enabled"]:
            self._pending_human = short_text(text, 12000, empty=True)[:8000]

    def on_chat_change(self):
        self._cancel()
        self._pending_human = None

    def resume_after_human(self):
        if not self._pending_human or not self._can_analyze():
            return
        value, self._pending_human = self._pending_human, None
        id = "observation:conversation:" + uuid.uuid4().hex
        self._ensure_store().put(
            "observation",
            id,
            {
                "source_id": "conversation",
                "title": "Your current intention",
                "text": value,
                "captured_at": self.clock(),
            },
        )
        self._schedule([id], [id], "conversation:" + token(value))

    def _within_budget(self):
        self.state["call_times"] = [
            value
            for value in self.state["call_times"]
            if self.clock() - DAY <= value <= self.clock()
        ]
        return (
            len(self.state["call_times"]) < 60
            and sum(value >= self.clock() - 3600 for value in self.state["call_times"]) < 12
        )

    def _schedule(self, evidence_ids, derived_ids, anchor):
        if not self._can_analyze() or self.job:
            return
        if not self._within_budget():
            self.analysis_status = "budget_paused"
            self.changed()
            return
        self.state["call_times"].append(self.clock())
        self._requested_observation = evidence_ids[-1]
        self._save()
        self.analysis_status = "updating"
        self.job = asyncio.create_task(
            self._analyze(self._generation, evidence_ids, derived_ids, anchor)
        )

    def _packet(self, evidence_ids):
        evidence = []
        for id in evidence_ids:
            record = self._record("observation", id)
            if not record:
                continue
            payload = record["payload"]
            source = payload["source_id"]
            if source in self._health:
                if (
                    not self.collector_policy(source)["enabled"]
                    or payload.get("bundle_id") in self.state["excluded_bundle_ids"]
                ):
                    continue
                host = urlsplit(payload.get("origin") or "").hostname
                if host and any(
                    host == domain or host.endswith("." + domain)
                    for domain in self.state["excluded_domains"]
                ):
                    continue
            item = {
                "id": id,
                "source_id": source,
                "title": payload.get("title", ""),
                "text": payload.get("text", "")
                if source == "conversation" or self.state["text_enabled"]
                else "",
            }
            item.update({k: payload[k] for k in ("app_name", "origin") if payload.get(k)})
            evidence.append(item)
        context = self._context()
        if evidence and evidence[0]["source_id"] == "conversation":
            words = [
                word
                for word in re.findall(r"[\w]+", evidence[0]["text"].lower())
                if len(word) > 3
                and word
                not in {
                    "this",
                    "that",
                    "with",
                    "from",
                    "want",
                    "need",
                    "would",
                    "should",
                    "please",
                    "help",
                    "working",
                    "continue",
                    "resume",
                }
            ][:12]
            matches = (
                self.store.search(" ".join(words), limit=4, kind="context", any_word=True)
                if words
                else []
            )
            relevant = [
                record["payload"]
                for record in matches
                if sum(word in record["payload"].get("title", "").lower() for word in words) >= 2
            ]
            if relevant:
                context = relevant[0]
        if context and (
            context.get("policy_epoch") != self.state["policy_epoch"]
            or not all(self._scope_allowed(scope) for scope in context.get("scopes", []))
        ):
            context = None
        prior = (
            {
                k: context[k]
                for k in (
                    "id",
                    "title",
                    "summary",
                    "return_point",
                    "confidence",
                    "evidence_ids",
                    "task_ids",
                )
                if k in context
            }
            if context
            else None
        )
        prefs = [
            {k: p[k] for k in ("component_kind", "value", "explicit")} for p in self._preferences()
        ][:16]
        tasks = [
            {
                k: task[k]
                for k in (
                    "id",
                    "title",
                    "status",
                    "due_text",
                    "target_count",
                    "completed_count",
                    "unit",
                )
                if k in task
            }
            for task in list(self.get_tasks())[:32]
        ]
        packet = {
            "schema_version": 1,
            "request_id": "analysis-" + uuid.uuid4().hex,
            "policy_epoch": self.state["policy_epoch"],
            "evidence": evidence,
            "tasks": tasks,
            "prior_context": prior,
            "preferences": prefs,
        }
        if (
            self.visual_available
            and self.state["visuals_enabled"]
            and self._image
            and self._image[0] == self.state["policy_epoch"]
            and self.clock() - self._image[1] <= 15
        ):
            packet["image"] = self._image[2]
        return validate_input(packet)

    async def _analyze(self, generation, evidence_ids, derived_ids, anchor):
        job = asyncio.current_task()
        try:
            packet = self._packet(evidence_ids)
            self._image = None
            receipt = await self.analyze(packet)
            if generation != self._generation or not self._can_analyze():
                return
            if (
                not isinstance(receipt, dict)
                or receipt.get("request_id") != packet["request_id"]
                or receipt.get("policy_epoch") != self.state["policy_epoch"]
            ):
                raise ContextError("Stale context proposal.")
            audit = receipt.get("audit", {})
            if (
                audit.get("persisted") is not False
                or audit.get("tool_schema_count") != 0
                or audit.get("model") != MODEL
                or audit.get("provider") != PROVIDER
            ):
                raise ContextError("Invalid analysis scope.")
            proposal = validate_proposal(receipt.get("proposal"), packet)
            if any(not self._record("observation", id) for id in evidence_ids):
                return
            prior_record = self._record("context", (packet.get("prior_context") or {}).get("id"))
            prior = prior_record["payload"] if prior_record else None
            same = (
                prior
                and packet.get("prior_context")
                and prior["title"].casefold() == proposal["title"].casefold()
            )
            id = prior["id"] if same else "context:" + uuid.uuid4().hex
            resources = []
            scopes = []
            for source_id in proposal["evidence_ids"]:
                record = self._record("observation", source_id)
                data = record["payload"] if record else {}
                if data:
                    scopes.append(
                        {
                            key: data[key]
                            for key in ("source_id", "policy_epoch", "bundle_id", "origin")
                            if key in data
                        }
                    )
                if data.get("resource_url"):
                    resources.append(
                        {
                            "id": source_id,
                            "label": data.get("title") or data.get("app_name"),
                            "url": data["resource_url"],
                            "origin": data.get("origin"),
                        }
                    )
            context = {
                "id": id,
                "policy_epoch": self.state["policy_epoch"],
                **{
                    k: proposal[k]
                    for k in (
                        "title",
                        "summary",
                        "return_point",
                        "confidence",
                        "evidence_ids",
                        "task_ids",
                    )
                },
                "resources": resources,
                "scopes": [
                    *scopes,
                    *(prior.get("scopes", []) if prior and packet.get("prior_context") else []),
                ][-128:],
                "episode_ids": [source for source in derived_ids if source.startswith("episode:")],
                "resource_keys": list(
                    dict.fromkeys((prior.get("resource_keys", []) if same else []) + [anchor])
                )[-32:],
                "updated_at": self.clock(),
            }
            if prior and packet.get("prior_context"):
                derived_ids = [*derived_ids, self._archive_context(prior) if same else prior["id"]]
            self.store.put("context", id, context, source_ids=tuple(dict.fromkeys(derived_ids)))
            self.state["current_context_id"] = id
            components, previous = [], self._composition()
            for position, source in enumerate(proposal["components"]):
                component = deepcopy(source)
                match = next(
                    (
                        item
                        for item in (previous or {}).get("components", [])
                        if same
                        and item["kind"] == source["kind"]
                        and item["title"] == source["title"]
                    ),
                    None,
                )
                component["id"] = (
                    match["id"]
                    if match
                    else f"widget:{token(id + ':' + source['kind'] + ':' + str(position))}"
                )
                components.append(component)
            self._accept_composition(
                {
                    "schema_version": 1,
                    "context_id": id,
                    "title": context["title"],
                    "components": components,
                },
                [id],
            )
            self.analysis_status = "ready"
            self._save(revision=True)
        except asyncio.CancelledError:
            raise
        except Exception:
            if generation == self._generation:
                self.analysis_status = "unavailable"
                self.changed()
        finally:
            if self.job is job:
                self.job = None

    def _accept_composition(self, payload, sources):
        previous, components = self._composition(), deepcopy(payload["components"])
        for index, pinned in enumerate((previous or {}).get("components", [])):
            if pinned["id"] not in self.state["pins"]:
                continue
            components = [item for item in components if item["id"] != pinned["id"]]
            components.insert(min(index, len(components)), pinned)
            if previous["context_id"] not in sources:
                sources.append(previous["context_id"])
        optional = [item for item in components if item["id"] not in self.state["pins"]]
        while len(components) > 8 and optional:
            components.remove(optional.pop())
        self._new_composition({**payload, "components": components}, sources)

    def _preferences(self):
        if not self.store:
            return []
        preferences = []
        # Explicit settings cannot fall off a recent-activity page.
        for kind in sorted(KINDS):
            for scope in ("chosen", "learned"):
                record = self.store.get("preference", f"preference:{scope}:" + kind)
                if record and record["payload"].get("value") in {"prefer", "less"}:
                    preferences.append({"id": record["id"], **record["payload"]})
                    break
        return preferences

    def snapshot(self):
        context, composition = self._context(), self._composition()
        if composition:
            for component in composition["components"]:
                note = self._record("note", "note:chosen:" + token(component["id"]))
                if note:
                    component["text"] = note["payload"]["text"]
        episodes = [
            {**r["payload"], "id": r["id"]}
            for r in (self.store.list("episode") if self.store else [])
        ]
        usage = usage_summary(
            self.store.iter_payloads("episode", self.clock() - 7 * DAY) if self.store else [],
            self.clock(),
        )
        by_source = {source: values["total_observed_seconds"] for source, values in usage.items()}
        return {
            "revision": self.state["revision"],
            "mode": self.state["mode"],
            "policy_epoch": self.state["policy_epoch"],
            "policy": {
                key: deepcopy(self.state[key])
                for key in (*FLAGS, "excluded_bundle_ids", "excluded_domains")
            },
            "capture_status": {
                s: {**v, "enabled": self.collector_policy(s)["enabled"]}
                for s, v in self._health.items()
            },
            "current_work_context": context,
            "home_composition": composition,
            "pins": list(self.state["pins"]),
            "can_undo": any(self._record("composition", id) for id in self.state["undo_ids"]),
            "preferences": self._preferences(),
            "episodes": episodes[:50],
            "usage": {
                "by_source": by_source,
                "by_source_scope": "seven_utc_days",
                **usage,
            },
            "analysis": {
                "status": self.analysis_status,
                "calls_last_day": len(
                    [s for s in self.state["call_times"] if s >= self.clock() - DAY]
                ),
                "limit_hour": 12,
                "limit_day": 60,
            },
            "visual_available": self.visual_available,
        }

    async def aclose(self):
        jobs = [job for job in (self.job, self._settler) if job]
        self._closed = True
        self._cancel()
        for job in jobs:
            with contextlib.suppress(asyncio.CancelledError):
                await job
        if self.store:
            self.store.close()
            self.store = None

    def close(self):
        self._closed = True
        for job in (self.job, self._settler):
            if job:
                job.cancel()
        if self.store:
            self.store.close()
            self.store = None
