"""Runtime source setup uses synthetic archives and never installs dependencies."""

import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "runtime_setup", Path(__file__).resolve().parents[1] / "scripts/setup-runtime.py"
)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class RuntimeSetupTests(unittest.TestCase):
    def archive(self, name="hermes-agent-fixture/pyproject.toml"):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w:gz") as archive:
            info = tarfile.TarInfo(name)
            value = b"[build-system]\n"
            info.size = len(value)
            archive.addfile(info, io.BytesIO(value))
        return data.getvalue()

    def manifest(self, content):
        return {
            "revision": "fixture",
            "archive_sha256": hashlib.sha256(content).hexdigest(),
            "archive_url": "https://example.test/source.tar.gz",
        }

    def test_verified_source_is_reused_without_downloading_or_touching_state(self):
        content = self.archive()
        manifest = self.manifest(content)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(setup.urllib.request, "urlopen", return_value=io.BytesIO(content)):
                source = setup.prepare_source(root, manifest)
            self.assertTrue((source / "pyproject.toml").is_file())
            with patch.object(
                setup.urllib.request, "urlopen", side_effect=AssertionError("download")
            ):
                self.assertEqual(setup.prepare_source(root, manifest), source)
            self.assertFalse((root / ".state").exists())
            self.assertEqual(
                json.loads((source / ".eilo-source.json").read_text())["revision"], "fixture"
            )

    def test_bad_checksum_and_unsafe_archive_fail_without_publishing_source(self):
        valid = self.archive()
        unsafe = self.archive("../../escape")
        for content, manifest in [
            (valid, {**self.manifest(valid), "archive_sha256": "0" * 64}),
            (unsafe, self.manifest(unsafe)),
        ]:
            with self.subTest(manifest=manifest), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                with patch.object(
                    setup.urllib.request, "urlopen", return_value=io.BytesIO(content)
                ):
                    with self.assertRaises((RuntimeError, tarfile.FilterError)):
                        setup.prepare_source(root, manifest)
                self.assertFalse((root / "hermes-agent").exists())

    def test_existing_unmanaged_source_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "hermes-agent").mkdir()
            original = root / "hermes-agent/local-work.txt"
            original.write_text("keep")
            with self.assertRaises(RuntimeError):
                setup.prepare_source(root, self.manifest(self.archive()))
            self.assertEqual(original.read_text(), "keep")
