"""Single-host SQLite job queue. One GPU worker; transactional job claim."""
from __future__ import annotations
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
import json
import sqlite3
import uuid


class IdempotencyConflict(ValueError):
    """An upload key already belongs to a different image."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect(path: Path):
    con = sqlite3.connect(path, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=30000")
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript("""
            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'queued',
                original_filename TEXT NOT NULL,
                original_path TEXT NOT NULL,
                cutout_path TEXT,
                review_path TEXT,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                model TEXT,
                inference_seconds REAL,
                quality_json TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                claimed_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_items_queue ON items(status, created_at);
        """)
        con.execute("BEGIN IMMEDIATE")
        columns = {row['name'] for row in con.execute("PRAGMA table_info(items)")}
        for column in ('idempotency_key', 'request_sha256'):
            if column not in columns:
                con.execute(f"ALTER TABLE items ADD COLUMN {column} TEXT")
        con.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_items_idempotency_key
            ON items(idempotency_key) WHERE idempotency_key IS NOT NULL
        """)


def get_item(db_path: Path, item_id: str) -> dict | None:
    with connect(db_path) as con:
        row = con.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    return dict(row) if row else None


def create_item(db_path: Path, *, original_filename: str, original_path: str, width: int, height: int,
                idempotency_key: str | None = None, request_sha256: str | None = None) -> dict:
    if idempotency_key is not None and request_sha256 is None:
        raise ValueError("An upload key requires an image fingerprint")
    item_id = str(uuid.uuid4())
    now = utc_now()
    with connect(db_path) as con:
        # Serialize lookup and insertion across API processes, including the first request for a key.
        con.execute("BEGIN IMMEDIATE")
        if idempotency_key is not None:
            existing = con.execute("SELECT * FROM items WHERE idempotency_key=?", (idempotency_key,)).fetchone()
            if existing is not None:
                if existing['request_sha256'] != request_sha256:
                    raise IdempotencyConflict("Upload key already belongs to another image")
                return dict(existing)
        con.execute("""
            INSERT INTO items (id, status, original_filename, original_path, width, height,
                               attempts, created_at, updated_at, idempotency_key, request_sha256)
            VALUES (?, 'queued', ?, ?, ?, ?, 0, ?, ?, ?, ?)
        """, (item_id, original_filename, original_path, width, height, now, now, idempotency_key, request_sha256))
        return dict(con.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone())


def claim_one(db_path: Path) -> dict | None:
    """BEGIN IMMEDIATE prevents two workers claiming the same row at the same time."""
    with connect(db_path) as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("""
            SELECT * FROM items WHERE status='queued'
            ORDER BY created_at, id LIMIT 1
        """).fetchone()
        if row is None:
            return None
        now = utc_now()
        con.execute("""
            UPDATE items SET status='processing', claimed_at=?, updated_at=?,
                             attempts=attempts+1, error=NULL
            WHERE id=? AND status='queued'
        """, (now, now, row['id']))
        return dict(con.execute("SELECT * FROM items WHERE id=?", (row['id'],)).fetchone())


def finish(db_path: Path, item_id: str, *, status: str, model: str, elapsed: float,
           cutout_path: str | None, review_path: str | None, quality: dict, error: str | None = None):
    if status not in ("ready", "needs_review", "failed"):
        raise ValueError("invalid terminal state")
    with connect(db_path) as con:
        con.execute("""
            UPDATE items SET status=?, model=?, inference_seconds=?, cutout_path=?, review_path=?,
                             quality_json=?, error=?, updated_at=?, claimed_at=NULL WHERE id=?
            AND status='processing'
        """, (status, model, elapsed, cutout_path, review_path, json.dumps(quality), error, utc_now(), item_id))


def fail_or_requeue(db_path: Path, item: dict, error: str, max_attempts: int):
    state = 'queued' if item['attempts'] < max_attempts else 'failed'
    with connect(db_path) as con:
        con.execute("""
            UPDATE items SET status=?, error=?, updated_at=?, claimed_at=NULL
            WHERE id=? AND status='processing'
        """, (state, error[:350], utc_now(), item['id']))


def requeue(db_path: Path, item_id: str) -> bool:
    with connect(db_path) as con:
        cur = con.execute("""
            UPDATE items SET status='queued', updated_at=?, claimed_at=NULL, error=NULL,
                             attempts=0
            WHERE id=? AND status IN ('ready','needs_review','failed')
        """, (utc_now(), item_id))
        return cur.rowcount > 0


def recover_stale(db_path: Path, stale_seconds: int) -> int:
    deadline = (datetime.now(timezone.utc) - timedelta(seconds=stale_seconds)).isoformat()
    with connect(db_path) as con:
        cur = con.execute("""
            UPDATE items SET status='queued', claimed_at=NULL, updated_at=?,
                 error='Recovered stale worker claim'
            WHERE status='processing' AND claimed_at < ?
        """, (utc_now(), deadline))
        return cur.rowcount
