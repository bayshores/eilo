"""Direct-invocation launcher for the loopback eïlo application."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
from pathlib import Path

# Keep the supported direct-file launcher importable from any working directory.
ROOT = Path(__file__).resolve().parents[1]
sys.path[0] = str(ROOT)

import psutil
from aiohttp import web

from app.chat_service import LocalChat
from app.http_api.application import create_app
from app.paths import PID_FILE, STATE
from app.persistence import write_private


def stop_server() -> None:
    if not PID_FILE.exists():
        print("The local eïlo app is not running.")
        return
    record = json.loads(PID_FILE.read_text())
    try:
        process = psutil.Process(record["pid"])
        command = process.cmdline()
        if (
            process.create_time() != record["created"]
            or str(Path(__file__).resolve()) not in command
        ):
            raise RuntimeError("The process record is stale; no process was stopped.")
        process.terminate()
        process.wait(timeout=15)
        print("Stopped the local eïlo app.")
    except psutil.NoSuchProcess:
        PID_FILE.unlink(missing_ok=True)
        print("The local eïlo app has already stopped.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("start", "stop"), nargs="?", default="start")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    os.umask(0o077)
    if args.action == "stop":
        stop_server()
        return
    lock = (STATE / "local-chat.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("The local eïlo app is already running.") from None
    write_private(
        PID_FILE, {"pid": os.getpid(), "created": psutil.Process().create_time(), "port": args.port}
    )
    try:
        print(f"eïlo is available at http://127.0.0.1:{args.port} (Ctrl+C to stop).", flush=True)
        web.run_app(
            create_app(LocalChat(), args.port),
            host="127.0.0.1",
            port=args.port,
            access_log=None,
            print=None,
            shutdown_timeout=15,
        )
    finally:
        PID_FILE.unlink(missing_ok=True)
        lock.close()


if __name__ == "__main__":
    main()
