#!/usr/bin/env python3
"""Fail-closed structural inspection for a staged eïlo beta payload."""

from __future__ import annotations

import argparse
import json
import platform
import re
import sys
from pathlib import Path

POLICY_PATH = Path(__file__).resolve().parents[1] / "config" / "source-boundary.json"
REQUIRED = {
    "workspace/app/server.py",
    "workspace/web/index.html",
    "workspace/scripts/local-chat",
    "workspace/activity/native/EiloContextCollector.swift",
    "workspace/activity/extension/manifest.json",
    "workspace/licenses/HERMES-LICENSE",
    "workspace/licenses/ELECTRON-LICENSE",
    "beta-build.json",
}
TEXT_LIMIT = 2 * 1024 * 1024


def source_boundary() -> dict[str, list[str]]:
    try:
        policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid source-boundary policy: {error}") from error
    required = {
        "private_directories",
        "private_files",
        "private_suffixes",
        "bundle_workspace_roots",
    }
    if policy.get("version") != 1 or any(not isinstance(policy.get(key), list) for key in required):
        raise ValueError("unsupported source-boundary policy")
    return policy


def private_path(relative: Path, policy: dict[str, list[str]]) -> bool:
    name = relative.name
    return (
        any(part in policy["private_directories"] for part in relative.parts)
        or name in policy["private_files"]
        or any(name.endswith(suffix) for suffix in policy["private_suffixes"])
        or (".env" in name and not name.endswith(".example"))
    )


def verify_stage(
    stage: Path, *, system: str | None = None, mac_version: str | None = None
) -> list[str]:
    stage = stage.resolve()
    errors: list[str] = []
    system = system if system is not None else platform.system()
    mac_version = mac_version if mac_version is not None else platform.mac_ver()[0]
    if system != "Darwin" or tuple(map(int, mac_version.split(".")[:1] or [0])) < (14,):
        errors.append("verification host is not macOS 14 or later")
    try:
        policy = source_boundary()
    except ValueError as error:
        return [str(error)]
    try:
        manifest = json.loads((stage / "beta-build.json").read_text(encoding="utf-8"))
        if manifest.get("target") != "macos-14" or manifest.get("architecture") not in {
            "arm64",
            "x64",
        }:
            errors.append("staging manifest lacks a supported macOS 14 architecture target")
    except (OSError, ValueError, json.JSONDecodeError):
        errors.append("invalid beta staging manifest")
    for relative in REQUIRED:
        if not (stage / relative).is_file():
            errors.append(f"missing required staged entry: {relative}")
    runtime = stage / "runtime"
    if runtime.exists():
        for relative in ("run-python", "runtime-manifest.json", "HERMES-LICENSE"):
            if not (runtime / relative).is_file():
                errors.append(f"missing managed runtime entry: runtime/{relative}")
    for path in stage.rglob("*"):
        relative_path = path.relative_to(stage)
        if private_path(relative_path, policy):
            errors.append(f"forbidden staged path: {relative_path}")
        if path.is_symlink():
            link_target = Path(path.readlink())
            if link_target.is_absolute():
                errors.append(f"absolute symlink: {relative_path}")
                continue
            try:
                resolved_target = (path.parent / link_target).resolve()
            except RuntimeError:
                errors.append(f"looping symlink: {relative_path}")
                continue
            if not resolved_target.is_relative_to(stage):
                errors.append(f"escaping symlink: {relative_path}")
            elif resolved_target == path:
                errors.append(f"looping symlink: {relative_path}")
            elif not resolved_target.exists():
                errors.append(f"broken symlink: {relative_path}")
            elif private_path(resolved_target.relative_to(stage), policy):
                errors.append(f"private symlink target: {relative_path}")
            continue
        launcher = (
            path.is_file()
            and not path.name.endswith((".test.py", ".test.js", ".test.cjs"))
            and path.name
            not in {"verify-beta-runtime.py", "build-beta-runtime", "check-repository.py"}
            and "licenses" not in relative_path.parts
            and not path.name.upper().startswith("LICENSE")
            and path.suffix.lower() not in {".cer", ".crt", ".pem"}
        )
        if launcher and path.stat().st_size <= TEXT_LIMIT:
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if re.search(r"/Users/[^/]+/", text):
                errors.append(f"absolute user path in: {path.relative_to(stage)}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True, type=Path)
    args = parser.parse_args()
    errors = verify_stage(args.stage)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("beta staging verification passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
