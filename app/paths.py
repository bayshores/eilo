"""Repository-local paths used by the loopback application."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".state"
META = STATE / "local-chat.json"
PID_FILE = STATE / "local-chat-process.json"
WEB = ROOT / "web"
