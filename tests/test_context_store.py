from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet

from app.context_store import ContextStore, ContextStoreError, RevisionConflict


class Clock:
    def __init__(self, value=1_000.0):
        self.value = value

    def __call__(self):
        return self.value


class ContextStoreTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / "context.sqlite"
        self.clock = Clock()
        self.key = Fernet.generate_key()
        self.store = ContextStore(self.path, self.key, now=self.clock)

    def tearDown(self):
        self.store.close()
        self.temporary.cleanup()

    def test_encrypted_cross_reopen_and_no_disk_plaintext(self):
        self.store.put("episode", "episode-1", {"text": "only-copper-orchid-phrase"})
        self.store.close()
        for suffix in ("", "-wal", "-shm"):
            candidate = self.path.with_name(self.path.name + suffix)
            if candidate.exists():
                self.assertNotIn(b"only-copper-orchid-phrase", candidate.read_bytes())
        reopened = ContextStore(self.path, self.key, now=self.clock)
        self.assertEqual(
            reopened.get("episode", "episode-1")["payload"]["text"], "only-copper-orchid-phrase"
        )
        reopened.close()

    def test_wrong_key_and_invalid_key_fail_closed(self):
        self.store.put("note", "note-1", {"text": "private"})
        self.store.close()
        with self.assertRaises(ContextStoreError):
            ContextStore(self.path, Fernet.generate_key(), now=self.clock)
        with self.assertRaises(ContextStoreError):
            ContextStore(Path(self.temporary.name) / "invalid.sqlite", b"invalid", now=self.clock)
        with self.assertRaises(ContextStoreError):
            ContextStore(Path(self.temporary.name) / "missing.sqlite", None, now=self.clock)

    def test_fts_is_memory_only_and_safe(self):
        self.store.put("episode", "episode-1", {"text": "airport weather planning"})
        self.store.put("observation", "observation-1", {"text": "airport weather planning"})
        self.assertEqual(
            [record["id"] for record in self.store.search('airport "weather"')], ["episode-1"]
        )
        self.assertEqual(self.store.search('" OR * NEAR'), [])
        self.assertEqual(self.store._fts.execute("PRAGMA database_list").fetchone()[2], "")

    def test_raw_expiry_keeps_summary_but_explicit_forget_deletes_it(self):
        self.store.put("observation", "source-a", {"text": "raw private capture"})
        self.store.put("episode", "episode-1", {"text": "valid summary phrase"}, ("source-a",))
        self.clock.value += 25 * 60 * 60
        self.assertEqual(self.store.purge(), ["source-a"])
        self.assertIsNone(self.store.get("observation", "source-a"))
        self.assertEqual(
            self.store.get("episode", "episode-1")["payload"]["text"], "valid summary phrase"
        )
        self.assertEqual([item["id"] for item in self.store.search("summary")], ["episode-1"])
        self.assertEqual(self.store.delete(["source-a"]), ["episode-1", "source-a"])
        self.assertIsNone(self.store.get("episode", "episode-1"))
        self.assertEqual(self.store.search("summary"), [])

    def test_retained_records_must_be_source_independent_notes_or_preferences(self):
        self.store.put("note", "note-1", {"text": "kept", "retained": True})
        self.assertIsNone(self.store.get("note", "note-1")["expires_at"])
        self.store.put("observation", "source-a", {"text": "source"})
        with self.assertRaises(ValueError):
            self.store.put("note", "note-derived", {"retained": True}, ("source-a",))
        with self.assertRaises(ValueError):
            self.store.put("episode", "episode-retained", {"retained": True})

    def test_recursive_delete_shared_derivatives_and_fts(self):
        self.store.put("observation", "source-a", {"text": "alpha"})
        self.store.put("observation", "source-b", {"text": "beta"})
        self.store.put(
            "episode", "episode-shared", {"text": "derived phrase"}, ("source-a", "source-b")
        )
        self.store.put("context", "context-child", {"text": "derived child"}, ("episode-shared",))
        self.assertEqual(
            self.store.delete(["source-a"]), ["context-child", "episode-shared", "source-a"]
        )
        self.assertIsNotNone(self.store.get("observation", "source-b"))
        self.assertEqual(self.store.search("derived"), [])

    def test_stale_revision_is_atomic_and_replaces_stale_links(self):
        self.store.put("observation", "source-a", {"text": "a"})
        self.store.put("observation", "source-b", {"text": "b"})
        first = self.store.put("episode", "episode-1", {"text": "first"}, ("source-a",))
        updated = self.store.put(
            "episode",
            "episode-1",
            {"text": "second"},
            ("source-b",),
            expected_revision=first["revision"],
        )
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(updated["source_ids"], ("source-b",))
        with self.assertRaises(RevisionConflict):
            self.store.put("episode", "episode-1", {"text": "third"}, expected_revision=1)
        record = self.store.get("episode", "episode-1")
        self.assertEqual(record["payload"], {"text": "second"})
        self.assertEqual(record["revision"], 2)

    def test_database_has_no_payload_columns_or_path_in_returned_records(self):
        self.store.put("context", "context-1", {"text": "quiet"})
        columns = {row[1] for row in self.store._connection.execute("PRAGMA table_info(records)")}
        self.assertEqual(
            columns, {"id", "kind", "content", "created_at", "updated_at", "expires_at", "revision"}
        )
        self.assertNotIn("path", self.store.get("context", "context-1"))

    def test_payload_rejects_nonfinite_values_and_database_is_private(self):
        with self.assertRaises(ValueError):
            self.store.put("note", "note-nan", {"value": float("nan")})
        self.store.put("note", "note-1", {"text": "private"})
        self.assertEqual(self.path.stat().st_mode & 0o077, 0)
        for suffix in ("-wal", "-shm"):
            candidate = self.path.with_name(self.path.name + suffix)
            if candidate.exists():
                self.assertEqual(candidate.stat().st_mode & 0o077, 0)

    def test_find_ids_includes_expired_tombstones_for_time_range_forget(self):
        self.store.put("observation", "source-a", {"text": "raw"})
        self.store.put("episode", "episode-1", {"text": "summary"}, ("source-a",))
        self.clock.value += 25 * 60 * 60
        self.store.purge()
        self.assertEqual(self.store.find_ids(start=900, end=1_100), ["episode-1", "source-a"])
        self.assertEqual(
            self.store.delete(self.store.find_ids(start=900, end=1_100)), ["episode-1", "source-a"]
        )

    def test_dead_tombstone_provenance_is_cleaned_after_grace_period(self):
        self.store.put("observation", "source-a", {"text": "raw"})
        self.clock.value += 25 * 60 * 60
        self.store.purge()
        self.clock.value += 30 * 24 * 60 * 60
        self.store.purge()
        self.assertEqual(self.store.find_ids(kind="observation"), [])


if __name__ == "__main__":
    unittest.main()
