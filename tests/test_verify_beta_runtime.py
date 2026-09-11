"""Regression tests for beta staging's source and runtime privacy boundary."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify-beta-runtime.py"
SPEC = importlib.util.spec_from_file_location("verify_beta_runtime", SCRIPT)
assert SPEC and SPEC.loader
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class VerifyBetaRuntimeTests(unittest.TestCase):
    def staged_payload(self, root: Path) -> None:
        for relative in {
            "workspace/app/server.py",
            "workspace/web/index.html",
            "workspace/scripts/local-chat",
            "workspace/activity/native/EiloContextCollector.swift",
            "workspace/activity/extension/manifest.json",
            "workspace/licenses/HERMES-LICENSE",
            "workspace/licenses/ELECTRON-LICENSE",
            "runtime/run-python",
            "runtime/runtime-manifest.json",
            "runtime/HERMES-LICENSE",
            "beta-build.json",
        }:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("{}" if relative == "beta-build.json" else "public\n")
        (root / "beta-build.json").write_text(
            '{"target":"macos-14","architecture":"arm64"}', encoding="utf-8"
        )

    def test_scans_workspace_app_and_runtime_for_private_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            self.staged_payload(stage)
            for relative in {
                "workspace/app/auth.json",
                "runtime/credential-state/auth.json",
                "app/auth.json",
            }:
                target = stage / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("{}", encoding="utf-8")
            errors = VERIFY.verify_stage(stage, system="Darwin", mac_version="14.0")
        self.assertIn("forbidden staged path: workspace/app/auth.json", errors)
        self.assertIn("forbidden staged path: runtime/credential-state/auth.json", errors)
        self.assertIn("forbidden staged path: app/auth.json", errors)

    def test_rejects_unsafe_staged_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            self.staged_payload(stage)
            (stage / "runtime/escape").symlink_to("/tmp")
            errors = VERIFY.verify_stage(stage, system="Darwin", mac_version="14.0")
        self.assertIn("absolute symlink: runtime/escape", errors)

    def test_rejects_looping_staged_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            self.staged_payload(stage)
            (stage / "runtime/loop").symlink_to("loop")
            errors = VERIFY.verify_stage(stage, system="Darwin", mac_version="14.0")
        self.assertIn("looping symlink: runtime/loop", errors)

    def test_accepts_a_complete_public_stage_and_relative_framework_link(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            self.staged_payload(stage)
            framework = stage / "app/Contents/Frameworks/Foo.framework"
            target = framework / "Versions/A/Foo"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("public", encoding="utf-8")
            (framework / "Foo").symlink_to("Versions/A/Foo")
            errors = VERIFY.verify_stage(stage, system="Darwin", mac_version="14.0")
        self.assertEqual(errors, [])
