"""Encrypted, bounded local context records with a memory-only text index."""

from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import time
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

KINDS = frozenset({"observation", "episode", "context", "composition", "preference", "note"})
DEFAULT_TTLS = {
    "observation": 24 * 60 * 60,
    "episode": 30 * 24 * 60 * 60,
    "context": 30 * 24 * 60 * 60,
    "composition": 30 * 24 * 60 * 60,
    "preference": 30 * 24 * 60 * 60,
    "note": 30 * 24 * 60 * 60,
}
MAX_ID_LENGTH = 160
MAX_PAYLOAD_BYTES = 64 * 1024
MAX_SOURCES = 64
MAX_LIST_LIMIT = 100
MAX_SEARCH_LIMIT = 32
MAX_DELETE_IDS = 256
MAX_DERIVATIVE_DELETE = 200_000
MAX_TEXT_BYTES = 32 * 1024
MAX_FIND_IDS = 256
TOMBSTONE_GRACE_SECONDS = 30 * 24 * 60 * 60
_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}\Z")
_TOKEN_RE = re.compile(r"[\w]+", re.UNICODE)


class ContextStoreError(RuntimeError):
    """The encrypted context store cannot safely complete an operation."""


class RevisionConflict(ContextStoreError):
    """A conditional update did not match the stored revision."""


