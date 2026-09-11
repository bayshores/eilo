#!/usr/bin/env python3
"""Check owned source links, public asset coverage, and publication hygiene."""

import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit

from check_source_boundary import (
    check_worktree_and_index,
    load_policy,
    private_reason,
    worktree_path_reason,
)

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
MARKDOWN_LINK = re.compile(r"\[[^\]]*\]\(([^\s)]+)(?:\s+\"[^\"]*\")?\)")
MODULE_REFERENCE = re.compile(r"(?:from\s*|import\s*(?:\(\s*)?|new URL\(\s*)['\"]([^'\"]+)['\"]")
STYLE_REFERENCE = re.compile(r"url\(\s*['\"]?([^)'\"\s]+)")
HTML_REFERENCE = re.compile(r"(?:src|href)=[\"']([^\"']+)[\"']")
VENDOR_MINIFIED = {"vendor/gsap/gsap.min.js", "vendor/gsap/Flip.min.js"}


def source_files() -> list[Path]:
    """Include pending source additions while excluding ignored private data."""
    result = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
    )
    return sorted(
        {ROOT / name for name in result.decode().split("\0") if name and (ROOT / name).is_file()}
    )


def main() -> int:
    errors = []
    files = source_files()
    boundary_policy = load_policy(ROOT)
    for path in files:
        relative = path.relative_to(ROOT)
        if private_reason(relative, boundary_policy):
            # The boundary validator reports this from the Git index; never read
            # private local content while performing public-source checks.
            continue
        if worktree_path_reason(ROOT, relative, boundary_policy):
            continue
        if path.suffix in {".png", ".icns", ".woff2"}:
            continue
        try:
            text = path.read_text()
        except UnicodeDecodeError:
            continue
        if path.suffix == ".md":
            for target in MARKDOWN_LINK.findall(text):
                parsed = urlsplit(target.strip("<>"))
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                destination = path.parent / unquote(parsed.path)
                if not destination.exists():
                    errors.append(f"Broken documentation link: {relative} -> {target}")

    errors.extend(check_worktree_and_index(ROOT))
    manifest = json.loads((WEB / "asset-manifest.json").read_text())
    home = manifest["home"]
    published = set(home) | set(manifest["routes"].values())
    if len(home) != len(set(home)):
        errors.append("Duplicate Home asset in web/asset-manifest.json")
    for asset in published:
        path = Path(asset)
        if (
            path.is_absolute()
            or ".." in path.parts
            or any(part.startswith(".") for part in path.parts)
            or ".test." in asset
        ):
            errors.append(f"Unsafe public asset: {asset}")
        elif path.suffix not in {".html", ".js", ".css", ".woff2"}:
            errors.append(f"Unsupported public asset type: {asset}")
        elif not (WEB / path).is_file():
            errors.append(f"Manifest points to missing asset: {asset}")

    for path in WEB.rglob("*"):
        if (
            not path.is_file()
            or ".test." in path.name
            or path.suffix not in {".js", ".css", ".html", ".woff2"}
        ):
            continue
        relative = path.relative_to(WEB).as_posix()
        if relative not in published:
            errors.append(f"Browser asset missing from manifest: {relative}")
            continue
        # These exact checked-in files are verified above as served assets. Their minified
        # implementation contains import-like strings, not browser module references.
        if relative in VENDOR_MINIFIED:
            continue
        if path.suffix == ".woff2":
            continue
        pattern = {".js": MODULE_REFERENCE, ".css": STYLE_REFERENCE, ".html": HTML_REFERENCE}[
            path.suffix
        ]
        for target in pattern.findall(path.read_text()):
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            if parsed.path.startswith("/"):
                if parsed.path.startswith("/home/"):
                    dependency = parsed.path.removeprefix("/home/") or "index.html"
                elif parsed.path in manifest["routes"]:
                    continue
                else:
                    # Navigation/API destinations are checked by HTTP regressions.
                    continue
            else:
                resolved = (path.parent / unquote(parsed.path)).resolve()
                if not resolved.is_relative_to(WEB):
                    errors.append(f"Browser dependency escapes web/: {relative} -> {target}")
                    continue
                dependency = resolved.relative_to(WEB).as_posix()
            if dependency not in published:
                errors.append(f"Unserved browser dependency: {relative} -> {target}")

    for error in errors:
        print(error)
    if errors:
        print(f"Repository check failed: {len(errors)} issue(s).")
        return 1
    print(
        f"Repository checks passed: {len(files)} source files, {len(published)} public assets, and local documentation links."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
