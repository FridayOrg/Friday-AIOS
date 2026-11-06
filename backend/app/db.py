"""Minimal Postgres access for persisted data — currently just Fathom meeting
summaries (see fathom_client.py), the only thing in this app that needs to
accumulate and survive across deploys. Everything else stays file-based mock
data or a live external API call, so this is one small helper module rather
than an ORM/migration framework, matching the rest of the codebase's plain-
functions style.

Uses Render's Postgres add-on (DATABASE_URL in .env) rather than a local file:
Render's web service disk is ephemeral and wiped on every deploy/restart, which
data meant to persist can't tolerate.
"""

import logging
import queue
import threading
from contextlib import contextmanager
from typing import Iterator

import psycopg2
import psycopg2.extras

from .config import DATABASE_URL

logger = logging.getLogger(__name__)

# Connections are pooled and reused: opening a fresh Postgres connection
# (TCP + TLS + auth) costs ~2s per query against Render's Postgres, which
# every settings read, meeting-summary and industry-update query used to pay.
_POOL_MAX_CONNECTIONS = 5
_idle: queue.LifoQueue = queue.LifoQueue()
# Caps open connections; callers wait for a free one rather than erroring.
_pool_slots = threading.BoundedSemaphore(_POOL_MAX_CONNECTIONS)


def _new_connection() -> "psycopg2.extensions.connection":
    # TCP keepalives so idle pooled connections aren't silently dropped by
    # the network between requests.
    return psycopg2.connect(DATABASE_URL, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=3)


@contextmanager
def _connect() -> Iterator["psycopg2.extensions.connection"]:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL not set; cannot reach the database.")
    with _pool_slots:
        conn = None
        while conn is None:
            try:
                conn = _idle.get_nowait()
            except queue.Empty:
                conn = _new_connection()
            if conn.closed:
                conn = None
        broken = False
        try:
            yield conn
            conn.commit()
        except Exception as e:
            # A dropped connection can't be reused; discard it so the next
            # caller gets a fresh one.
            broken = isinstance(e, (psycopg2.OperationalError, psycopg2.InterfaceError)) or bool(conn.closed)
            if not conn.closed:
                conn.rollback()
            raise
        finally:
            if broken or conn.closed:
                if not conn.closed:
                    conn.close()
            else:
                _idle.put(conn)


def init_db() -> None:
    """Creates the industry_updates / app_settings tables if they don't
    exist yet. Called once at startup (see main.py) — safe to run on every
    deploy. meeting_summaries used to live here too; it's now stored on
    GitHub instead (see meeting_store.py)."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS industry_updates (
                id SERIAL PRIMARY KEY,
                url TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                topic TEXT,
                category TEXT,
                content TEXT,
                published_at TIMESTAMPTZ,
                relevance_reason TEXT,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        # Added after the table already existed in some deployments -
        # ADD COLUMN IF NOT EXISTS keeps this migration-free.
        cur.execute("ALTER TABLE industry_updates ADD COLUMN IF NOT EXISTS category TEXT")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )


def get_setting(key: str, default: str | None = None) -> str | None:
    """Plain key/value app setting (currently just the monthly revenue
    target — see main.py's /settings/revenue-target). Returns `default` if
    the key was never set."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = %(key)s", {"key": key})
        row = cur.fetchone()
        return row[0] if row else default


def set_setting(key: str, value: str) -> None:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app_settings (key, value) VALUES (%(key)s, %(value)s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            {"key": key, "value": value},
        )


def delete_setting(key: str) -> None:
    """Clears a setting entirely (as opposed to overwriting it with a new
    value) — e.g. resetting the leads prior-period baseline back to "unset"
    when it no longer applies (a CRM source switch invalidates it)."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM app_settings WHERE key = %(key)s", {"key": key})


def upsert_industry_update(item: dict) -> None:
    """Insert a new industry update, or update it in place if this url was
    already stored — handles the same item turning up again on the next
    scheduled refresh."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO industry_updates
                (url, title, topic, category, content, published_at, relevance_reason)
            VALUES (%(url)s, %(title)s, %(topic)s, %(category)s, %(content)s, %(published_at)s,
                    %(relevance_reason)s)
            ON CONFLICT (url) DO UPDATE SET
                title = EXCLUDED.title,
                topic = EXCLUDED.topic,
                category = EXCLUDED.category,
                content = EXCLUDED.content,
                published_at = EXCLUDED.published_at,
                relevance_reason = EXCLUDED.relevance_reason
            """,
            {
                "url": item["url"],
                "title": item["title"],
                "topic": item.get("topic"),
                "category": item.get("category"),
                "content": item.get("content"),
                "published_at": item.get("published_at"),
                "relevance_reason": item.get("relevance_reason"),
            },
        )


def list_top_industry_updates(per_category: int = 2) -> dict[str, list[dict]]:
    """The `per_category` most recent industry_updates rows for each distinct
    `category` ("industry", "competitor"), ranked by published_at (falling
    back to fetched_at for items with no known publish date) - no time-window
    cutoff, so an old item stays displayed indefinitely until something more
    recent in its own category comes along to outrank it, rather than the
    section going empty on a quiet week. Returns {category: [rows...]}."""
    with _connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT url, title, topic, category, content, published_at, relevance_reason, fetched_at
            FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY category
                    ORDER BY COALESCE(published_at, fetched_at) DESC
                ) AS rn
                FROM industry_updates
                WHERE category IS NOT NULL
            ) ranked
            WHERE rn <= %(per_category)s
            ORDER BY category, rn
            """,
            {"per_category": per_category},
        )
        rows = [dict(r) for r in cur.fetchall()]

    result: dict[str, list[dict]] = {}
    for r in rows:
        if r.get("published_at") is not None:
            r["published_at"] = r["published_at"].isoformat()
        r["fetched_at"] = r["fetched_at"].isoformat()
        result.setdefault(r["category"], []).append(r)
    return result
