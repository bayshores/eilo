"""Bounded, read-only normalization for the Gmail v1 API.

The caller supplies an authenticated async ``request(url, params=None)``
function.  This module holds no credentials, never changes Gmail state, and
treats every returned message as untrusted data for the briefing broker.
"""

from __future__ import annotations

import base64
import binascii
import re
from html.parser import HTMLParser
from typing import Any, Awaitable, Callable, Mapping
from urllib.parse import quote


API_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me"
MAX_THREADS = 30
MAX_MESSAGES = 20
MAX_CHARS = 18_000
MAX_QUERY_LENGTH = 2_048
MAX_ID_LENGTH = 1_024
MAX_PAGE_TOKEN_LENGTH = 4_096
MAX_MIME_DEPTH = 12
MAX_MIME_PARTS = 64
MAX_DECODED_PART_BYTES = 65_536
MAX_DECODED_TOTAL_BYTES = 262_144
_SAFE_TRANSPORT_CODES = frozenset({"reauth_required", "offline", "temporary"})
_THREAD_LIST_FIELDS = "nextPageToken,threads(id)"
_THREAD_FIELDS = "id,messages(id,threadId,internalDate,payload(headers(name,value),mimeType,body(data,size,attachmentId),parts))"
Request = Callable[[str, Mapping[str, str] | None], Awaitable[dict[str, Any]]]


class GmailSourceError(RuntimeError):
    """A safe error for callers; underlying transport details remain private."""

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


def _safe_string(value: object, *, limit: int, label: str) -> str:
    if not isinstance(value, str):
        raise GmailSourceError(f"Gmail {label} is invalid. Please try again.")
    value = value.strip()
    if not value or len(value) > limit or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise GmailSourceError(f"Gmail {label} is invalid. Please try again.")
    return value


def _text(value: object, fallback: str, limit: int = 500) -> str:
    if not isinstance(value, str):
        return fallback
    cleaned = " ".join("".join("" if ord(char) < 32 or ord(char) == 127 else char for char in value).split())
    return cleaned[:limit] or fallback


async def _get(request: Request, url: str, params: Mapping[str, str] | None) -> dict[str, Any]:
    try:
        response = await request(url, params=params)
    except GmailSourceError:
        raise
    except Exception as exc:
        code = getattr(exc, "code", None)
        safe_code = code if isinstance(code, str) and code in _SAFE_TRANSPORT_CODES else None
        raise GmailSourceError("Gmail could not be read. Please try reconnecting it.", safe_code) from exc
    if not isinstance(response, dict):
        raise GmailSourceError("Gmail returned an invalid response. Please try again.")
    return response


def _next_page_token(response: Mapping[str, Any]) -> str | None:
    token = response.get("nextPageToken")
    if token is None:
        return None
    return _safe_string(token, limit=MAX_PAGE_TOKEN_LENGTH, label="page token")


def _provider_id(value: object, label: str) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > MAX_ID_LENGTH or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    return value


async def search_threads(
    request: Request, query: str, *, max_threads: int = MAX_THREADS, page_token: str | None = None
) -> dict[str, object]:
    """Return one bounded Gmail search page without claiming a complete mailbox scan."""
    query = _safe_string(query, limit=MAX_QUERY_LENGTH, label="search query")
    if isinstance(max_threads, bool) or not isinstance(max_threads, int) or not 1 <= max_threads <= MAX_THREADS:
        raise GmailSourceError(f"Gmail search must request between 1 and {MAX_THREADS} threads.")
    if page_token is not None:
        page_token = _safe_string(page_token, limit=MAX_PAGE_TOKEN_LENGTH, label="page token")
    params = {"q": query, "maxResults": str(max_threads), "fields": _THREAD_LIST_FIELDS}
    if page_token is not None:
        params["pageToken"] = page_token
    response = await _get(request, f"{API_ROOT}/threads", params)
    threads = response.get("threads")
    if threads is None:
        threads = []
    if not isinstance(threads, list):
        raise GmailSourceError("Gmail returned an incomplete search response. Please try again.")
    thread_ids: list[str] = []
    seen: set[str] = set()
    for thread in threads:
        if not isinstance(thread, dict):
            continue
        thread_id = _provider_id(thread.get("id"), "thread ID")
        if thread_id is None or thread_id in seen:
            continue
        seen.add(thread_id)
        thread_ids.append(thread_id)
        if len(thread_ids) >= max_threads:
            break
    next_token = _next_page_token(response)
    return {"thread_ids": thread_ids, "nextPageToken": next_token, "has_more": next_token is not None}


class _HtmlText(HTMLParser):
    _BLOCK_TAGS = frozenset({"address", "article", "br", "div", "li", "p", "section", "table", "tr"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "template"}:
            self._ignored += 1
        elif not self._ignored and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "template"} and self._ignored:
            self._ignored -= 1
        elif not self._ignored and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._ignored:
            self.parts.append(data)

    def readable(self) -> str:
        return "\n".join(" ".join(line.split()) for line in "".join(self.parts).splitlines() if line.strip())


