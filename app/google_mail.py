"""On-demand Gmail access through eilo's own Desktop OAuth client and Keychain."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from copy import deepcopy
from datetime import UTC, datetime
from urllib.parse import urlencode

import aiohttp
from aiohttp import web

from app.google_calendar import (
    AUTH_URL,
    FLOW_SECONDS,
    TOKEN_URL,
    USERINFO_URL,
    CalendarError,
    MacCredentialStore,
    _read_bounded_body,
    valid_credentials,
)
from app.paths import state_directory
from app.persistence import write_private

MAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
SCOPES = ("openid", "email", MAIL_SCOPE)


def stamp():
    return datetime.now(UTC).isoformat()


class GoogleMail:
    def __init__(
        self, root, calendar, on_change=lambda: None, *, store_factory=None, transport=None
    ):
        self.root, self.calendar, self.on_change = root, calendar, on_change
        self.path = state_directory(root) / "briefing-sources.json"
        self.data = {"revision": 0, "accounts": [], "calendar_sub": None}
        self.error = None
        if self.path.exists():
            try:
                saved = json.loads(self.path.read_text())
                if (
                    set(saved) != set(self.data)
                    or type(saved["revision"]) is not int
                    or saved["revision"] < 0
                    or not isinstance(saved["accounts"], list)
                    or len(saved["accounts"]) > 10
                    or (
                        saved["calendar_sub"] is not None
                        and not isinstance(saved["calendar_sub"], str)
                    )
                ):
                    raise ValueError()
                for a in saved["accounts"]:
                    if (
                        not isinstance(a, dict)
                        or not re.fullmatch(r"mail_[a-f0-9]{24}", a.get("id", ""))
                        or not isinstance(a.get("email"), str)
                        or len(a["email"]) > 254
                        or not isinstance(a.get("sub"), str)
                        or type(a.get("enabled")) is not bool
                        or a.get("state") not in ("connected", "paused", "reauth_required")
                    ):
                        raise ValueError()
                self.data = saved
            except (ValueError, OSError, TypeError):
                self.error = "Inbox setup needs to be connected again."
        self.store_factory = store_factory or (
            lambda identity: MacCredentialStore(root, namespace="mail", account=identity)
        )
        self.transport = transport
        self.credentials = {}
        self.stores = {}
        self.lock = asyncio.Lock()
        self.token_locks = {}
        self.flow = self.runner = self.timer = None
        self.cleanups = set()
        self.epoch = 0

    def store(self, identity):
        if identity not in self.stores:
            self.stores[identity] = self.store_factory(identity)
        return self.stores[identity]

    def account(self, identity):
        return next((a for a in self.data["accounts"] if a["id"] == identity), None)

    def calendar_enabled(self):
        c = self.calendar.data
        return bool(
            self.data["calendar_sub"]
            and self.data["calendar_sub"] == (c.get("account") or {}).get("sub")
            and c["state"] == "connected"
            and c["selected_ids"]
        )

    def permission_stamp(self):
        c = self.calendar.data
        return json.dumps(
            [
                self.epoch,
                self.data["calendar_sub"],
                [(a["id"], a["enabled"]) for a in self.data["accounts"]],
                (c.get("account") or {}).get("sub"),
                c["state"],
                sorted(c["selected_ids"]),
            ],
            sort_keys=True,
        )

    def snapshot(self, include_authorization=False):
        c = self.calendar.data
        result = {
            "revision": self.data["revision"],
            "configured": bool(self.calendar.config()),
            "available": self.store("availability").available,
            "authorizing": bool(self.flow and not self.flow["used"]),
            "error": self.error,
            "accounts": [{k: v for k, v in a.items() if k != "sub"} for a in self.data["accounts"]],
            "calendar": {
                "available": c["state"] == "connected" and bool(c["selected_ids"]),
                "enabled": self.calendar_enabled(),
                "selected_count": len(c["selected_ids"]),
                "account_label": (c.get("account") or {}).get("email"),
            },
        }
        if include_authorization and self.flow and not self.flow["used"]:
            result["authorization_url"] = self.flow["authorization_url"]
        return deepcopy(result)

    def commit(self, **changes):
        value = {**deepcopy(self.data), **changes, "revision": self.data["revision"] + 1}
        write_private(self.path, value)
        self.data = value
        self.on_change()

    async def http(self, method, url, *, params=None, data=None, token=None):
        if url not in (TOKEN_URL, USERINFO_URL) and not url.startswith(
            "https://gmail.googleapis.com/gmail/v1/users/me/"
        ):
            raise CalendarError("That inbox request is unavailable.", "invalid_request", 400)
        if self.transport:
            return await self.transport(method, url, params=params, data=data, token=token)
        try:
            async with aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=20), trust_env=False
            ) as session:
                async with session.request(
                    method,
                    url,
                    params=params,
                    data=data,
                    allow_redirects=False,
                    headers={"Authorization": "Bearer " + token} if token else {},
                ) as response:
                    raw = await _read_bounded_body(response.content)
                    try:
                        value = json.loads(raw) if raw else {}
                    except ValueError:
                        raise CalendarError(
                            "Google returned an incomplete inbox response. Try again.", "temporary"
                        ) from None
                    if response.status == 401 or value.get("error") == "invalid_grant":
                        raise CalendarError(
                            "Reconnect this inbox to restore access.", "reauth_required", 401
                        )
                    if response.status == 403:
                        raise CalendarError(
                            "Google did not allow this inbox read. Check the Gmail permission and app setup.",
                            "access_denied",
                            403,
                        )
                    if response.status >= 300 or not isinstance(value, dict):
                        raise CalendarError(
                            "Google could not finish the inbox request. Try again.", "temporary"
                        )
                    return value
        except (TimeoutError, aiohttp.ClientError):
            raise CalendarError(
                "Cannot reach Google. Check your connection and try again.", "offline"
            ) from None

    def token(self, value):
        access, expires = value.get("access_token"), value.get("expires_in")
        if (
            not isinstance(access, str)
            or not 1 <= len(access) <= 8192
            or value.get("token_type", "").lower() != "bearer"
            or type(expires) not in (int, float)
            or not 0 < expires <= 86400
        ):
            raise CalendarError("Google did not finish sign-in. Try again.", "invalid_token")
        return {"access_token": access, "expires_at": time.time() + expires}

    async def get(self, identity, url, params=None):
        lock = self.token_locks.setdefault(identity, asyncio.Lock())
        async with lock:
            account = self.account(identity)
            if not account or not account["enabled"] or account["state"] != "connected":
                raise CalendarError("This inbox is not enabled for answers.", "not_enabled", 403)
            epoch = self.epoch
            try:
                credentials = self.credentials.get(identity) or await self.store(identity).read()
                config = self.calendar.config()
                if (
                    not config
                    or not valid_credentials(credentials)
                    or credentials["sub"] != account["sub"]
                    or credentials["client_id"] != config["client_id"]
                    or MAIL_SCOPE not in credentials.get("scopes", [])
                ):
                    raise CalendarError(
                        "Reconnect this inbox to restore access.", "reauth_required", 401
                    )
                if credentials["expires_at"] < time.time() + 60:
                    result = await self.http(
                        "POST",
                        TOKEN_URL,
                        data={
                            **config,
                            "grant_type": "refresh_token",
                            "refresh_token": credentials["refresh_token"],
                        },
                    )
                    credentials = {**credentials, **self.token(result)}
                    # Source controls serialize against token writes and invalidate in-flight reads.
                    async with self.lock:
                        if epoch != self.epoch:
                            raise CalendarError(
                                "Inbox access changed during this request.", "not_enabled", 403
                            )
                        await self.store(identity).write(credentials)
                self.credentials[identity] = credentials
                result = await self.http(
                    "GET", url, params=params, token=credentials["access_token"]
                )
                if epoch != self.epoch:
                    raise CalendarError(
                        "Inbox access changed during this request.", "not_enabled", 403
                    )
                return result
            except CalendarError as exc:
                if exc.code == "reauth_required" and self.account(identity):
                    async with self.lock:
                        accounts = deepcopy(self.data["accounts"])
                        for a in accounts:
                            if a["id"] == identity:
                                a.update(state="reauth_required", error=str(exc))
                        self.commit(accounts=accounts)
                raise

    async def checked(self, identity):
        async with self.lock:
            accounts = deepcopy(self.data["accounts"])
            for account in accounts:
                if account["id"] == identity:
                    account.update(last_checked_at=stamp(), error=None)
            self.commit(accounts=accounts)

    async def end_flow(self):
        self.flow = None
        if self.timer and self.timer is not asyncio.current_task():
            self.timer.cancel()
        self.timer = None
        if self.runner:
            runner, self.runner = self.runner, None
            work = asyncio.create_task(runner.cleanup())
            self.cleanups.add(work)
            work.add_done_callback(self.cleanups.discard)

    async def begin(self):
        if not self.calendar.config() or not self.store("availability").available:
            raise CalendarError("Inbox connection is unavailable in this build.", "not_configured")
        if len(self.data["accounts"]) >= 10:
            raise CalendarError(
                "Remove an inbox before connecting another one.", "account_limit", 400
            )
        await self.end_flow()
        verifier, state = secrets.token_urlsafe(64), secrets.token_urlsafe(32)
        app = web.Application(client_max_size=8192)
        app.router.add_get("/callback", self.callback)
        app.router.add_get("/complete", self.complete)
        self.runner = web.AppRunner(app, access_log=None)
        try:
            await self.runner.setup()
            await web.TCPSite(self.runner, "127.0.0.1", 0).start()
        except Exception:
            await self.end_flow()
            raise CalendarError(
                "The sign-in window could not be opened. Try again.", "loopback_unavailable"
            ) from None
        host = f"127.0.0.1:{self.runner.addresses[0][1]}"
        redirect = f"http://{host}/callback"
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .decode()
            .rstrip("=")
        )
        url = (
            AUTH_URL
            + "?"
            + urlencode(
                {
                    "client_id": self.calendar.config()["client_id"],
                    "redirect_uri": redirect,
                    "response_type": "code",
                    "scope": " ".join(SCOPES),
                    "code_challenge": challenge,
                    "code_challenge_method": "S256",
                    "state": state,
                    "access_type": "offline",
                    "prompt": "consent select_account",
                }
            )
        )
        self.flow = dict(
            state=state,
            verifier=verifier,
            redirect_uri=redirect,
            host=host,
            started=time.time(),
            used=False,
            epoch=self.epoch,
            authorization_url=url,
            success=False,
        )
        self.error = None
        self.commit()

        async def expire(flow):
            await asyncio.sleep(FLOW_SECONDS)
            async with self.lock:
                if self.flow is flow:
                    self.error = "Sign-in timed out. Connect the inbox to try again."
                    await self.end_flow()
                    self.commit()

        self.timer = asyncio.create_task(expire(self.flow))

    async def callback(self, request):
        async with self.lock:
            flow = self.flow
            if (
                not flow
                or flow["used"]
                or time.time() - flow["started"] > FLOW_SECONDS
                or request.host != flow["host"]
                or len(request.query.getall("state", [])) != 1
                or not hmac.compare_digest(request.query.get("state", ""), flow["state"])
            ):
                return web.Response(
                    text="This sign-in is no longer active. Return to eilo.", status=400
                )
            flow["used"] = True
        try:
            codes = request.query.getall("code", [])
            if request.query.get("error") or len(codes) != 1 or not 1 <= len(codes[0]) <= 4096:
                raise CalendarError(
                    "The inbox was not connected. You can try again.", "access_denied", 400
                )
            config = self.calendar.config()
            value = await self.http(
                "POST",
                TOKEN_URL,
                data={
                    **config,
                    "code": codes[0],
                    "code_verifier": flow["verifier"],
                    "redirect_uri": flow["redirect_uri"],
                    "grant_type": "authorization_code",
                },
            )
            token = self.token(value)
            scopes = set(value.get("scope", "").split())
            if "https://www.googleapis.com/auth/userinfo.email" in scopes:
                scopes.add("email")
            if not set(SCOPES).issubset(scopes):
                raise CalendarError(
                    "Reading email was not allowed. Connect again and select that permission.",
                    "missing_permissions",
                    400,
                )
            user = await self.http("GET", USERINFO_URL, token=token["access_token"])
            if (
                not isinstance(user.get("sub"), str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,255}", user["sub"])
                or not isinstance(user.get("email"), str)
                or not 3 <= len(user["email"]) <= 254
                or user.get("email_verified") is not True
            ):
                raise CalendarError("Google did not confirm this account.", "account_identity")
            refresh = value.get("refresh_token")
            if not isinstance(refresh, str) or not 1 <= len(refresh) <= 8192:
                raise CalendarError(
                    "Google did not save ongoing access. Connect again.", "missing_refresh"
                )
            identity = "mail_" + hashlib.sha256(user["sub"].encode()).hexdigest()[:24]
            async with self.lock:
                if self.flow is not flow or self.epoch != flow["epoch"]:
                    return web.Response(text="Sign-in cancelled. Return to eilo.")
                credentials = {
                    **token,
                    "refresh_token": refresh,
                    "client_id": config["client_id"],
                    "sub": user["sub"],
                    "scopes": sorted(scopes),
                }
                previous = await self.store(identity).read()
                await self.store(identity).write(credentials)
                try:
                    accounts = [a for a in self.data["accounts"] if a["id"] != identity]
                    accounts.append(
                        dict(
                            id=identity,
                            sub=user["sub"],
                            email=user["email"],
                            enabled=True,
                            state="connected",
                            last_checked_at=None,
                            error=None,
                        )
                    )
                    self.commit(accounts=accounts)
                except Exception:
                    if previous:
                        await self.store(identity).write(previous)
                    else:
                        await self.store(identity).delete()
                    raise
                self.credentials[identity] = credentials
                flow["success"] = True
        except Exception as exc:
            async with self.lock:
                if self.flow is flow:
                    self.error = (
                        str(exc)
                        if isinstance(exc, CalendarError)
                        else "Sign-in could not be saved. Try again."
                    )
                    self.commit()
        raise web.HTTPSeeOther("/complete")

    async def complete(self, request):
        flow = self.flow
        if not flow or request.host != flow["host"]:
            raise web.HTTPNotFound()
        message = (
            "Your inbox is connected. Return to eilo and ask for a catch-up. You can close this tab."
            if flow["success"]
            else "The inbox was not connected. Return to eilo to try again."
        )

        async def finish():
            await asyncio.sleep(1)
            async with self.lock:
                if self.flow is flow:
                    await self.end_flow()
                    self.on_change()

        work = asyncio.create_task(finish())
        self.cleanups.add(work)
        work.add_done_callback(self.cleanups.discard)
        return web.Response(
            text=message,
            headers={
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
                "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
            },
        )

    async def control(self, body):
        expected = {
            "connect_gmail": {"allow_model"},
            "cancel_gmail": set(),
            "set_mail_enabled": {"account_id", "enabled"},
            "remove_gmail": {"account_id"},
            "set_calendar_enabled": {"enabled"},
        }
        if (
            not isinstance(body, dict)
            or body.get("action") not in expected
            or set(body) != {"action", "based_on_revision"} | expected[body["action"]]
        ):
            raise CalendarError("That source request is incomplete.", "invalid_request", 400)
        async with self.lock:
            if (
                type(body["based_on_revision"]) is not int
                or body["based_on_revision"] != self.data["revision"]
            ):
                raise CalendarError(
                    "Source settings changed. Review them and try again.", "conflict", 409
                )
            action = body["action"]
            if action == "connect_gmail":
                if body["allow_model"] is not True:
                    raise CalendarError(
                        "Allow relevant email excerpts in answers before connecting.",
                        "consent_required",
                        400,
                    )
                self.epoch += 1
                await self.begin()
            elif action == "cancel_gmail":
                self.epoch += 1
                await self.end_flow()
                self.commit()
            elif action == "set_calendar_enabled":
                if type(body["enabled"]) is not bool:
                    raise CalendarError(
                        "Choose whether calendar details may be used.", "invalid_request", 400
                    )
                account = self.calendar.data.get("account")
                if body["enabled"] and not self.snapshot()["calendar"]["available"]:
                    raise CalendarError("Connect and select calendars first.", "not_available", 400)
                self.epoch += 1
                self.commit(calendar_sub=account["sub"] if body["enabled"] else None)
            else:
                identity = body["account_id"]
                if not isinstance(identity, str) or not self.account(identity):
                    raise CalendarError("That inbox is no longer connected.", "not_found", 404)
                if action == "set_mail_enabled" and type(body["enabled"]) is not bool:
                    raise CalendarError("Choose whether to use this inbox.", "invalid_request", 400)
                self.epoch += 1
                accounts = deepcopy(self.data["accounts"])
                if action == "remove_gmail":
                    await self.store(
                        identity
                    ).delete()  # Local removal; provider revocation would also affect Calendar.
                    self.credentials.pop(identity, None)
                    accounts = [a for a in accounts if a["id"] != identity]
                else:
                    for a in accounts:
                        if a["id"] == identity:
                            a["enabled"] = body["enabled"]
                            if a["state"] != "reauth_required":
                                a["state"] = "connected" if body["enabled"] else "paused"
                self.commit(accounts=accounts)
            return self.snapshot(True)

    async def calendar_disconnected(self, sub):
        # Google's project-level revocation can invalidate both grants for this account.
        async with self.lock:
            self.epoch += 1
            accounts = deepcopy(self.data["accounts"])
            for account in accounts:
                if account["sub"] == sub:
                    account.update(
                        state="reauth_required",
                        error="Google access was removed when Calendar disconnected. Reconnect this inbox to continue.",
                    )
                    self.credentials.pop(account["id"], None)
            self.commit(accounts=accounts, calendar_sub=None)

    async def close(self):
        self.epoch += 1
        await self.end_flow()
        if self.cleanups:
            await asyncio.gather(*self.cleanups, return_exceptions=True)
        self.credentials.clear()
