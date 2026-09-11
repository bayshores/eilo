"""Project CLI entrypoint with the same account isolation as desktop drivers."""

import runpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.runtime_auth import isolate_account

if __name__ == "__main__":
    isolate_account()
    runpy.run_module("hermes_cli.main", run_name="__main__")
