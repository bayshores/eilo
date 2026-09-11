"""Immutable application assets and separately owned writable Mac state."""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKOUT_STORAGE = frozenset(
    json.loads((ROOT / "config/source-boundary.json").read_text())["checkout_storage_directories"]
)


def private_directory(value, *, root=ROOT):
    """Keep environment overrides out of source folders, including symlink aliases."""
    if isinstance(value, str) and not value.strip():
        raise ValueError("Private app storage requires an explicit nonempty path.")
    destination = Path(value).expanduser().resolve()
    source = Path(root).resolve()
    if destination.is_relative_to(source):
        relative = destination.relative_to(source)
        if not relative.parts or relative.parts[0] not in CHECKOUT_STORAGE:
            raise ValueError(
                "Private app storage must use a reserved local directory or a path outside the source checkout."
            )
    return destination


STATE = private_directory(os.environ.get("EILO_DATA_HOME", ROOT / ".state"))
CACHE = private_directory(os.environ.get("EILO_CACHE_HOME", ROOT / ".tmp"))
RUNTIME = private_directory(os.environ.get("EILO_RUNTIME_HOME", ROOT / ".runtime"))
META = STATE / "local-chat.json"
PID_FILE = STATE / "local-chat-process.json"
WEB = ROOT / "web"


def state_directory(root=ROOT):
    return STATE if Path(root).resolve() == ROOT else Path(root) / ".state"


def runtime_directory(root=ROOT):
    return RUNTIME if Path(root).resolve() == ROOT else Path(root) / ".runtime"


def cache_directory(root=ROOT):
    return CACHE if Path(root).resolve() == ROOT else Path(root) / ".tmp"
