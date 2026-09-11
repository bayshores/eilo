"""Pure validation for adaptive-context collector input and durable settings."""

from __future__ import annotations

import base64
import binascii
import ipaddress
import math
import re
from copy import deepcopy
from io import BytesIO
from urllib.parse import urlsplit, urlunsplit

from PIL import Image, UnidentifiedImageError

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}\Z")
_SOURCES = {"desktop", "browser"}
_BROWSER_BUNDLES = {
    "com.apple.safari",
    "com.apple.safaritechnologypreview",
    "com.google.chrome",
    "com.google.chrome.canary",
    "org.chromium.chromium",
    "org.mozilla.firefox",
    "org.mozilla.firefoxdeveloperedition",
    "org.mozilla.firefoxnightly",
    "org.torproject.torbrowser",
    "com.microsoft.edgemac",
    "com.microsoft.edgemac.beta",
    "com.microsoft.edgemac.dev",
    "com.microsoft.edgemac.canary",
    "company.thebrowser.browser",
    "company.thebrowser.dia",
    "com.brave.browser",
    "com.brave.browser.nightly",
    "com.operasoftware.opera",
    "com.operasoftware.operagx",
    "com.vivaldi.vivaldi",
    "com.kagi.kagimacos",
}
_MAX_IMAGE = 5 * 1024 * 1024


class ContextValidationError(ValueError):
    pass


def _text(value, limit, *, empty=True):
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        raise ContextValidationError("Invalid collector text.")
    if any(ord(char) < 32 and char not in "\n\t" for char in value):
        raise ContextValidationError("Invalid collector text.")
    return " ".join(value.split())


def _origin(value):
    if not isinstance(value, str) or len(value) > 280:
        raise ContextValidationError("Invalid origin.")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ContextValidationError("Invalid origin.")
    try:
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        host = parsed.hostname.encode("idna").decode("ascii").lower()
        if (
            host == "localhost"
            or host.endswith((".localhost", ".local"))
            or not all(part and re.fullmatch(r"[a-z0-9-]{1,63}", part) for part in host.split("."))
        ):
            raise ContextValidationError("Invalid origin.") from None
    else:
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_unspecified
        ):
            raise ContextValidationError("Invalid origin.")
        host = f"[{address}]" if address.version == 6 else str(address)
    port = parsed.port
    return f"{parsed.scheme}://{host}{'' if port in (None, 80 if parsed.scheme == 'http' else 443) else ':' + str(port)}"


def _resource(value, origin):
    if not isinstance(value, str) or len(value) > 1024:
        raise ContextValidationError("Invalid resource URL.")
    parsed = urlsplit(value)
    if parsed.username or parsed.password:
        raise ContextValidationError("Invalid resource URL.")
    if _origin(urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))) != origin:
        raise ContextValidationError("Resource origin differs.")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", "", ""))


def _excluded(host, exclusions):
    return any(host == item or host.endswith("." + item) for item in exclusions)


def _image(value):
    if (
        not isinstance(value, dict)
        or set(value) != {"mime_type", "data_base64"}
        or value["mime_type"] not in {"image/png", "image/jpeg"}
    ):
        raise ContextValidationError("Invalid image.")
    try:
        data = base64.b64decode(value["data_base64"], validate=True)
    except (TypeError, ValueError, binascii.Error) as error:
        raise ContextValidationError("Invalid image.") from error
    if len(data) > _MAX_IMAGE:
        raise ContextValidationError("Invalid image.")
    try:
        with Image.open(BytesIO(data)) as image:
            if (
                image.format not in {"PNG", "JPEG"}
                or (image.format == "PNG") != (value["mime_type"] == "image/png")
                or image.width < 1
                or image.height < 1
                or image.width * image.height > 16_000_000
            ):
                raise ContextValidationError("Invalid image.")
            image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ContextValidationError("Invalid image.") from error
    return {"mime_type": value["mime_type"], "data_base64": value["data_base64"]}


