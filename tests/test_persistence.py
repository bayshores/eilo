"""Durability boundary tests for private local state."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from app.persistence import write_private


class PrivatePersistenceTests(unittest.TestCase):
    def test_write_replaces_json_without_leaving_private_temp_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "private" / "state.json"
            write_private(target, {"revision": 1, "label": "eïlo"})

            self.assertEqual(json.loads(target.read_text()), {"revision": 1, "label": "eïlo"})
            self.assertEqual(os.stat(target).st_mode & 0o777, 0o600)
            self.assertEqual(os.stat(target.parent).st_mode & 0o777, 0o700)
            self.assertEqual(list(target.parent.glob("*.new")), [])

            write_private(target, {"revision": 2})
            self.assertEqual(json.loads(target.read_text()), {"revision": 2})