def _html_to_text(value: str) -> str:
    parser = _HtmlText()
    try:
        parser.feed(value)
        parser.close()
    except Exception:
        return ""
    return parser.readable()


def _decode_body(body: object, budget: list[int]) -> tuple[str | None, bool]:
    if not isinstance(body, dict) or not isinstance(body.get("data"), str):
        return None, False
    encoded = body["data"]
    if len(encoded) > (MAX_DECODED_PART_BYTES * 4 // 3) + 8:
        return None, True
    try:
        raw = base64.b64decode(
            encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True
        )
    except (ValueError, binascii.Error):
        return None, True
    if len(raw) > MAX_DECODED_PART_BYTES or budget[0] + len(raw) > MAX_DECODED_TOTAL_BYTES:
        return None, True
    budget[0] += len(raw)
    return raw.decode("utf-8", errors="replace"), False


def _mime_text(payload: object) -> tuple[str, bool]:
    """Prefer text/plain leaf parts; use readable HTML only when plain text is absent."""
    plain: list[str] = []
    html: list[str] = []
    truncated = False
    budget = [0]
    stack: list[tuple[object, int]] = [(payload, 0)]
    parts_seen = 0
    while stack:
        part, depth = stack.pop()
        if not isinstance(part, dict):
            continue
        parts_seen += 1
        if parts_seen > MAX_MIME_PARTS or depth > MAX_MIME_DEPTH:
            truncated = True
            break
        children = part.get("parts")
        if isinstance(children, list) and children:
            stack.extend((child, depth + 1) for child in reversed(children))
            continue
        mime_type = part.get("mimeType")
        if mime_type not in {"text/plain", "text/html"}:
            continue
        decoded, cut = _decode_body(part.get("body"), budget)
        truncated = truncated or cut
        if not decoded:
            continue
        if mime_type == "text/plain":
            plain.append(decoded)
        else:
            html.append(_html_to_text(decoded))
    return "\n\n".join(plain if plain else html), truncated


def _headers(payload: object) -> dict[str, str]:
    result: dict[str, str] = {}
    if not isinstance(payload, dict) or not isinstance(payload.get("headers"), list):
        return result
    for header in payload["headers"]:
        if not isinstance(header, dict) or not isinstance(header.get("name"), str):
            continue
        name = header["name"].lower()
        if name in {"subject", "from", "date"} and name not in result:
            result[name] = _text(header.get("value"), "")
    return result


def _message_record(message: object, requested_thread_id: str, max_chars: int) -> tuple[dict[str, object] | None, bool]:
    if not isinstance(message, dict):
        return None, False
    message_id = _provider_id(message.get("id"), "message ID")
    thread_id = _provider_id(message.get("threadId"), "thread ID")
    payload = message.get("payload")
    if message_id is None or thread_id is None or thread_id != requested_thread_id or not isinstance(payload, dict):
        return None, False
    body, mime_truncated = _mime_text(payload)
    excerpt = body[:max_chars]
    body_truncated = mime_truncated or len(body) > len(excerpt)
    header = _headers(payload)
    return {
        "id": message_id,
        "thread_id": thread_id,
        "subject": header.get("subject", "(no subject)"),
        "from": header.get("from", "(unknown sender)"),
        "date": header.get("date", ""),
        "excerpt": excerpt,
        "truncated": body_truncated,
    }, body_truncated


async def read_thread(
    request: Request, thread_id: str, *, max_messages: int = MAX_MESSAGES, max_chars: int = MAX_CHARS
) -> dict[str, object]:
    """Read bounded, text-only excerpts from one Gmail thread; never fetch attachments."""
    thread_id = _safe_string(thread_id, limit=MAX_ID_LENGTH, label="thread ID")
    if isinstance(max_messages, bool) or not isinstance(max_messages, int) or not 1 <= max_messages <= MAX_MESSAGES:
        raise GmailSourceError(f"Gmail thread reads must request between 1 and {MAX_MESSAGES} messages.")
    if isinstance(max_chars, bool) or not isinstance(max_chars, int) or not 1 <= max_chars <= MAX_CHARS:
        raise GmailSourceError(f"Gmail excerpts must request between 1 and {MAX_CHARS} characters.")
    response = await _get(request, f"{API_ROOT}/threads/{quote(thread_id, safe='')}", {"format": "full", "fields": _THREAD_FIELDS})
    response_id = _provider_id(response.get("id"), "thread ID")
    messages = response.get("messages")
    if response_id != thread_id or not isinstance(messages, list):
        raise GmailSourceError("Gmail returned an incomplete thread response. Please try again.")
    result: list[dict[str, object]] = []
    truncated = len(messages) > max_messages
    for message in messages[-max_messages:]:
        record, body_truncated = _message_record(message, thread_id, max_chars)
        if record is not None:
            result.append(record)
        truncated = truncated or body_truncated
    return {"id": thread_id, "messages": result, "truncated": truncated}
