#!/usr/bin/env python3
"""Run reproducible Python checks without loading the user's Hermes profile."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    commands = {
        "lint": ["-m", "ruff", "check", "."],
        "format": ["-m", "ruff", "format", "."],
        "format-check": ["-m", "ruff", "format", "--check", "."],
        "test": ["-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
    }
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        raise SystemExit("Usage: python3 scripts/check-python.py test|lint|format|format-check")
    python = ROOT / ".venv/bin/python"
    if not python.is_file():
        raise SystemExit("Developer dependencies are missing. Run: uv sync --group dev")
    scratch = ROOT / ".tmp"
    scratch.mkdir(mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="checks-", dir=scratch) as temporary:
        env = {
            **os.environ,
            "HERMES_HOME": temporary,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": str(ROOT),
        }
        return subprocess.run([str(python), *commands[sys.argv[1]]], cwd=ROOT, env=env).returncode


if __name__ == "__main__":
    raise SystemExit(main())
