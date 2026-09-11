"""Structured, token-safe wrapper around the pinned Codex device flow."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.runtime_auth import isolate_account
from app.runtime_contract import check_config


class AccountDriverError(RuntimeError):
    pass


def status(get_status):
    """Return only a derived UI state; never expose auth-store details."""
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = get_status()
        return {"state": "connected" if result.get("logged_in") is True else "needs_sign_in"}
    except Exception:
        return {"state": "unavailable"}


def login(
    request_device_code,
    poll_authorization_code,
    exchange_authorization_code,
    save_tokens,
    update_config,
    utc_now,
):
    """Run a new device grant using injected pinned-runtime primitives."""
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            device = request_device_code()
        if (
            not isinstance(device, dict)
            or not isinstance(device.get("user_code"), str)
            or not re.fullmatch(r"[A-Za-z0-9-]{4,32}", device["user_code"])
        ):
            raise AccountDriverError("Sign-in is unavailable.")
        yield {
            "state": "awaiting_sign_in",
            "verification_url": "https://auth.openai.com/codex/device",
            "user_code": device["user_code"],
        }
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = poll_authorization_code(device)
            tokens = exchange_authorization_code(code)
            if not isinstance(tokens, dict) or not all(
                isinstance(tokens.get(key), str) and tokens[key]
                for key in ("access_token", "refresh_token")
            ):
                raise AccountDriverError("Sign-in did not complete.")
            save_tokens(tokens, last_refresh=utc_now())
            update_config("openai-codex")
        yield {"state": "connected"}
    except KeyboardInterrupt:
        return
    except AccountDriverError:
        raise
    except Exception as error:
        raise AccountDriverError("Sign-in did not complete.") from error


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--login", action="store_true")
    args = parser.parse_args(argv)
    if args.status == args.login:
        parser.error("choose exactly one of --status or --login")
    logging.disable(logging.CRITICAL)
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            isolate_account()
            check_config()
    except Exception:
        print(json.dumps({"state": "unavailable"}), flush=True)
        return 1
    from hermes_cli.auth import _update_config_for_provider, _utc_now_z, get_codex_auth_status
    from hermes_cli.auth_codex import (
        CODEX_OAUTH_CLIENT_ID,
        _codex_exchange_authorization_code,
        _codex_poll_authorization_code,
        _codex_request_device_code,
        _save_codex_tokens,
    )

    if args.status:
        print(json.dumps(status(get_codex_auth_status), separators=(",", ":")))
        return 0

    def request():
        return _codex_request_device_code("https://auth.openai.com", CODEX_OAUTH_CLIENT_ID)

    def poll(device):
        return _codex_poll_authorization_code(
            "https://auth.openai.com",
            device_auth_id=device["device_auth_id"],
            user_code=device["user_code"],
            poll_interval=device["interval"],
        )

    def exchange(code):
        return _codex_exchange_authorization_code(
            "https://auth.openai.com", CODEX_OAUTH_CLIENT_ID, code
        )

    try:
        for event in login(
            request,
            poll,
            exchange,
            _save_codex_tokens,
            lambda _: _update_config_for_provider(
                "openai-codex", "https://chatgpt.com/backend-api/codex"
            ),
            _utc_now_z,
        ):
            print(json.dumps(event, separators=(",", ":")), flush=True)
        return 0
    except AccountDriverError:
        print(json.dumps({"state": "unavailable"}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
