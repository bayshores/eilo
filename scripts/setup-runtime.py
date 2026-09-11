#!/usr/bin/env python3
"""Provision the pinned local Mac runtime without copying accounts or app state."""

from __future__ import annotations

import hashlib
import json
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def ready(python, version):
    if not python.is_file():
        return False
    check = (
        "import importlib.metadata as m, importlib.util as u; "
        f"assert m.version('hermes-agent') == {version!r}; "
        "assert all(u.find_spec(n) for n in ('run_agent','aiohttp','cryptography','keyring'))"
    )
    return (
        subprocess.run(
            [str(python), "-I", "-c", check],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        ).returncode
        == 0
    )


def prepare_source(directory, manifest):
    source = directory / "hermes-agent"
    marker = source / ".eilo-source.json"
    identity = {key: manifest[key] for key in ("revision", "archive_sha256")}
    if source.is_symlink():
        raise RuntimeError("Runtime source must be a local directory, not a symlink.")
    if source.exists():
        if marker.is_file() and json.loads(marker.read_text()) == identity:
            return source
        raise RuntimeError("Existing Hermes source was kept unchanged. See docs/development.md.")
    with tempfile.TemporaryDirectory(prefix="setup-", dir=directory) as temporary:
        staging = Path(temporary)
        archive = staging / "hermes.tar.gz"
        with urllib.request.urlopen(manifest["archive_url"], timeout=60) as response:
            content = response.read(128 * 1024 * 1024 + 1)
        if len(content) > 128 * 1024 * 1024:
            raise RuntimeError("The runtime archive exceeds its size limit.")
        if hashlib.sha256(content).hexdigest() != manifest["archive_sha256"]:
            raise RuntimeError("Runtime download checksum failed; nothing was installed.")
        archive.write_bytes(content)
        with tarfile.open(archive) as bundle:
            bundle.extractall(staging / "source", filter="data")
        extracted = staging / "source" / ("hermes-agent-" + manifest["revision"])
        if not (extracted / "pyproject.toml").is_file():
            raise RuntimeError("Runtime archive has an unexpected layout.")
        extracted.rename(source)
        marker.write_text(json.dumps(identity) + "\n")
    return source


def main():
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise RuntimeError(
            "The real app currently needs an Apple Silicon Mac. Use npm run dev for UI work."
        )
    if not shutil.which("uv"):
        raise RuntimeError(
            "Install uv first: https://docs.astral.sh/uv/getting-started/installation/"
        )
    manifest = json.loads((ROOT / "hermes-source.json").read_text())
    directory = ROOT / ".runtime"
    python = directory / "venv/bin/python"
    if directory.is_symlink() or (directory / "venv").is_symlink():
        raise RuntimeError("Runtime setup does not follow symlinked runtime directories.")
    if ready(python, manifest["package_version"]):
        print("The local runtime is ready. Run npm start.")
        return
    directory.mkdir(mode=0o700, exist_ok=True)
    source = prepare_source(directory, manifest)
    if not python.is_file():
        subprocess.run(
            ["uv", "venv", "--python", manifest["python_tested"], str(directory / "venv")],
            cwd=ROOT,
            check=True,
        )
    subprocess.run(
        [
            "uv",
            "pip",
            "install",
            "--python",
            str(python),
            "--no-deps",
            "-r",
            str(ROOT / "requirements.hermes.lock"),
            "-r",
            str(ROOT / "requirements.integrations.lock"),
        ],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["uv", "pip", "install", "--python", str(python), "--no-deps", "--editable", str(source)],
        cwd=ROOT,
        check=True,
    )
    if not ready(python, manifest["package_version"]):
        raise RuntimeError("Runtime verification failed. Rerun npm run setup:runtime to resume.")
    print("Runtime ready. Run npm start, then sign in with your own account inside eïlo.")


if __name__ == "__main__":
    try:
        main()
    except (
        OSError,
        ValueError,
        RuntimeError,
        tarfile.TarError,
        subprocess.CalledProcessError,
    ) as error:
        print(f"eïlo setup: {error}", file=sys.stderr)
        raise SystemExit(1) from None