def validate_event(event, policy, now):
    required = {
        "schema_version",
        "id",
        "source_id",
        "session_id",
        "policy_epoch",
        "captured_at",
        "kind",
        "bundle_id",
        "app_name",
        "title",
        "text",
    }
    optional = {"origin", "resource_url", "image"}
    if (
        not isinstance(event, dict)
        or not required <= set(event)
        or set(event) - required - optional
    ):
        raise ContextValidationError("Invalid collector event.")
    if (
        event["schema_version"] != 1
        or event["source_id"] not in _SOURCES
        or event["kind"] not in {"app", "text", "visual", "browser"}
    ):
        raise ContextValidationError("Invalid collector event.")
    if not all(
        isinstance(event[key], str) and _ID.fullmatch(event[key])
        for key in ("id", "session_id", "bundle_id")
    ) or not isinstance(event["app_name"], str):
        raise ContextValidationError("Invalid collector identity.")
    if (
        type(event["policy_epoch"]) is not int
        or type(event["captured_at"]) not in {int, float}
        or not math.isfinite(event["captured_at"])
        or not now - 60 <= event["captured_at"] <= now + 5
    ):
        raise ContextValidationError("Invalid collector timestamp.")
    if (
        not isinstance(policy, dict)
        or not policy.get("enabled")
        or event["session_id"] != policy.get("session_id")
        or event["policy_epoch"] != policy.get("policy_epoch")
    ):
        return None
    source = event["source_id"]
    if (source == "browser") != (event["kind"] == "browser"):
        raise ContextValidationError("Source and content type differ.")
    if policy.get("source_id", source) != source:
        return None
    if source == "desktop" and event["bundle_id"] in policy.get("excluded_bundle_ids", []):
        return None
    title, text = _text(event["title"], 180), _text(event["text"], 8000)
    if (
        source == "desktop"
        and any(
            event["bundle_id"].lower() == bundle
            or event["bundle_id"].lower().startswith(bundle + ".")
            for bundle in _BROWSER_BUNDLES
        )
        and (event["kind"] != "app" or title or text or event.get("image"))
    ):
        return None
    origin = None
    if event.get("origin") is not None:
        origin = _origin(event["origin"])
        if _excluded(urlsplit(origin).hostname, policy.get("excluded_domains", [])):
            return None
    if source == "browser" and origin is None:
        raise ContextValidationError("Browser origin is required.")
    if not policy.get("text_enabled"):
        text = ""
        if source == "desktop":
            title = ""
    if source == "browser" and event.get("image"):
        return None
    image = _image(event["image"]) if event.get("image") and policy.get("visuals_enabled") else None
    if event.get("image") and not policy.get("visuals_enabled"):
        return None
    return {
        "id": event["id"],
        "schema_version": 1,
        "session_id": event["session_id"],
        "policy_epoch": event["policy_epoch"],
        "kind": event["kind"],
        "source_id": source,
        "captured_at": float(event["captured_at"]),
        "bundle_id": event["bundle_id"],
        "app_name": _text(event["app_name"], 180),
        "title": title,
        "text": text,
        "origin": origin,
        "resource_url": _resource(event["resource_url"], origin)
        if event.get("resource_url")
        else None,
        "image": image,
    }


def validate_settings(value, defaults):
    """Return safe flags-off defaults for malformed durable settings."""
    safe = deepcopy(defaults)
    if not isinstance(value, dict):
        return safe
    allowed = set(defaults)
    if set(value) - allowed or any(
        key not in value for key in ("revision", "policy_epoch", "mode")
    ):
        return safe
    if (
        type(value["revision"]) is not int
        or value["revision"] < 0
        or type(value["policy_epoch"]) is not int
        or value["policy_epoch"] < 0
        or value["mode"] not in {"manual", "adaptive"}
    ):
        return safe
    for key in (
        "enabled",
        "desktop_enabled",
        "browser_enabled",
        "text_enabled",
        "visuals_enabled",
        "ai_enabled",
    ):
        if key in value and type(value[key]) is not bool:
            return safe
    for key, limit in (
        ("excluded_bundle_ids", 64),
        ("excluded_domains", 64),
        ("pins", 24),
        ("undo_ids", 12),
    ):
        values = value.get(key, [])
        if (
            not isinstance(values, list)
            or len(values) > limit
            or any(not isinstance(item, str) or not _ID.fullmatch(item) for item in values)
            or len(values) != len(set(values))
        ):
            return safe
    calls = value.get("call_times", [])
    if (
        not isinstance(calls, list)
        or len(calls) > 60
        or any(
            type(stamp) not in {int, float} or not math.isfinite(stamp) or stamp < 0
            for stamp in calls
        )
    ):
        return safe
    requests = value.get("seen_requests", {})
    if (
        not isinstance(requests, dict)
        or len(requests) > 128
        or any(
            not isinstance(key, str)
            or not _ID.fullmatch(key)
            or not isinstance(digest, str)
            or not re.fullmatch(r"[a-f0-9]{24}", digest)
            for key, digest in requests.items()
        )
    ):
        return safe
    for key in ("current_context_id", "last_composition_id"):
        if value.get(key) is not None and (
            not isinstance(value[key], str) or not _ID.fullmatch(value[key])
        ):
            return safe
    safe.update(deepcopy(value))
    return safe
