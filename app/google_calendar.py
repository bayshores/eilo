"""One opt-in Google Calendar connection; credentials never enter app snapshots."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import re
import secrets
import sys
import time
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode, urlsplit

import aiohttp
from aiohttp import web

from app.calendar_source import CalendarSourceError, fetch_calendars, fetch_events
from app.persistence import write_private

SCOPES = (
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
)
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
FLOW_SECONDS = 300
SYNC_SECONDS = 300


class CalendarError(Exception):
    def __init__(self, message, code="unavailable", status=503):
        super().__init__(message)
        self.code, self.status = code, status


async def _read_bounded_body(content, limit=2_000_000):
    """Read through EOF: aiohttp read(n) may return only an available fragment."""
    chunks = []
    total = 0
    async for chunk in content.iter_chunked(65_536):
        total += len(chunk)
        if total > limit:
            raise CalendarError(
                "This calendar response is too large. Choose fewer calendars.", "response_size"
            )
        chunks.append(chunk)
    return b"".join(chunks)


class MacCredentialStore:
    """Explicit macOS Keychain backend; no automatic plaintext fallback."""

    def __init__(self, root, *, namespace="calendar", account="google"):
        self.account = account
        self.service = (
            "app.eilo."
            + namespace
            + "."
            + hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:16]
        )
        self.backend = None
        self.operations = asyncio.Lock()
        if sys.platform == "darwin":
            try:
                from keyring.backends.macOS import Keyring

                self.backend = Keyring()
            except ImportError:
                pass

    @property
    def available(self):
        return self.backend is not None

    async def _operate(self, function, *args):
        # Cancellation must not leave a Keychain write racing a later disconnect.
        async with self.operations:
            work = asyncio.create_task(asyncio.to_thread(function, *args))
            try:
                return await asyncio.shield(work)
            except asyncio.CancelledError:
                await work
                raise

    async def read(self):
        if not self.available:
            raise CalendarError(
                "Secure sign-in storage is unavailable. Reopen eïlo after updating the app.",
                "secure_storage",
            )
        try:
            raw = await self._operate(self.backend.get_password, self.service, self.account)
            return json.loads(raw) if raw else None
        except Exception as exc:
            raise CalendarError(
                "Unlock your Mac's keychain, then reconnect Google Calendar.", "secure_storage"
            ) from exc

    async def write(self, value):
        if not self.available:
            raise CalendarError("Secure sign-in storage is unavailable.", "secure_storage")
        try:
            await self._operate(
                self.backend.set_password, self.service, self.account, json.dumps(value)
            )
        except Exception as exc:
            raise CalendarError(
                "eïlo couldn't save the sign-in securely. Unlock your Mac's keychain and try again.",
                "secure_storage",
            ) from exc

    async def delete(self):
        if not self.available:
            raise CalendarError(
                "Unlock your Mac's keychain to remove this saved sign-in.", "secure_storage"
            )
        try:
            from keyring.errors import PasswordDeleteError

            try:
                await self._operate(self.backend.delete_password, self.service, self.account)
            except PasswordDeleteError:
                # Treat only a confirmed missing item as already removed.
                if await self.read() is not None:
                    raise
        except Exception as exc:
            raise CalendarError(
                "eïlo couldn't remove the saved sign-in. Unlock your Mac's keychain and try again.",
                "secure_storage",
            ) from exc


def empty_state():
    return {
        "schema_version": 1,
        "revision": 0,
        "state": "disconnected",
        "account": None,
        "calendars": [],
        "selected_ids": [],
        "events": [],
        "last_synced_at": None,
        "error": None,
    }


def valid_saved_state(value):
    if not isinstance(value, dict) or set(value) != set(empty_state()):
        return False
    if (
        value["schema_version"] != 1
        or type(value["revision"]) is not int
        or value["revision"] < 0
        or value["state"]
        not in (
            "disconnected",
            "authorizing",
            "choosing",
            "connected",
            "paused",
            "reauth_required",
            "error",
        )
    ):
        return False
    account = value["account"]
    if account is not None and (
        not isinstance(account, dict)
        or set(account) != {"sub", "email"}
        or any(not isinstance(account[k], str) or not 1 <= len(account[k]) <= 255 for k in account)
    ):
        return False
    calendars, ids, events = value["calendars"], value["selected_ids"], value["events"]
    if (
        not isinstance(calendars, list)
        or len(calendars) > 100
        or not isinstance(ids, list)
        or len(ids) > 10
        or not isinstance(events, list)
        or len(events) > 1000
    ):
        return False
    for item in calendars:
        if (
            not isinstance(item, dict)
            or any(
                not isinstance(item.get(k), str) or not 1 <= len(item[k]) <= 1024
                for k in ("id", "name")
            )
            or type(item.get("primary")) is not bool
            or type(item.get("selected")) is not bool
        ):
            return False
    known = {item["id"] for item in calendars}
    if any(not isinstance(item, str) or item not in known for item in ids) or len(set(ids)) != len(
        ids
    ):
        return False
    for item in events:
        if (
            not isinstance(item, dict)
            or any(
                not isinstance(item.get(k), str) or not 1 <= len(item[k]) <= 2048
                for k in ("id", "calendar_id", "calendar_name", "title", "start", "end")
            )
            or type(item.get("all_day")) is not bool
            or item["calendar_id"] not in ids
        ):
            return False
        try:
            for key in ("start", "end"):
                stamp = datetime.fromisoformat(item[key].replace("Z", "+00:00"))
                if not item["all_day"] and stamp.tzinfo is None:
                    return False
        except ValueError:
            return False
    stamp = value["last_synced_at"]
    if stamp is not None:
        try:
            if not isinstance(stamp, str) or datetime.fromisoformat(stamp).tzinfo is None:
                return False
        except ValueError:
            return False
    error = value["error"]
    if error is not None and (
        not isinstance(error, dict)
        or any(not isinstance(error.get(k), str) for k in ("code", "message"))
        or type(error.get("retryable")) is not bool
    ):
        return False
    return True


def valid_credentials(value):
    return (
        isinstance(value, dict)
        and all(
            isinstance(value.get(k), str) and 1 <= len(value[k]) <= 8192
            for k in ("client_id", "sub", "refresh_token", "access_token")
        )
        and type(value.get("expires_at")) in (int, float)
        and 0 < value["expires_at"] < 1e12
    )


class GoogleCalendarConnection:
    def __init__(
        self, root, *, on_change=lambda: None, store=None, transport=None, clock=time.time
    ):
        self.root, self.clock, self.on_change = Path(root), clock, on_change
        self.path = self.root / ".state/google-calendar.json"
        self.config_path = self.root / ".state/google-calendar-client.json"
        self.store = store if store is not None else MacCredentialStore(self.root)
        self.transport = transport
        self.data = empty_state()
        if self.path.exists():
            try:
                if self.path.stat().st_size > 2_000_000:
                    raise ValueError("invalid state")
                saved = json.loads(self.path.read_text())
                if valid_saved_state(saved):
                    self.data.update(saved)
                    if self.data["state"] == "authorizing":
                        self.data["state"] = (
                            "reauth_required" if self.data["account"] else "disconnected"
                        )
                else:
                    raise ValueError("invalid state")
            except (ValueError, OSError):
                self.data["error"] = {
                    "code": "local_state",
                    "message": "Calendar setup needs to be connected again.",
                    "retryable": True,
                }
        self.lock = asyncio.Lock()
        self.epoch = 0
        self.credentials = None
        self.flow = None
        self.runner = None
        self.flow_timer = None
        self.worker = None
        self.loop_task = None
        self.syncing = False
        self.loading_calendars = False
        self.closed = False
        self.next_sync = 0
        self.failures = 0
        self.cleanups = set()
        self.choice_return = "paused"

    def config(self):
        try:
            value = json.loads(self.config_path.read_text())
            value = value.get("installed", value)
            client = value.get("client_id", "")
            if not re.fullmatch(r"[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com", client):
                return None
            secret = value.get("client_secret")
            if secret is not None and (not isinstance(secret, str) or not 1 <= len(secret) <= 300):
                return None
            return {"client_id": client, **({"client_secret": secret} if secret else {})}
        except (ValueError, OSError, TypeError, AttributeError):
            return None

    def snapshot(self, *, include_authorization=False):
        value = deepcopy(self.data)
        if value.get("account"):
            value["account"] = {"email": value["account"].get("email", "")}
        value.update(
            configured=bool(self.config()),
            available=self.store.available,
            syncing=self.syncing,
            loading_calendars=self.loading_calendars,
        )
        if not value["configured"] or not value["available"]:
            value["state"] = "unavailable"
        if include_authorization and self.flow and not self.flow["used"]:
            value["authorization_url"] = self.flow.get("authorization_url", "")
        return value

    def _commit(self, **changes):
        candidate = deepcopy(self.data)
        candidate.update(changes)
        candidate["revision"] = self.data["revision"] + 1
        write_private(self.path, candidate)
        self.data = candidate
        self.on_change()

    async def _http(self, method, url, *, params=None, data=None, token=None):
        allowed = url in (TOKEN_URL, REVOKE_URL, USERINFO_URL) or url.startswith(
            "https://www.googleapis.com/calendar/v3/"
        )
        if not allowed or urlsplit(url).username or urlsplit(url).fragment:
            raise CalendarError("Calendar request could not be prepared.", "invalid_request", 400)
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
                    if response.status in (401, 403):
                        raise CalendarError(
                            "Google access needs attention. Reconnect Calendar and allow calendar reading.",
                            "reauth_required",
                            401,
                        )
                    if response.status in (429, 500, 502, 503, 504):
                        raise CalendarError(
                            "Google is temporarily unavailable. eïlo will try syncing again.",
                            "temporary",
                        )
                    try:
                        result = json.loads(raw) if raw else {}
                    except ValueError as exc:
                        raise CalendarError(
                            "Google returned an incomplete response. Try again.", "temporary"
                        ) from exc
                    if response.status >= 400:
                        if result.get("error") == "invalid_grant":
                            raise CalendarError(
                                "This Google sign-in expired or was removed. Reconnect Calendar.",
                                "reauth_required",
                                401,
                            )
                        raise CalendarError(
                            "Google couldn't finish that request. Try again or reconnect Calendar.",
                            "google_request",
                        )
                    if response.status >= 300 or not isinstance(result, dict):
                        raise CalendarError(
                            "Google returned an unexpected response. Try again.", "temporary"
                        )
                    return result
        except (TimeoutError, aiohttp.ClientError) as exc:
            raise CalendarError(
                "Can't reach Google. Check your connection; your last synced calendar is kept.",
                "offline",
            ) from exc

    async def _credentials(self):
        if self.credentials is None:
            self.credentials = await self.store.read()
        credentials = self.credentials
        config = self.config()
        if (
            not valid_credentials(credentials)
            or not config
            or credentials.get("client_id") != config["client_id"]
            or credentials.get("sub") != (self.data.get("account") or {}).get("sub")
        ):
            raise CalendarError(
                "Reconnect Google Calendar to continue syncing.", "reauth_required", 401
            )
        if credentials.get("expires_at", 0) <= self.clock() + 60:
            epoch = self.epoch
            result = await self._http(
                "POST",
                TOKEN_URL,
                data={
                    **config,
                    "grant_type": "refresh_token",
                    "refresh_token": credentials["refresh_token"],
                },
            )
            if epoch != self.epoch:
                raise asyncio.CancelledError()
            token = self._token(result)
            credentials = {**credentials, **token}
            await self.store.write(credentials)
            self.credentials = credentials
        return credentials

    def _token(self, result):
        access = result.get("access_token")
        expires = result.get("expires_in")
        if (
            not isinstance(access, str)
            or not 1 <= len(access) <= 8192
            or result.get("token_type", "").lower() != "bearer"
            or type(expires) not in (int, float)
            or not 0 < expires <= 86400
        ):
            raise CalendarError(
                "Google didn't complete sign-in. Please reconnect Calendar.", "invalid_token"
            )
        return {"access_token": access, "expires_at": self.clock() + expires}

    async def _get(self, url, params=None):
        credentials = await self._credentials()
        return await self._http("GET", url, params=params, token=credentials["access_token"])

    def _stop_worker(self):
        self.epoch += 1
        if self.worker and not self.worker.done():
            self.worker.cancel()
        self.worker = None
        self.syncing = self.loading_calendars = False

    def _launch(self, kind):
        self._stop_worker()
        epoch = self.epoch
        self.syncing = True
        self.loading_calendars = kind == "calendars"
        self.worker = asyncio.create_task(self._run(kind, epoch))
        self.on_change()

    async def _run(self, kind, epoch):
        try:
            if kind == "calendars":
                calendars = await fetch_calendars(self._get)
                async with self.lock:
                    if epoch != self.epoch:
                        return
                    chosen = [
                        item
                        for item in self.data["selected_ids"]
                        if any(c["id"] == item for c in calendars)
                    ]
                    self._commit(
                        calendars=[{**c, "selected": c["id"] in chosen} for c in calendars],
                        selected_ids=chosen,
                        events=[
                            event for event in self.data["events"] if event["calendar_id"] in chosen
                        ],
                        error=None,
                    )
            else:
                events = await fetch_events(
                    self._get, deepcopy(self.data["calendars"]), list(self.data["selected_ids"])
                )
                async with self.lock:
                    if epoch != self.epoch:
                        return
                    self._commit(
                        events=events,
                        last_synced_at=datetime.now(UTC).isoformat(),
                        error=None,
                        state="connected",
                    )
            self.failures = 0
        except asyncio.CancelledError:
            return
        except Exception as exc:
            error = (
                exc
                if isinstance(exc, (CalendarError, CalendarSourceError))
                else CalendarError("Calendar couldn't finish syncing. Try again.", "temporary")
            )
            async with self.lock:
                if epoch != self.epoch:
                    return
                code = getattr(error, "code", None) or "calendar_data"
                state = "reauth_required" if code == "reauth_required" else self.data["state"]
                self._commit(
                    state=state, error={"code": code, "message": str(error), "retryable": True}
                )
                self.failures += 1
        finally:
            if epoch == self.epoch:
                self.syncing = self.loading_calendars = False
                self.next_sync = self.clock() + min(3600, SYNC_SECONDS * 2 ** min(self.failures, 3))
                self.on_change()

    async def start(self):
        if self.loop_task is None:
            self.loop_task = asyncio.create_task(self._loop())

    async def _loop(self):
        while not self.closed:
            if (
                self.config()
                and self.store.available
                and self.data["state"] == "connected"
                and self.data["selected_ids"]
                and not self.syncing
                and self.clock() >= self.next_sync
            ):
                async with self.lock:
                    if not self.closed and self.data["state"] == "connected" and not self.syncing:
                        self._launch("events")
            await asyncio.sleep(5)

    async def close(self):
        self.closed = True
        work = self.worker
        self._stop_worker()
        if work:
            await asyncio.gather(work, return_exceptions=True)
        if self.loop_task:
            self.loop_task.cancel()
            await asyncio.gather(self.loop_task, return_exceptions=True)
        await self._end_flow()
        if self.cleanups:
            await asyncio.gather(*self.cleanups, return_exceptions=True)

    async def _end_flow(self):
        self.flow = None
        if self.flow_timer:
            if self.flow_timer is not asyncio.current_task():
                self.flow_timer.cancel()
            self.flow_timer = None
        if self.runner:
            runner, self.runner = self.runner, None
            work = asyncio.create_task(runner.cleanup())
            self.cleanups.add(work)
            work.add_done_callback(self.cleanups.discard)

    async def _expire_flow(self, identity):
        await asyncio.sleep(FLOW_SECONDS)
        async with self.lock:
            if self.flow and self.flow["state"] == identity:
                self._commit(
                    state="reauth_required" if self.data["account"] else "disconnected",
                    error={
                        "code": "sign_in_expired",
                        "message": "Sign-in timed out. Connect Google Calendar to try again.",
                        "retryable": True,
                    },
                )
                await self._end_flow()

    async def _begin(self):
        if not self.config() or not self.store.available:
            raise CalendarError(
                "Google Calendar is not available in this build yet.", "not_configured"
            )
        if self.data["state"] in ("connected", "paused"):
            raise CalendarError(
                "Disconnect this Google account before connecting another one.",
                "already_connected",
                409,
            )
        self._stop_worker()
        await self._end_flow()
        verifier = secrets.token_urlsafe(64)
        state = secrets.token_urlsafe(32)
        application = web.Application(client_max_size=8192)
        application.router.add_get("/callback", self._callback)
        application.router.add_get("/complete", self._complete)
        self.runner = web.AppRunner(application, access_log=None)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        port = self.runner.addresses[0][1]
        self.flow = {
            "state": state,
            "verifier": verifier,
            "redirect_uri": f"http://127.0.0.1:{port}/callback",
            "host": f"127.0.0.1:{port}",
            "epoch": self.epoch,
            "used": False,
            "started": self.clock(),
        }
        self.flow_timer = asyncio.create_task(self._expire_flow(state))
        self._commit(state="authorizing", error=None)
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
                    "client_id": self.config()["client_id"],
                    "redirect_uri": self.flow["redirect_uri"],
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
        self.flow["authorization_url"] = url
        return url

    async def _callback(self, request):
        async with self.lock:
            flow = self.flow
            if (
                not flow
                or flow["used"]
                or self.clock() - flow["started"] > FLOW_SECONDS
                or request.host != flow["host"]
                or len(request.query.getall("state", [])) != 1
                or not hmac.compare_digest(request.query.get("state", ""), flow["state"])
            ):
                return web.Response(
                    text="This sign-in link is no longer active. Return to eïlo and connect again.",
                    status=400,
                )
            flow["used"] = True
            if request.query.get("error"):
                self._commit(
                    state="reauth_required" if self.data["account"] else "disconnected",
                    error={
                        "code": "access_denied",
                        "message": "Google wasn't connected. You can try again whenever you're ready.",
                        "retryable": True,
                    },
                )
                raise web.HTTPSeeOther("/complete")
            codes = request.query.getall("code", [])
            if len(codes) != 1 or not 1 <= len(codes[0]) <= 4096:
                self._commit(
                    state="reauth_required" if self.data["account"] else "disconnected",
                    error={
                        "code": "invalid_callback",
                        "message": "Google didn't finish sign-in. Try connecting again.",
                        "retryable": True,
                    },
                )
                raise web.HTTPSeeOther("/complete")
            epoch = flow["epoch"]
        try:
            config = self.config()
            result = await self._http(
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
            token = self._token(result)
            granted = set(result.get("scope", "").split())
            if "https://www.googleapis.com/auth/userinfo.email" in granted:
                granted.add("email")
            if not set(SCOPES).issubset(granted):
                raise CalendarError(
                    "Calendar reading wasn't allowed. Connect again and allow both calendar permissions.",
                    "missing_permissions",
                    400,
                )
            user = await self._http("GET", USERINFO_URL, token=token["access_token"])
            if (
                not isinstance(user.get("sub"), str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,255}", user["sub"])
                or not isinstance(user.get("email"), str)
                or not 3 <= len(user["email"]) <= 254
                or user.get("email_verified") is not True
            ):
                raise CalendarError(
                    "Google didn't confirm the account. Please reconnect Calendar.",
                    "account_identity",
                )
            refresh = result.get("refresh_token")
            if not isinstance(refresh, str) or not 1 <= len(refresh) <= 8192:
                raise CalendarError(
                    "Google didn't save ongoing access. Please connect again.", "missing_refresh"
                )
            async with self.lock:
                if epoch != self.epoch or self.flow is not flow:
                    return web.Response(text="Sign-in was cancelled. Return to eïlo.")
                previous = await self.store.read()
                credentials = {
                    **token,
                    "refresh_token": refresh,
                    "client_id": config["client_id"],
                    "sub": user["sub"],
                }
                await self.store.write(credentials)
                same = (self.data.get("account") or {}).get("sub") == user["sub"]
                try:
                    self._commit(
                        state="choosing",
                        account={"sub": user["sub"], "email": user["email"]},
                        calendars=self.data["calendars"] if same else [],
                        selected_ids=self.data["selected_ids"] if same else [],
                        events=[],
                        last_synced_at=None,
                        error=None,
                    )
                except Exception:
                    if previous is not None:
                        await self.store.write(previous)
                    else:
                        await self.store.delete()
                    raise
                self.credentials = credentials
                if self.flow_timer:
                    self.flow_timer.cancel()
                    self.flow_timer = None
                self._launch("calendars")
        except Exception as exc:
            async with self.lock:
                if epoch == self.epoch:
                    error = (
                        exc
                        if isinstance(exc, CalendarError)
                        else CalendarError(
                            "Google sign-in couldn't be saved. Please try again.", "sign_in_failed"
                        )
                    )
                    self._commit(
                        state="reauth_required" if self.data["account"] else "disconnected",
                        error={"code": error.code, "message": str(error), "retryable": True},
                    )
        raise web.HTTPSeeOther("/complete")

    async def _complete(self, request):
        if not self.flow or request.host != self.flow["host"]:
            raise web.HTTPNotFound()
        successful = self.data["state"] in ("choosing", "connected")
        title = "You're connected to Google" if successful else "Return to eïlo to continue"
        message = (
            "Choose the calendars you want in eïlo. You can close this tab."
            if successful
            else "Your calendar has not been added. You can try again in eïlo whenever you're ready."
        )

        async def finish(flow):
            await asyncio.sleep(1)
            async with self.lock:
                if self.flow is flow:
                    await self._end_flow()

        work = asyncio.create_task(finish(self.flow))
        self.cleanups.add(work)
        work.add_done_callback(self.cleanups.discard)
        style = "html{color-scheme:dark;background:#191a1d;color:#f1f0ed;font:17px/1.5 system-ui,sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center}main{max-width:34rem;margin:2rem;padding:2.5rem;border-radius:24px;background:#292b30}h1{font-size:28px;font-weight:550;line-height:1.2}p{color:#c7c7cd}.brand{color:#fac8a3;font-size:24px}"
        digest = base64.b64encode(hashlib.sha256(style.encode()).digest()).decode()
        return web.Response(
            text=f"<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width'><title>{title}</title><style>{style}</style><main><div class=brand>eïlo</div><h1>{title}</h1><p>{message}</p></main></html>",
            content_type="text/html",
            headers={
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
                "Content-Security-Policy": f"default-src 'none'; style-src 'sha256-{digest}'; frame-ancestors 'none'; base-uri 'none'",
            },
        )

    async def control(self, body):
        if (
            not isinstance(body, dict)
            or set(body)
            not in (
                {"action", "based_on_revision"},
                {"action", "based_on_revision", "calendar_ids"},
            )
            or type(body.get("based_on_revision")) is not int
        ):
            raise CalendarError(
                "That calendar request was incomplete. Try again.", "invalid_request", 400
            )
        async with self.lock:
            if body["based_on_revision"] != self.data["revision"]:
                raise CalendarError(
                    "Calendar setup changed. Review the current connection and try again.",
                    "conflict",
                    409,
                )
            action = body.get("action")
            if (
                action == "cancel"
                and self.data["state"] == "choosing"
                and self.data["account"]
                and not self.data["selected_ids"]
            ):
                action = "disconnect"
            if action == "begin":
                url = await self._begin()
                return {**self.snapshot(), "authorization_url": url}
            if action == "cancel":
                was_authorizing = self.data["state"] == "authorizing"
                self._stop_worker()
                await self._end_flow()
                state = (
                    ("reauth_required" if self.data["account"] else "disconnected")
                    if was_authorizing
                    else self.choice_return
                    if self.data["selected_ids"]
                    else "choosing"
                    if self.data["account"]
                    else "disconnected"
                )
                self._commit(state=state, error=None)
            elif action == "disconnect":
                self._stop_worker()
                await self._end_flow()
                self._commit(state="paused" if self.data["account"] else "disconnected", error=None)
                credentials = self.credentials or (
                    await self.store.read() if self.data["account"] else None
                )
                await self.store.delete()
                self.credentials = None
                cleared = empty_state()
                cleared.pop("revision")
                self._commit(**cleared)
                if valid_credentials(credentials):
                    try:
                        await asyncio.wait_for(
                            self._http(
                                "POST", REVOKE_URL, data={"token": credentials["refresh_token"]}
                            ),
                            5,
                        )
                    except (TimeoutError, CalendarError):
                        self._commit(
                            error={
                                "code": "revoke_offline",
                                "message": "Disconnected on this Mac. Google couldn't be reached to remove its permission; you can also remove eïlo in your Google Account connections.",
                                "retryable": False,
                            }
                        )
            elif action == "retry":
                if (
                    self.data["state"] != "reauth_required"
                    or not self.data["account"]
                    or not self.data["selected_ids"]
                ):
                    raise CalendarError(
                        "Connect Google Calendar and choose calendars first.",
                        "reauth_required",
                        409,
                    )
                if not self.syncing:
                    # Recheck the existing grant, never create one or claim success
                    # before Google accepts reads of the previously chosen sources.
                    self.credentials = None
                    self._launch("events")
            elif action in ("save_selection", "sync", "pause", "resume", "calendars"):
                if not self.data["account"] or self.data["state"] in (
                    "authorizing",
                    "reauth_required",
                ):
                    raise CalendarError("Connect Google Calendar first.", "reauth_required", 409)
                if action == "save_selection":
                    ids = body.get("calendar_ids")
                    known = {item["id"] for item in self.data["calendars"]}
                    if (
                        self.loading_calendars
                        or not isinstance(ids, list)
                        or not 1 <= len(ids) <= 10
                        or any(not isinstance(item, str) or item not in known for item in ids)
                        or len(ids) != len(set(ids))
                    ):
                        raise CalendarError(
                            "Choose between one and ten available calendars, then save.",
                            "selection",
                            400,
                        )
                    self._commit(
                        state="connected",
                        selected_ids=ids,
                        calendars=[
                            {**c, "selected": c["id"] in ids} for c in self.data["calendars"]
                        ],
                        events=[
                            event for event in self.data["events"] if event["calendar_id"] in ids
                        ],
                        error=None,
                    )
                    self._launch("events")
                elif action == "pause":
                    self._stop_worker()
                    self._commit(state="paused", error=None)
                elif action == "calendars":
                    self.choice_return = (
                        "connected" if self.data["state"] == "connected" else "paused"
                    )
                    self._commit(state="choosing", error=None)
                    self._launch("calendars")
                else:
                    if action == "sync" and self.data["state"] != "connected":
                        raise CalendarError("Resume calendar sync first.", "paused", 409)
                    if not self.data["selected_ids"]:
                        raise CalendarError(
                            "Choose your calendars before syncing.", "selection", 400
                        )
                    if action == "resume":
                        self._commit(state="connected", error=None)
                    if not self.syncing:
                        self._launch("events")
            else:
                raise CalendarError("Choose a supported calendar action.", "invalid_request", 400)
            return self.snapshot()
