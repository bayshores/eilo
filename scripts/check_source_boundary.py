#!/usr/bin/env python3
"""Fail closed when private state or credentials enter Git source history."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

SECRET = re.compile(
    rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
    rb"|\bgh[pousr]_[A-Za-z0-9]{30,}\b"
    rb"|\bgithub_pat_[A-Za-z0-9_]{40,}\b"
    rb"|\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b"
    rb"|\bAIza[A-Za-z0-9_-]{35}\b"
)
OID = re.compile(r"[0-9a-f]{40}(?:[0-9a-f]{24})?\Z")
SOURCE_MODES = {"100644", "100755", "120000"}


@dataclass(frozen=True)
class Policy:
    private_directories: frozenset[str]
    private_files: frozenset[str]
    private_suffixes: tuple[str, ...]
    private_ref_prefixes: tuple[str, ...]
    public_commit_email_domains: tuple[str, ...]


def load_policy(root: Path) -> Policy:
    raw = json.loads((root / "config" / "source-boundary.json").read_text())
    if raw.get("version") != 1:
        raise ValueError("Unsupported config/source-boundary.json version")
    return Policy(
        frozenset(raw["private_directories"]),
        frozenset(raw["private_files"]),
        tuple(raw["private_suffixes"]),
        tuple(raw.get("private_ref_prefixes", [])),
        tuple(raw.get("public_commit_email_domains", [])),
    )


def private_reason(path: PurePosixPath, policy: Policy) -> str | None:
    if any(part in policy.private_directories for part in path.parts):
        return "private directory"
    if path.name in policy.private_files:
        return "private file"
    if path.suffix in policy.private_suffixes:
        return "private suffix"
    if ".env" in path.name and not path.name.endswith(".example"):
        return "environment file"
    return None


def git(root: Path, *args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=root, stderr=subprocess.PIPE)


def git_ok(root: Path, *args: str) -> bool:
    return (
        subprocess.run(
            ["git", *args],
            cwd=root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        ).returncode
        == 0
    )


def index_entries(root: Path) -> tuple[list[tuple[str, str, str]], list[str]]:
    entries = []
    errors = []
    for entry in git(root, "ls-files", "--cached", "-s", "-z").split(b"\0"):
        if entry:
            meta, raw_path = entry.split(b"\t", 1)
            mode, oid, stage = meta.decode().split()
            name = raw_path.decode("utf-8", "surrogateescape")
            if stage != "0":
                errors.append(f"index: {name} has unresolved merge stages")
            elif mode not in SOURCE_MODES:
                errors.append(f"index: {name} has unsupported Git file mode")
            elif not OID.fullmatch(oid):
                errors.append(f"index: {name} has an invalid object ID")
            else:
                entries.append((mode, oid, name))
    return entries, errors


def source_symlink_reason(path: PurePosixPath, target: str, policy: Policy) -> str | None:
    candidate = PurePosixPath(target)
    if candidate.is_absolute():
        return "symlink target escapes repository"
    parts: list[str] = []
    for part in path.parent.joinpath(candidate).parts:
        if part in ("", "."):
            continue
        if part == "..":
            if not parts:
                return "symlink target escapes repository"
            parts.pop()
        else:
            parts.append(part)
    if reason := private_reason(PurePosixPath(*parts), policy):
        return f"symlink target enters {reason}"
    return None


def scan_entries(
    root: Path,
    entries: Iterable[tuple[str, str, str]],
    policy: Policy,
    label: str,
    blobs: dict[str, bytes] | None = None,
) -> list[str]:
    errors = []
    blobs = {} if blobs is None else blobs
    for mode, oid, name in entries:
        path = PurePosixPath(name)
        if reason := private_reason(path, policy):
            errors.append(f"{label}: {name} is a {reason}")
            continue
        blob = blobs.get(oid)
        if blob is None:
            blob = git(root, "cat-file", "blob", oid)
            blobs[oid] = blob
        if mode == "120000":
            if reason := source_symlink_reason(
                path, blob.decode("utf-8", "surrogateescape"), policy
            ):
                errors.append(f"{label}: {name} {reason}")
        elif SECRET.search(blob):
            errors.append(
                f"{label}: possible credential in {name}; inspect locally before publishing"
            )
    return errors


def worktree_path_reason(root: Path, path: PurePosixPath, policy: Policy) -> str | None:
    current = root
    for index, part in enumerate(path.parts):
        current /= part
        if current.is_symlink():
            link = PurePosixPath(*path.parts[: index + 1])
            return source_symlink_reason(link, str(current.readlink()), policy)
    return None


def scan_working_tree(root: Path, policy: Policy) -> list[str]:
    errors = []
    names = git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    for raw_name in names.split(b"\0"):
        if not raw_name:
            continue
        name = raw_name.decode("utf-8", "surrogateescape")
        path = root / name
        relative = PurePosixPath(name)
        if reason := private_reason(relative, policy):
            errors.append(f"working tree: {name} is a {reason}")
        elif reason := worktree_path_reason(root, relative, policy):
            errors.append(f"working tree: {name} {reason}")
        elif path.is_file() and SECRET.search(path.read_bytes()):
            errors.append(
                f"working tree: possible credential in {name}; inspect locally before publishing"
            )
    return errors


def check_worktree_and_index(root: Path) -> list[str]:
    policy = load_policy(root)
    entries, index_errors = index_entries(root)
    return (
        scan_working_tree(root, policy)
        + index_errors
        + scan_entries(root, entries, policy, "index")
    )


def tree_entries(root: Path, commit: str) -> list[tuple[str, str, str]]:
    entries = []
    for entry in git(root, "ls-tree", "-r", "-z", commit).split(b"\0"):
        if entry:
            meta, raw_path = entry.split(b"\t", 1)
            mode, kind, oid = meta.decode().split()
            if kind == "blob":
                entries.append((mode, oid, raw_path.decode("utf-8", "surrogateescape")))
    return entries


def outgoing_commits(
    root: Path, lines: Iterable[str], policy: Policy
) -> tuple[list[str], list[str]]:
    commits: set[str] = set()
    errors: list[str] = []
    zero = "0" * 40
    for line in lines:
        fields = line.split()
        if len(fields) != 4:
            errors.append("pre-push: invalid ref update received")
        else:
            if any(
                fields[0].startswith(prefix) or fields[2].startswith(prefix)
                for prefix in policy.private_ref_prefixes
            ):
                errors.append("pre-push: local/private refs cannot be published")
            if fields[1] == zero:
                continue
            local_oid, remote_oid = fields[1], fields[3]
            if not OID.fullmatch(local_oid) or (
                remote_oid != zero and not OID.fullmatch(remote_oid)
            ):
                errors.append("pre-push: ref update contains an invalid object ID")
                continue
            if remote_oid == zero:
                # A new destination ref has no trusted base. Another remote may be private.
                args = ("rev-list", local_oid)
            elif not git_ok(root, "cat-file", "-e", f"{remote_oid}^{{commit}}"):
                errors.append(
                    "pre-push: remote base is unavailable locally; run git fetch and retry"
                )
                continue
            else:
                args = ("rev-list", local_oid, f"^{remote_oid}")
            try:
                commits.update(git(root, *args).decode().splitlines())
            except subprocess.CalledProcessError:
                errors.append(
                    "pre-push: could not enumerate outgoing commits; run git fetch and retry"
                )
    return sorted(commits), errors


def local_blocklist(root: Path) -> tuple[set[str], list[str]]:
    path = root / ".local" / "publish-blocklist.json"
    if not path.exists():
        return set(), []
    try:
        raw = json.loads(path.read_text())
        commits = raw["blocked_commits"]
        if raw.get("version") != 1 or not isinstance(commits, list):
            raise ValueError
        blocked = set(commits)
        if not all(isinstance(oid, str) and OID.fullmatch(oid) for oid in blocked):
            raise ValueError
    except (OSError, ValueError, json.JSONDecodeError, KeyError, TypeError):
        return set(), ["pre-push: local publish blocklist is invalid; repair it before publishing"]
    return blocked, []


def check_pre_push(root: Path, lines: Iterable[str]) -> list[str]:
    policy = load_policy(root)
    commits, errors = outgoing_commits(root, lines, policy)
    blocked, blocklist_errors = local_blocklist(root)
    errors.extend(blocklist_errors)
    if blocked.intersection(commits):
        errors.append("pre-push: an outgoing commit is blocked by local publish policy")
    blobs: dict[str, bytes] = {}
    for commit in commits:
        metadata = git(root, "show", "-s", "--format=%ae%n%ce%n%B", commit)
        author, committer, message = metadata.split(b"\n", 2)
        if policy.public_commit_email_domains:
            approved = set(policy.public_commit_email_domains)
            if any(
                address.decode("utf-8", "replace").rpartition("@")[2].lower() not in approved
                for address in (author, committer)
            ):
                errors.append(
                    f"commit {commit[:12]}: use a GitHub privacy address for author and committer email"
                )
        if SECRET.search(message):
            errors.append(
                f"commit {commit[:12]}: possible credential in commit message; inspect locally"
            )
        errors.extend(
            scan_entries(root, tree_entries(root, commit), policy, f"commit {commit[:12]}", blobs)
        )
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--staged", action="store_true")
    parser.add_argument("--pre-push", action="store_true")
    args = parser.parse_args(argv)
    if args.staged == args.pre_push:
        parser.error("choose exactly one of --staged or --pre-push")
    errors = (
        check_worktree_and_index(args.root.resolve())
        if args.staged
        else check_pre_push(args.root.resolve(), sys.stdin)
    )
    for error in errors:
        print(error)
    if errors:
        print(f"Source boundary check failed: {len(errors)} issue(s).")
        return 1
    print("Source boundary check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