class ContextStore:
    """Store encrypted JSON records; decrypted search material only lives in RAM."""

    def __init__(self, path, key, now=time.time):
        self.path = Path(path)
        self.clock = now
        try:
            self.fernet = Fernet(key)
        except (TypeError, ValueError) as error:
            raise ContextStoreError("A valid Fernet key is required.") from error
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path.parent.chmod(0o700)
        old_umask = os.umask(0o077)
        try:
            self._connection = sqlite3.connect(self.path)
        finally:
            os.umask(old_umask)
        self._connection.row_factory = sqlite3.Row
        self._fts = sqlite3.connect(":memory:")
        try:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA foreign_keys=ON")
            self._connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS records (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    content BLOB,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    expires_at REAL,
                    revision INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS derivations (
                    source_id TEXT NOT NULL,
                    record_id TEXT NOT NULL,
                    PRIMARY KEY (source_id, record_id),
                    FOREIGN KEY (source_id) REFERENCES records(id) ON DELETE CASCADE,
                    FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS derivations_source ON derivations(source_id);
                """
            )
            self._fts.execute(
                "CREATE VIRTUAL TABLE records_fts USING fts5(id UNINDEXED, kind UNINDEXED, text)"
            )
            self._rebuild_fts()
            self._set_private_permissions()
        except Exception:
            self.close()
            raise

    def _now(self):
        value = self.clock()
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            raise ContextStoreError("Clock must return a finite timestamp.")
        return float(value)

    def _set_private_permissions(self):
        for candidate in (
            self.path,
            self.path.with_name(f"{self.path.name}-wal"),
            self.path.with_name(f"{self.path.name}-shm"),
        ):
            if candidate.exists():
                candidate.chmod(0o600)

    @staticmethod
    def _id(value):
        if not isinstance(value, str) or not _ID_RE.fullmatch(value):
            raise ValueError("Record IDs must be 1-160 safe identifier characters.")
        return value

    @staticmethod
    def _kind(value):
        if value not in KINDS:
            raise ValueError("Unsupported context record kind.")
        return value

    @staticmethod
    def _limit(value, maximum):
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
            raise ValueError(f"Limit must be between 1 and {maximum}.")
        return value

    @staticmethod
    def _payload(value):
        if not isinstance(value, dict):
            raise ValueError("Record payload must be a dictionary.")
        try:
            encoded = json.dumps(
                value, ensure_ascii=False, separators=(",", ":"), allow_nan=False
            ).encode("utf-8")
        except (TypeError, ValueError) as error:
            raise ValueError("Record payload must be JSON serializable.") from error
        if len(encoded) > MAX_PAYLOAD_BYTES:
            raise ValueError("Record payload is too large.")
        return encoded

    def _expires_at(self, kind, payload, now, expires_at):
        if expires_at is not None:
            if isinstance(expires_at, bool) or not isinstance(expires_at, (int, float)):
                raise ValueError("Expiry must be a finite timestamp.")
            if not math.isfinite(expires_at):
                raise ValueError("Expiry must be a finite timestamp.")
            return float(expires_at)
        if kind in {"preference", "note"} and payload.get("retained") is True:
            return None
        return now + DEFAULT_TTLS[kind]

    def _sources(self, source_ids):
        if isinstance(source_ids, str):
            raise ValueError("Source IDs must be an iterable of IDs.")
        try:
            values = tuple(source_ids)
        except TypeError as error:
            raise ValueError("Source IDs must be an iterable of IDs.") from error
        if len(values) > MAX_SOURCES:
            raise ValueError("Too many source IDs.")
        ids = tuple(self._id(value) for value in values)
        if len(set(ids)) != len(ids):
            raise ValueError("Source IDs must be unique.")
        return ids

    @staticmethod
    def _text(value):
        pieces = []

        def visit(item):
            if isinstance(item, str):
                pieces.append(item)
            elif isinstance(item, dict):
                for child in item.values():
                    visit(child)
            elif isinstance(item, list):
                for child in item:
                    visit(child)

        visit(value)
        return " ".join(pieces).encode("utf-8")[:MAX_TEXT_BYTES].decode("utf-8", "ignore")

    def _decrypt(self, blob):
        try:
            decoded = self.fernet.decrypt(blob)
            value = json.loads(decoded.decode("utf-8"))
        except (InvalidToken, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ContextStoreError("Unable to decrypt context store with this key.") from error
        if not isinstance(value, dict):
            raise ContextStoreError("Encrypted context record is malformed.")
        return value

    def _record(self, row):
        if row["content"] is None:
            return None
        payload = self._decrypt(row["content"])
        sources = tuple(
            item[0]
            for item in self._connection.execute(
                "SELECT source_id FROM derivations WHERE record_id = ? ORDER BY source_id",
                (row["id"],),
            )
        )
        return {
            "id": row["id"],
            "kind": row["kind"],
            "payload": payload,
            "source_ids": sources,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "expires_at": row["expires_at"],
            "revision": row["revision"],
        }

    def _rebuild_fts(self):
        self._fts.execute("DELETE FROM records_fts")
        rows = self._connection.execute(
            "SELECT id, kind, content FROM records WHERE content IS NOT NULL"
        ).fetchall()
        searchable = {"episode", "context", "note"}
        for row in rows:
            if row["kind"] in searchable:
                payload = self._decrypt(row["content"])
                if payload.get("archived"):
                    continue
                self._fts.execute(
                    "INSERT INTO records_fts(id, kind, text) VALUES (?, ?, ?)",
                    (row["id"], row["kind"], self._text(payload)),
                )
        self._fts.commit()

    def _drop_search_entries(self, ids):
        with self._fts:
            self._fts.executemany("DELETE FROM records_fts WHERE id = ?", ((id,) for id in ids))

    def _delete_closure(self, ids):
        pending, affected = list(ids), set()
        while pending:
            current = pending.pop()
            if current in affected:
                continue
            affected.add(current)
            if len(affected) > MAX_DERIVATIVE_DELETE:
                raise ContextStoreError("Derivative deletion exceeds the safety bound.")
            children = self._connection.execute(
                "SELECT record_id FROM derivations WHERE source_id = ?", (current,)
            )
            pending.extend(row[0] for row in children)
        existing = [
            row[0]
            for record_id in affected
            for row in self._connection.execute("SELECT id FROM records WHERE id = ?", (record_id,))
        ]
        for offset in range(0, len(existing), 256):
            batch = existing[offset : offset + 256]
            placeholders = ",".join("?" for _ in batch)
            self._connection.execute(f"DELETE FROM records WHERE id IN ({placeholders})", batch)
        return sorted(existing)

    def _purge_expired(self, now):
        """Strip expired payloads while retaining minimal provenance tombstones.

        Derivation links stay intact so a later explicit forget can remove every
        summary based on an expired raw observation.  Tombstones contain no
        decryptable payload and never enter the RAM search index.
        """
        expired = [
            row[0]
            for row in self._connection.execute(
                "SELECT id FROM records WHERE content IS NOT NULL AND expires_at IS NOT NULL "
                "AND expires_at <= ?",
                (now,),
            )
        ]
        if expired:
            placeholders = ",".join("?" for _ in expired)
            self._connection.execute(
                f"UPDATE records SET content = NULL WHERE id IN ({placeholders})", expired
            )
        self._cleanup_tombstones(now)
        return sorted(expired)

    def _has_live_descendant(self, record_id):
        pending, visited = [record_id], set()
        while pending:
            current = pending.pop()
            if current in visited:
                continue
            visited.add(current)
            if len(visited) > MAX_DERIVATIVE_DELETE:
                return True
            children = self._connection.execute(
                "SELECT record_id FROM derivations WHERE source_id = ?", (current,)
            ).fetchall()
            for child in children:
                row = self._connection.execute(
                    "SELECT content FROM records WHERE id = ?", (child[0],)
                ).fetchone()
                if row is not None and row["content"] is not None:
                    return True
                pending.append(child[0])
        return False

    def _cleanup_tombstones(self, now):
        candidates = self._connection.execute(
            "SELECT id FROM records WHERE content IS NULL AND expires_at IS NOT NULL "
            "AND expires_at <= ?",
            (now - TOMBSTONE_GRACE_SECONDS,),
        ).fetchall()
        for candidate in candidates:
            if not self._has_live_descendant(candidate["id"]):
                self._delete_closure([candidate["id"]])

    def put(self, kind, id, payload, source_ids=(), expires_at=None, expected_revision=None):
        kind, id, content, sources, now = (
            self._kind(kind),
            self._id(id),
            self._payload(payload),
            self._sources(source_ids),
            self._now(),
        )
        if expected_revision is not None and (
            isinstance(expected_revision, bool)
            or not isinstance(expected_revision, int)
            or expected_revision < 1
        ):
            raise ValueError("Expected revision must be a positive integer.")
        expiry = self._expires_at(kind, payload, now, expires_at)
        if payload.get("retained") is True and (kind not in {"preference", "note"} or sources):
            raise ValueError("Only source-independent notes and preferences may be retained.")
        encrypted = self.fernet.encrypt(content)
        with self._connection:
            purged = self._purge_expired(now)
            current = self._connection.execute(
                "SELECT kind, revision, created_at FROM records WHERE id = ?", (id,)
            ).fetchone()
            if current is not None and current["kind"] != kind:
                raise ContextStoreError("Record IDs are globally unique across kinds.")
            if expected_revision is not None and (
                current is None or current["revision"] != expected_revision
            ):
                raise RevisionConflict("Context record has a newer revision.")
            if sources:
                placeholders = ",".join("?" for _ in sources)
                found = self._connection.execute(
                    f"SELECT id FROM records WHERE id IN ({placeholders})",
                    sources,
                ).fetchall()
                if {row[0] for row in found} != set(sources):
                    raise ContextStoreError("Every source ID must refer to an existing record.")
            revision = 1 if current is None else current["revision"] + 1
            created = now if current is None else current["created_at"]
            self._connection.execute(
                "INSERT INTO records(id, kind, content, created_at, updated_at, expires_at, revision) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, content=excluded.content, "
                "updated_at=excluded.updated_at, expires_at=excluded.expires_at, revision=excluded.revision",
                (id, kind, encrypted, created, now, expiry, revision),
            )
            self._connection.execute("DELETE FROM derivations WHERE record_id = ?", (id,))
            self._connection.executemany(
                "INSERT INTO derivations(source_id, record_id) VALUES (?, ?)",
                ((source, id) for source in sources),
            )
        self._drop_search_entries([*purged, id])
        if kind in {"episode", "context", "note"} and not payload.get("archived"):
            with self._fts:
                self._fts.execute(
                    "INSERT INTO records_fts(id,kind,text) VALUES (?,?,?)",
                    (id, kind, self._text(payload)),
                )
        self._set_private_permissions()
        return self.get(kind, id)

    def get(self, kind, id):
        kind, id, now = self._kind(kind), self._id(id), self._now()
        with self._connection:
            purged = self._purge_expired(now)
        if purged:
            self._drop_search_entries(purged)
            self._set_private_permissions()
        row = self._connection.execute(
            "SELECT * FROM records WHERE id = ? AND kind = ? AND content IS NOT NULL", (id, kind)
        ).fetchone()
        return self._record(row) if row else None

    def list(self, kind, limit=100):
        kind, limit, now = self._kind(kind), self._limit(limit, MAX_LIST_LIMIT), self._now()
        with self._connection:
            purged = self._purge_expired(now)
        if purged:
            self._drop_search_entries(purged)
            self._set_private_permissions()
        rows = self._connection.execute(
            "SELECT * FROM records WHERE kind = ? AND content IS NOT NULL "
            "ORDER BY updated_at DESC, id ASC LIMIT ?",
            (kind, limit),
        ).fetchall()
        return [self._record(row) for row in rows]

    def search(self, query, limit=8, *, kind=None, any_word=False):
        limit, now = self._limit(limit, MAX_SEARCH_LIMIT), self._now()
        if not isinstance(query, str) or len(query) > 512:
            raise ValueError("Search query must be a short string.")
        tokens = _TOKEN_RE.findall(query.casefold())[:16]
        if not tokens:
            return []
        with self._connection:
            purged = self._purge_expired(now)
        if purged:
            self._drop_search_entries(purged)
            self._set_private_permissions()
        match = (" OR " if any_word else " AND ").join(
            f'"{token.replace(chr(34), "")}"' for token in tokens
        )
        clause = " AND kind = ?" if kind else ""
        values = (match, self._kind(kind), limit) if kind else (match, limit)
        ids = [
            row[0]
            for row in self._fts.execute(
                "SELECT id FROM records_fts WHERE records_fts MATCH ?"
                + clause
                + " ORDER BY rank LIMIT ?",
                values,
            )
        ]
        records = []
        for record_id in ids:
            row = self._connection.execute(
                "SELECT * FROM records WHERE id = ?", (record_id,)
            ).fetchone()
            if row:
                records.append(self._record(row))
        return records

    def latest_composition(self, context_id):
        self.purge()
        cursor = self._connection.execute(
            "SELECT * FROM records WHERE kind='composition' AND content IS NOT NULL ORDER BY updated_at DESC, rowid DESC"
        )
        for row in cursor:
            if self._decrypt(row["content"]).get("context_id") == context_id:
                return self._record(row)
        return None

    def iter_payloads(self, kind, since=0):
        """Stream retained summary payloads for aggregates without a truncated UI page."""
        kind = self._kind(kind)
        if type(since) not in {int, float} or not math.isfinite(since):
            raise ValueError("Invalid aggregate time.")
        self.purge()
        cursor = self._connection.execute(
            "SELECT content FROM records WHERE kind=? AND content IS NOT NULL AND updated_at>=?",
            (kind, since),
        )
        while rows := cursor.fetchmany(128):
            for row in rows:
                yield self._decrypt(row["content"])

    def find_ids(self, start=None, end=None, kind=None):
        """Return bounded IDs by capture time, including payload-free tombstones."""
        if start is None and end is None and kind is None:
            raise ValueError("Provide a time boundary or record kind.")
        values, clauses = [], []
        for label, value, operator in (("start", start, ">="), ("end", end, "<=")):
            if value is not None:
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                ):
                    raise ValueError(f"{label} must be a finite timestamp.")
                clauses.append(f"created_at {operator} ?")
                values.append(float(value))
        if start is not None and end is not None and start > end:
            raise ValueError("Start must not be after end.")
        if kind is not None:
            clauses.append("kind = ?")
            values.append(self._kind(kind))
        values.append(MAX_FIND_IDS)
        rows = self._connection.execute(
            f"SELECT id FROM records WHERE {' AND '.join(clauses)} "
            "ORDER BY created_at ASC, id ASC LIMIT ?",
            values,
        ).fetchall()
        return [row["id"] for row in rows]

    def delete(self, record_ids):
        if isinstance(record_ids, str):
            raise ValueError("Record IDs must be an iterable of IDs.")
        try:
            ids = tuple(record_ids)
        except TypeError as error:
            raise ValueError("Record IDs must be an iterable of IDs.") from error
        if not ids or len(ids) > MAX_DELETE_IDS:
            raise ValueError("Delete requires 1-256 record IDs.")
        ids = tuple(self._id(record_id) for record_id in ids)
        with self._connection:
            affected = self._delete_closure(ids)
        if affected:
            self._drop_search_entries(affected)
            self._set_private_permissions()
        return affected

    def purge(self):
        with self._connection:
            affected = self._purge_expired(self._now())
        if affected:
            self._drop_search_entries(affected)
            self._set_private_permissions()
        return affected

    def close(self):
        for connection in (getattr(self, "_fts", None), getattr(self, "_connection", None)):
            if connection is not None:
                connection.close()
