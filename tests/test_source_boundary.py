from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from check_source_boundary import check_pre_push, check_worktree_and_index  # noqa: E402


class SourceBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.git("init")
        self.git("config", "user.email", "fixture@example.test")
        self.git("config", "user.name", "Fixture")
        (self.root / "config").mkdir()
        (self.root / "config" / "source-boundary.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "private_directories": [".state", ".runtime", ".local"],
                    "private_files": ["AGENTS.md"],
                    "private_suffixes": [".db"],
                    "private_ref_prefixes": ["refs/heads/private/"],
                }
            )
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def git(self, *args: str) -> str:
        return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()

    def write(self, name: str, content: str) -> None:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def commit(self, message: str) -> str:
        self.git("add", "-A")
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def test_forced_staged_private_file_is_rejected(self) -> None:
        self.write(".state/conversation.json", "private")
        self.git("add", "-f", ".state/conversation.json")
        self.assertTrue(
            any(
                ".state/conversation.json" in error for error in check_worktree_and_index(self.root)
            )
        )

    def test_index_secret_is_checked_even_when_worktree_is_cleaned(self) -> None:
        secret = "gh" + "p_" + "abcdefghijklmnopqrstuvwxyz0123456789ABCDE"
        self.write("app/source.py", f"token = '{secret}'\n")
        self.git("add", "app/source.py")
        self.write("app/source.py", "token = 'redacted locally'\n")
        errors = check_worktree_and_index(self.root)
        self.assertTrue(any(error.startswith("index: possible credential") for error in errors))

    def test_pre_push_checks_bad_parent_when_tip_removes_file(self) -> None:
        self.write("app/public.py", "ok = True\n")
        self.commit("public")
        self.write(".state/history.json", "private")
        self.git("add", "-f", ".state/history.json")
        self.git("commit", "-m", "bad history")
        (self.root / ".state/history.json").unlink()
        tip = self.commit("remove private file")
        errors = check_pre_push(self.root, [f"refs/heads/main {tip} refs/heads/main {'0' * 40}"])
        self.assertTrue(any(".state/history.json" in error for error in errors))

    def test_new_destination_does_not_trust_history_on_another_remote(self) -> None:
        self.write(".state/history.json", "private")
        private = self.commit("private history")
        self.git("update-ref", "refs/remotes/private/main", private)
        (self.root / ".state/history.json").unlink()
        tip = self.commit("clean current tree")
        errors = check_pre_push(self.root, [f"refs/heads/main {tip} refs/heads/main {'0' * 40}"])
        self.assertTrue(any(".state/history.json" in error for error in errors))

    def test_public_source_explicit_example_and_synthetic_fixture_are_allowed(self) -> None:
        self.write("app/public.py", "value = 'safe'\n")
        self.write(".env.example", "SETTING=example\n")
        self.write("tests/fixtures/synthetic-token.txt", "fixture only\n")
        self.git("add", "app/public.py", ".env.example", "tests/fixtures/synthetic-token.txt")
        self.assertEqual(check_worktree_and_index(self.root), [])

    def test_symlink_to_private_or_outside_target_is_rejected(self) -> None:
        self.write("app/source.py", "ok = True\n")
        (self.root / "app/private-link").symlink_to("../.state/conversation.json")
        (self.root / "app/outside-link").symlink_to("../../outside")
        self.git("add", "app")
        errors = check_worktree_and_index(self.root)
        self.assertTrue(any("private-link" in error for error in errors))
        self.assertTrue(any("outside-link" in error for error in errors))

    def test_parent_directory_symlink_to_private_data_is_rejected(self) -> None:
        self.write("alias/visible.py", "ok = True\n")
        self.git("add", "alias/visible.py")
        (self.root / "alias/visible.py").unlink()
        (self.root / "alias").rmdir()
        (self.root / "alias").symlink_to(".local")
        errors = check_worktree_and_index(self.root)
        self.assertTrue(any("alias/visible.py" in error for error in errors))

    def test_pre_push_rejects_private_refs_and_local_blocked_commits(self) -> None:
        self.write("app/public.py", "ok = True\n")
        tip = self.commit("public")
        blocked = self.root / ".local"
        blocked.mkdir()
        (blocked / "publish-blocklist.json").write_text(
            json.dumps({"version": 1, "blocked_commits": [tip]})
        )
        errors = check_pre_push(
            self.root,
            [f"refs/heads/private/backup {tip} refs/heads/main {'0' * 40}"],
        )
        self.assertTrue(any("refs" in error for error in errors))
        self.assertTrue(any("blocked by local" in error for error in errors))

    def test_installer_preserves_existing_hooks_path(self) -> None:
        installer = SCRIPTS / "install-source-guards"
        destination = self.root / "scripts"
        destination.mkdir()
        copied = destination / "install-source-guards"
        copied.write_text(installer.read_text())
        copied.chmod(0o755)
        hooks = self.root / ".githooks"
        hooks.mkdir()
        for name in ("pre-commit", "pre-push"):
            (hooks / name).write_text("#!/bin/sh\n")
            (hooks / name).chmod(0o755)
        self.git("config", "core.hooksPath", "custom-hooks")
        result = subprocess.run(
            [str(copied)], cwd=self.root, capture_output=True, text=True, check=False
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git("config", "--get", "core.hooksPath"), "custom-hooks")

    def test_installer_preserves_existing_default_hook(self) -> None:
        destination = self.root / "scripts"
        destination.mkdir()
        copied = destination / "install-source-guards"
        copied.write_text((SCRIPTS / "install-source-guards").read_text())
        copied.chmod(0o755)
        hooks = self.root / ".githooks"
        hooks.mkdir()
        for name in ("pre-commit", "pre-push"):
            (hooks / name).write_text("#!/bin/sh\n")
            (hooks / name).chmod(0o755)
        default_hook = self.root / ".git/hooks/pre-push"
        default_hook.write_text("#!/bin/sh\n")
        default_hook.chmod(0o755)
        result = subprocess.run(
            [str(copied)], cwd=self.root, capture_output=True, text=True, check=False
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotEqual(
            subprocess.run(
                ["git", "config", "--get", "core.hooksPath"], cwd=self.root, check=False
            ).returncode,
            0,
        )

    def test_pre_push_rejects_invalid_and_unknown_remote_object_ids(self) -> None:
        self.write("app/public.py", "ok = True\n")
        tip = self.commit("public")
        invalid = check_pre_push(
            self.root, [f"refs/heads/main {'z' * 40} refs/heads/main {'0' * 40}"]
        )
        unknown = check_pre_push(self.root, [f"refs/heads/main {tip} refs/heads/main {'a' * 40}"])
        self.assertTrue(any("invalid object ID" in error for error in invalid))
        self.assertTrue(any("run git fetch" in error for error in unknown))

    def test_installer_is_idempotent_and_preserves_other_hook_types(self) -> None:
        hooks = self.root / ".githooks"
        hooks.mkdir()
        for name in ("pre-commit", "pre-push"):
            (hooks / name).write_text("#!/bin/sh\n")
            (hooks / name).chmod(0o755)
        installer = SCRIPTS / "install-source-guards"
        custom = self.root / ".git/hooks/prepare-commit-msg"
        custom.write_text("#!/bin/sh\n")
        custom.chmod(0o755)
        result = subprocess.run([str(installer)], cwd=self.root, capture_output=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        custom.unlink()
        for _ in range(2):
            result = subprocess.run(
                [str(installer)], cwd=self.root, capture_output=True, check=False
            )
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git("config", "--get", "core.hooksPath"), ".githooks")

    def test_outgoing_metadata_uses_privacy_email_and_rejects_message_credentials(self) -> None:
        policy = self.root / "config/source-boundary.json"
        value = json.loads(policy.read_text())
        value["public_commit_email_domains"] = ["users.noreply.github.com"]
        policy.write_text(json.dumps(value))
        self.write("app/public.py", "safe = True\n")
        tip = self.commit("public source")
        errors = check_pre_push(self.root, [f"refs/heads/main {tip} refs/heads/main {'0' * 40}"])
        self.assertTrue(any("privacy address" in error for error in errors))
        self.git("config", "user.email", "fixture@users.noreply.github.com")
        secret = "gh" + "p_" + "abcdefghijklmnopqrstuvwxyz0123456789ABCDE"
        self.git("commit", "--allow-empty", "-m", secret)
        tip = self.git("rev-parse", "HEAD")
        errors = check_pre_push(self.root, [f"refs/heads/main {tip} refs/heads/main {'0' * 40}"])
        self.assertTrue(any("commit message" in error for error in errors))
        self.assertFalse(any(secret in error for error in errors))


if __name__ == "__main__":
    unittest.main()
