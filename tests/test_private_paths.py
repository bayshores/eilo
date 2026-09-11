"""Private state cannot be redirected into publishable source by configuration."""

import tempfile
import unittest
from pathlib import Path

from app.paths import private_directory


class PrivatePathsTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.base = Path(self.folder.name).resolve()
        self.root = self.base / "source"
        self.root.mkdir()

    def test_reserved_and_external_storage_are_allowed(self):
        for name in (".state", ".runtime", ".tmp", ".local"):
            expected = self.root / name / "nested"
            self.assertEqual(private_directory(expected, root=self.root), expected)
        outside = self.base / "user-data"
        self.assertEqual(private_directory(outside, root=self.root), outside)

    def test_empty_override_is_rejected(self):
        for value in ("", "   "):
            with self.subTest(value=value), self.assertRaises(ValueError):
                private_directory(value, root=self.root)

    def test_source_root_and_publishable_folders_are_rejected(self):
        for name in (".", "app", "web", "config/custom", "docs/personal", ".git"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                private_directory(self.root / name, root=self.root)

    def test_symlink_and_parent_path_cannot_hide_a_source_destination(self):
        (self.root / "app").mkdir()
        (self.root / ".local").symlink_to(self.root / "app", target_is_directory=True)
        for destination in (self.root / ".local" / "notes", self.root / ".state" / ".." / "app"):
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                private_directory(destination, root=self.root)
        (self.base / "alias").symlink_to(self.root / "app", target_is_directory=True)
        with self.assertRaises(ValueError):
            private_directory(self.base / "alias", root=self.root)
