"""Bounded, read-only normalization for the Google Calendar v3 API.

This module deliberately keeps no token, sync token, or snapshot state.  The
caller supplies an authenticated async ``request(url, params=None)`` function
and commits a returned list only after the entire call succeeds.  Windows are
UTC: from 00:00:00 UTC on ``now``'s UTC date through (exclusive) 30 days later.
"""

from __future__ import annotations

import hashlib
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

API_ROOT = "https://www.googleapis.com/calendar/v3"
MAX_CALENDAR_PAGES = 20
MAX_CALENDARS = 100
MAX_SELECTED_CALENDARS = 10
MAX_EVENT_PAGES = 20
MAX_EVENTS = 1000
_READABLE_ROLES = {"reader", "writer", "writerWithoutPrivateAccess", "owner"}
_SAFE_TRANSPORT_CODES = frozenset({"reauth_required", "offline", "temporary"})
_MAX_ID_LENGTH = 1024
_MAX_PAGE_TOKEN_LENGTH = 4096
_CALENDAR_FIELDS = "kind,nextPageToken,items(id,summary,summaryOverride,primary,accessRole)"
_EVENT_FIELDS = "kind,nextPageToken,items(id,status,summary,start(date,dateTime),end(date,dateTime),attendees(self,responseStatus))"

Request = Callable[[str, Mapping[str, str] | None], Awaitable[dict[str, Any]]]


class CalendarSourceError(RuntimeError):
    """A safe, user-facing failure; callers should retain their old snapshot."""

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


def _clean_text(value: object, fallback: str, limit: int = 200) -> str:
    if not isinstance(value, str):
        return fallback
    cleaned = " ".join(
        "".join(
            "" if ord(character) < 32 or ord(character) == 127 else character for character in value
        ).split()
    )
    return cleaned[:limit] or fallback


