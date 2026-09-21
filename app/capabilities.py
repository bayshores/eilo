"""Per-chat capability profiles over separately scoped installed resources."""

from __future__ import annotations

import hashlib
import json
import re

import yaml

from app.persistence import write_private, write_private_text

KINDS = frozenset({"connector", "skill", "mcp", "plugin"})
PROFILE_KEYS = frozenset({"disabled_connectors", "skills", "mcp_servers", "plugins"})
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$")


class CapabilityError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _text(value, limit):
    return re.sub(r"\s+", " ", value).strip()[:limit] if isinstance(value, str) else ""


def _frontmatter(path):
    try:
        content = path.read_text(encoding="utf-8")
        end = content.find("\n---", 4)
        value = (
            yaml.safe_load(content[4:end])
            if len(content) <= 1048576 and content.startswith("---\n") and end >= 0
            else None
        )
        return value if isinstance(value, dict) else {}
    except (OSError, UnicodeError, yaml.YAMLError):
        return {}


class Capabilities:
    def __init__(self, chat):
        self.chat = chat
        self.path = chat.meta_path.parent / "capability-profiles.json"
        self.hermes_home = chat.meta_path.parent / "hermes"
        self.data = {"version": 1, "revision": 0, "profiles": {}}
        if self.path.exists():
            try:
                value = json.loads(self.path.read_text())
                self._validate(value)
                self.data = value
            except (OSError, UnicodeError, json.JSONDecodeError, CapabilityError) as exc:
                raise CapabilityError("Saved capability profiles need attention.") from exc

    @classmethod
    def _validate(cls, value):
        if (
            not isinstance(value, dict)
            or set(value) != {"version", "revision", "profiles"}
            or value["version"] != 1
            or type(value["revision"]) is not int
            or value["revision"] < 0
            or not isinstance(value["profiles"], dict)
            or len(value["profiles"]) > 1000
        ):
            raise CapabilityError("Saved capability profiles need attention.")
        for chat_id, profile in value["profiles"].items():
            if (
                not isinstance(chat_id, str)
                or not IDENTIFIER.fullmatch(chat_id)
                or not isinstance(profile, dict)
                or set(profile) != PROFILE_KEYS
            ):
                raise CapabilityError("Saved capability profiles need attention.")
            for ids in profile.values():
                if (
                    not isinstance(ids, list)
                    or len(ids) > 250
                    or any(
                        not isinstance(item, str) or not IDENTIFIER.fullmatch(item) for item in ids
                    )
                    or len(set(ids)) != len(ids)
                ):
                    raise CapabilityError("Saved capability profiles need attention.")

    def _chat_id(self):
        value = (self.chat.meta.get("chat_catalog") or {}).get("active_chat_id")
        if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
            raise CapabilityError("The active chat could not be identified.", 409)
        return value

    def _profile(self, chat_id=None):
        saved = self.data["profiles"].get(chat_id or self._chat_id())
        return (
            {key: list(saved[key]) for key in PROFILE_KEYS}
            if saved
            else {key: [] for key in PROFILE_KEYS}
        )

    def _runtime_config(self):
        try:
            value = yaml.safe_load((self.hermes_home / "config.yaml").read_text()) or {}
            return value if isinstance(value, dict) else {}
        except (OSError, UnicodeError, yaml.YAMLError):
            return {}

    def _skills(self):
        root = self.hermes_home / "skills"
        if not root.is_dir():
            return []
        try:
            bundled = {
                line.split(":", 1)[0]
                for line in (root / ".bundled_manifest").read_text().splitlines()
                if ":" in line
            }
        except (OSError, UnicodeError):
            bundled = set()
        skills_config = self._runtime_config().get("skills") or {}
        disabled = set(skills_config.get("disabled") or [])
        disabled.update((skills_config.get("platform_disabled") or {}).get("cli") or [])
        rows = {}
        for path in sorted(root.glob("**/SKILL.md"))[:500]:
            meta = _frontmatter(path)
            name = _text(meta.get("name"), 160) or path.parent.name
            if IDENTIFIER.fullmatch(name) and name not in rows:
                rows[name] = {
                    "id": name,
                    "name": name.replace("-", " "),
                    "description": _text(meta.get("description"), 220)
                    or "Reusable instructions loaded only when this chat needs them.",
                    "scope": "built in" if name in bundled else "this Mac",
                    "available": name not in disabled,
                    "globally_enabled": name not in disabled,
                    "supported": True,
                    "state": "Ready" if name not in disabled else "Disabled on this Mac",
                }
        return list(rows.values())

    def _plugins(self):
        root = self.hermes_home / "plugins"
        if not root.is_dir():
            return []
        plugins_config = self._runtime_config().get("plugins") or {}
        globally_enabled = set(plugins_config.get("enabled") or [])
        globally_disabled = set(plugins_config.get("disabled") or [])
        candidates = {
            path
            for pattern in ("*", "*/*")
            for path in root.glob(pattern)
            if path.is_dir()
            and any(
                (path / name).is_file() for name in ("plugin.yaml", "plugin.yml", "plugin.json")
            )
        }
        rows = []
        for directory in sorted(candidates)[:100]:
            registry_id = directory.relative_to(root).as_posix()
            try:
                manifest = next(
                    (
                        path
                        for path in (directory / "plugin.yaml", directory / "plugin.yml")
                        if path.is_file()
                    ),
                    None,
                )
                if manifest:
                    loaded = yaml.safe_load(manifest.read_text())
                elif (directory / "plugin.json").is_file():
                    loaded = json.loads((directory / "plugin.json").read_text())
                else:
                    continue
            except (OSError, UnicodeError, json.JSONDecodeError, yaml.YAMLError):
                continue
            value = loaded if isinstance(loaded, dict) else {}
            identity = _text(value.get("name"), 160) or directory.name
            if not IDENTIFIER.fullmatch(identity) or not IDENTIFIER.fullmatch(registry_id):
                continue
            portable = (directory / "plugin.json").is_file()
            namespace = identity
            if portable:
                slug = (
                    "".join(
                        char if char.isascii() and (char.isalnum() or char in "_-") else "-"
                        for char in registry_id.lower()
                    ).strip("-_")
                    or "plugin"
                )
                namespace = (
                    f"agent-plugin-{slug}-{hashlib.sha256(registry_id.encode()).hexdigest()[:8]}"
                )
            skills = []
            for skill in directory.glob("**/SKILL.md"):
                name = _text(_frontmatter(skill).get("name"), 160) or skill.parent.name
                qualified = f"{namespace}:{name}"
                if IDENTIFIER.fullmatch(name) and qualified not in skills:
                    skills.append(qualified)
            mcp_ids = []
            if portable and (directory / "mcp.json").is_file():
                try:
                    mcp_data = json.loads((directory / "mcp.json").read_text())
                    mcp_ids = [
                        f"{namespace}__{name}"
                        for name in (mcp_data.get("mcpServers") or {})
                        if IDENTIFIER.fullmatch(name)
                    ][:50]
                except (OSError, UnicodeError, json.JSONDecodeError, AttributeError):
                    mcp_ids = []
            enabled_here = (
                identity not in globally_disabled
                and registry_id not in globally_disabled
                and bool({identity, registry_id} & globally_enabled)
            )
            available = enabled_here and bool(skills or mcp_ids)
            rows.append(
                {
                    "id": registry_id,
                    "name": identity.replace("-", " "),
                    "description": _text(value.get("description"), 220)
                    or "Installed bundle of related capabilities.",
                    "scope": "this Mac",
                    "skill_ids": skills[:50],
                    "mcp_ids": mcp_ids,
                    "available": available,
                    "globally_enabled": enabled_here,
                    "supported": bool(skills or mcp_ids),
                    "state": "Ready"
                    if available
                    else "Enable this plugin for felis first"
                    if not enabled_here
                    else "No supported chat capabilities found",
                }
            )
        return rows

    def snapshot(self):
        chat_id, connections = self._chat_id(), self.chat.connections.snapshot()
        profile = self._profile(chat_id)
        connectors = [
            {
                "id": item["id"],
                "name": item["name"],
                "description": item.get("description", ""),
                "scope": "this Mac",
                "available": item["enabled"],
                "globally_enabled": item["enabled"],
                "supported": True,
                "enabled": item["enabled"] and item["id"] not in profile["disabled_connectors"],
                "state": item.get("state", ""),
                "effect": "next turn",
            }
            for item in connections["apps"]
        ]
        skills = self._skills()
        for item in skills:
            item.update(
                enabled=item["available"] and item["id"] in profile["skills"],
                effect="next turn",
            )
        mcps = [
            {
                "id": item["id"],
                "name": item["name"],
                "description": item.get("description", ""),
                "scope": "this Mac",
                "available": item["enabled"],
                "globally_enabled": item["enabled"],
                "supported": True,
                "enabled": item["enabled"] and item["id"] in profile["mcp_servers"],
                "state": item.get("state", ""),
                "effect": "next turn",
            }
            for item in connections["mcps"]
        ]
        plugins = self._plugins()
        for item in plugins:
            item.update(
                enabled=item["available"] and item["id"] in profile["plugins"],
                effect="next turn",
            )
        return {
            "version": 1,
            "revision": self.data["revision"],
            "chat_id": chat_id,
            "chat_name": next(
                (
                    item["name"]
                    for item in self.chat.meta["chat_catalog"]["chats"]
                    if item["id"] == chat_id
                ),
                "Current chat",
            ),
            "connectors": connectors,
            "skills": skills,
            "mcps": mcps,
            "plugins": plugins,
        }

    def active(self):
        snapshot = self.snapshot()
        plugins = {item["id"] for item in snapshot["plugins"] if item["enabled"]}
        plugin_skills = {
            skill
            for item in snapshot["plugins"]
            if item["id"] in plugins and item["available"]
            for skill in item.get("skill_ids", [])
        }
        plugin_mcps = {
            server
            for item in snapshot["plugins"]
            if item["id"] in plugins and item["available"]
            for server in item.get("mcp_ids", [])
        }
        return {
            "sources": [item["id"] for item in snapshot["connectors"] if item["enabled"]],
            "skills": sorted(
                {item["id"] for item in snapshot["skills"] if item["enabled"]} | plugin_skills
            ),
            "mcp_servers": sorted(
                {item["id"] for item in snapshot["mcps"] if item["enabled"]} | plugin_mcps
            ),
            "plugins": sorted(plugins),
        }

    def _set_global_enabled(self, body, item):
        kind, identity, enabled = body["kind"], body["id"], body["enabled"]
        if kind not in {"skill", "plugin"}:
            raise CapabilityError("Manage connectors and MCP servers in Connections.", 409)
        if enabled and not item["supported"]:
            raise CapabilityError("That plugin has no supported chat capabilities.", 409)
        config_path = self.hermes_home / "config.yaml"
        try:
            previous_text = config_path.read_text()
            config = yaml.safe_load(previous_text) or {}
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            raise CapabilityError(
                "The felis capability configuration needs attention.", 503
            ) from exc
        if not isinstance(config, dict):
            raise CapabilityError("The felis capability configuration needs attention.", 503)
        if kind == "skill":
            section = config.setdefault("skills", {})
            if not isinstance(section, dict):
                raise CapabilityError("The felis skill configuration needs attention.", 503)
            disabled = set(section.get("disabled") or [])
            (disabled.discard if enabled else disabled.add)(identity)
            section["disabled"] = sorted(disabled)
        else:
            section = config.setdefault("plugins", {})
            if not isinstance(section, dict):
                raise CapabilityError("The felis plugin configuration needs attention.", 503)
            globally_enabled = set(section.get("enabled") or [])
            globally_disabled = set(section.get("disabled") or [])
            if enabled:
                globally_enabled.add(identity)
                globally_disabled.discard(identity)
            else:
                globally_enabled.discard(identity)
                globally_disabled.add(identity)
            section["enabled"] = sorted(globally_enabled)
            section["disabled"] = sorted(globally_disabled)
        candidate = {
            "version": 1,
            "revision": self.data["revision"] + 1,
            "profiles": self.data["profiles"],
        }
        self._validate(candidate)
        try:
            write_private_text(config_path, yaml.safe_dump(config, sort_keys=False))
            write_private(self.path, candidate)
        except Exception:
            write_private_text(config_path, previous_text)
            raise
        self.data = candidate
        self.chat.changed()
        return self.snapshot()

    def control(self, body):
        if (
            not isinstance(body, dict)
            or set(body) != {"action", "based_on_revision", "chat_id", "kind", "id", "enabled"}
            or body.get("action") not in {"set_enabled", "set_global_enabled"}
            or type(body.get("based_on_revision")) is not int
            or type(body.get("enabled")) is not bool
            or body.get("kind") not in KINDS
            or not isinstance(body.get("id"), str)
            or not IDENTIFIER.fullmatch(body["id"])
        ):
            raise CapabilityError("Choose a supported capability change.")
        snapshot = self.snapshot()
        if body["chat_id"] != snapshot["chat_id"]:
            raise CapabilityError("The active chat changed. Review its capabilities.", 409)
        if body["based_on_revision"] != snapshot["revision"]:
            raise CapabilityError("Capabilities changed. Review the latest state.", 409)
        plural = {"connector": "connectors", "skill": "skills", "mcp": "mcps", "plugin": "plugins"}[
            body["kind"]
        ]
        item = next((item for item in snapshot[plural] if item["id"] == body["id"]), None)
        if item is None:
            raise CapabilityError("That capability is no longer available.", 404)
        if body["action"] == "set_global_enabled":
            return self._set_global_enabled(body, item)
        if body["enabled"] and not item["available"]:
            raise CapabilityError("Configure or install that capability first.", 409)
        profile = self._profile(snapshot["chat_id"])
        key = {
            "connector": "disabled_connectors",
            "skill": "skills",
            "mcp": "mcp_servers",
            "plugin": "plugins",
        }[body["kind"]]
        values = set(profile[key])
        selected = not body["enabled"] if body["kind"] == "connector" else body["enabled"]
        (values.add if selected else values.discard)(body["id"])
        profile[key] = sorted(values)
        candidate = {
            "version": 1,
            "revision": self.data["revision"] + 1,
            "profiles": {**self.data["profiles"], snapshot["chat_id"]: profile},
        }
        self._validate(candidate)
        write_private(self.path, candidate)
        self.data = candidate
        self.chat.changed()
        return self.snapshot()