def _calendar_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if (
        not value
        or len(value) > _MAX_ID_LENGTH
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        return None
    return value


async def _get(request: Request, url: str, params: Mapping[str, str] | None) -> dict[str, Any]:
    try:
        response = await request(url, params=params)
    except CalendarSourceError:
        raise
    except Exception as exc:  # The adapter must not expose token/network internals.
        code = getattr(exc, "code", None)
        safe_code = code if isinstance(code, str) and code in _SAFE_TRANSPORT_CODES else None
        raise CalendarSourceError(
            "Calendar could not be read. Please try reconnecting it.", safe_code
        ) from exc
    if not isinstance(response, dict):
        raise CalendarSourceError("Calendar returned an invalid response. Please try again.")
    return response


def _page_items(response: Mapping[str, Any], label: str, expected_kind: str) -> list[object]:
    items = response.get("items", None)
    if items is None and response.get("kind") == expected_kind:
        return []
    if not isinstance(items, list):
        raise CalendarSourceError(
            f"Calendar returned an incomplete {label} response. Please try again."
        )
    return items


def _next_token(response: Mapping[str, Any], kind: str) -> str | None:
    token = response.get("nextPageToken")
    if token is None:
        return None
    if (
        not isinstance(token, str)
        or not token
        or len(token) > _MAX_PAGE_TOKEN_LENGTH
        or any(ord(character) < 32 or ord(character) == 127 for character in token)
    ):
        raise CalendarSourceError(
            f"Calendar returned an invalid {kind} page token. Please try again."
        )
    return token


async def fetch_calendars(request: Request) -> list[dict[str, object]]:
    """List at most 100 calendars for which the user has reader-or-better access."""
    result: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    page_token: str | None = None
    seen_tokens: set[str] = set()

    for _ in range(MAX_CALENDAR_PAGES):
        params: dict[str, str] = {"maxResults": "250", "fields": _CALENDAR_FIELDS}
        if page_token is not None:
            params["pageToken"] = page_token
        response = await _get(request, f"{API_ROOT}/users/me/calendarList", params)
        for item in _page_items(response, "calendar list", "calendar#calendarList"):
            if not isinstance(item, dict):
                continue  # A malformed individual calendar cannot safely be selected.
            calendar_id = _calendar_id(item.get("id"))
            if calendar_id is None or item.get("accessRole") not in _READABLE_ROLES:
                continue
            if calendar_id in seen_ids:
                continue
            seen_ids.add(calendar_id)
            result.append(
                {
                    "id": calendar_id,
                    "name": _clean_text(
                        item.get("summaryOverride") or item.get("summary"), "Untitled calendar"
                    ),
                    "primary": item.get("primary") is True,
                    "selected": False,
                }
            )
            if len(result) > MAX_CALENDARS:
                raise CalendarSourceError(
                    "More than 100 readable calendars were found. Narrow the connected account first."
                )
        next_token = _next_token(response, "calendar list")
        if next_token is None:
            return result
        if next_token in seen_tokens:
            raise CalendarSourceError(
                "Calendar pagination repeated unexpectedly. Please try again."
            )
        seen_tokens.add(next_token)
        page_token = next_token

    raise CalendarSourceError(
        "Calendar list exceeded the 20-page safety limit. Please narrow the connected account first."
    )


def _window(now: datetime | None) -> tuple[datetime, datetime]:
    current = now or datetime.now(UTC)
    if current.tzinfo is None or current.utcoffset() is None:
        raise CalendarSourceError("Calendar refresh needs a time with a timezone.")
    start = datetime.combine(current.astimezone(UTC).date(), datetime.min.time(), tzinfo=UTC)
    return start, start + timedelta(days=30)


def _rfc3339(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _parse_timed(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.isoformat()


def _normalize_event(event: object, calendar: Mapping[str, object]) -> dict[str, object] | None:
    if not isinstance(event, dict) or event.get("status") == "cancelled":
        return None
    attendees = event.get("attendees")
    if isinstance(attendees, list) and any(
        isinstance(attendee, dict)
        and attendee.get("self") is True
        and attendee.get("responseStatus") == "declined"
        for attendee in attendees
    ):
        return None
    provider_id = _calendar_id(event.get("id"))
    start_value = event.get("start")
    end_value = event.get("end")
    if provider_id is None or not isinstance(start_value, dict) or not isinstance(end_value, dict):
        return None
    start_date, end_date = start_value.get("date"), end_value.get("date")
    if isinstance(start_date, str) or isinstance(end_date, str):
        if not isinstance(start_date, str) or not isinstance(end_date, str):
            return None
        try:
            if (
                datetime.fromisoformat(start_date).date().isoformat() != start_date
                or datetime.fromisoformat(end_date).date().isoformat() != end_date
            ):
                return None
        except ValueError:
            return None
        if end_date <= start_date:  # Google all-day ends are exclusive.
            return None
        start, end, all_day = start_date, end_date, True
    else:
        start, end = (
            _parse_timed(start_value.get("dateTime")),
            _parse_timed(end_value.get("dateTime")),
        )
        if start is None or end is None:
            return None
        if datetime.fromisoformat(end) <= datetime.fromisoformat(start):
            return None
        all_day = False
    calendar_id = str(calendar["id"])
    calendar_hash = hashlib.sha256(calendar_id.encode("utf-8")).hexdigest()[:16]
    return {
        "id": f"gcal:{calendar_hash}:{provider_id}",
        "calendar_id": calendar_id,
        "calendar_name": str(calendar["name"]),
        "title": _clean_text(event.get("summary"), "Untitled event"),
        "start": start,
        "end": end,
        "all_day": all_day,
    }


async def fetch_events(
    request: Request,
    calendars: Sequence[Mapping[str, object]],
    selected_ids: Sequence[str],
    now: datetime | None = None,
) -> list[dict[str, object]]:
    """Fetch a complete UTC 30-day snapshot for up to ten known calendars.

    Invalid individual event records are skipped.  Invalid collection responses,
    repeated pagination, or bounded-result overflow fail the whole call.
    """
    if not isinstance(selected_ids, Sequence) or isinstance(selected_ids, (str, bytes)):
        raise CalendarSourceError("Calendar selection is invalid. Please choose calendars again.")
    known: dict[str, Mapping[str, object]] = {}
    for calendar in calendars:
        if not isinstance(calendar, Mapping):
            continue
        calendar_id = _calendar_id(calendar.get("id"))
        name = calendar.get("name")
        if calendar_id is not None and isinstance(name, str):
            known[calendar_id] = calendar
    chosen: list[str] = []
    for calendar_id in selected_ids:
        if not isinstance(calendar_id, str) or calendar_id not in known:
            raise CalendarSourceError(
                "A selected calendar is no longer available. Refresh your calendar list."
            )
        if calendar_id not in chosen:
            chosen.append(calendar_id)
    if len(chosen) > MAX_SELECTED_CALENDARS:
        raise CalendarSourceError("Choose at most 10 calendars to refresh at once.")

    start, end = _window(now)
    events: list[dict[str, object]] = []
    seen_event_ids: set[str] = set()
    for calendar_id in chosen:
        calendar = known[calendar_id]
        page_token: str | None = None
        seen_tokens: set[str] = set()
        for _ in range(MAX_EVENT_PAGES):
            params = {
                "singleEvents": "true",
                "orderBy": "startTime",
                "timeMin": _rfc3339(start),
                "timeMax": _rfc3339(end),
                "maxResults": "250",
                "fields": _EVENT_FIELDS,
            }
            if page_token is not None:
                params["pageToken"] = page_token
            url = f"{API_ROOT}/calendars/{quote(calendar_id, safe='')}/events"
            response = await _get(request, url, params)
            for item in _page_items(response, "event list", "calendar#events"):
                normalized = _normalize_event(item, calendar)
                if normalized is not None and str(normalized["id"]) not in seen_event_ids:
                    seen_event_ids.add(str(normalized["id"]))
                    events.append(normalized)
                    if len(events) > MAX_EVENTS:
                        raise CalendarSourceError(
                            "More than 1,000 calendar events matched this refresh. Narrow the selected calendars."
                        )
            next_token = _next_token(response, "event list")
            if next_token is None:
                break
            if next_token in seen_tokens:
                raise CalendarSourceError(
                    "Event pagination repeated unexpectedly. Please try again."
                )
            seen_tokens.add(next_token)
            page_token = next_token
        else:
            raise CalendarSourceError(
                "Event list exceeded the 20-page safety limit. Narrow the selected calendars."
            )
    return events
