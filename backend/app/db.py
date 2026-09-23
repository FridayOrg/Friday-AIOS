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
from contextlib import contextmanager
from typing import Iterator

import psycopg2
import psycopg2.extras

from .config import DATABASE_URL

logger = logging.getLogger(__name__)


@contextmanager
def _connect() -> Iterator["psycopg2.extensions.connection"]:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL not set; cannot reach the database.")
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Creates the meeting_summaries / industry_updates tables if they don't
    exist yet. Called once at startup (see main.py) — safe to run on every
    deploy."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS meeting_summaries (
                id SERIAL PRIMARY KEY,
                recording_id TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                meeting_url TEXT,
                started_at TIMESTAMPTZ,
                participants JSONB NOT NULL DEFAULT '[]',
                summary_markdown TEXT,
                action_items JSONB NOT NULL DEFAULT '[]',
                received_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS industry_updates (
                id SERIAL PRIMARY KEY,
                url TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                topic TEXT,
                content TEXT,
                published_at TIMESTAMPTZ,
                relevance_reason TEXT,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )


def _normalize_action_items(raw_items: list) -> list[dict]:
    """Coerces action items into the stored shape
    {text, owner, owner_email, due_date}. Handles legacy rows stored before
    this shape existed (plain strings) transparently."""
    normalized = []
    for item in raw_items or []:
        if isinstance(item, dict):
            text = item.get("text") or item.get("description")
            if not text:
                continue
            normalized.append({
                "text": text,
                "owner": item.get("owner"),
                "owner_email": item.get("owner_email"),
                "due_date": item.get("due_date"),
            })
        elif item:
            normalized.append({"text": str(item), "owner": None, "owner_email": None, "due_date": None})
    return normalized


def upsert_meeting_summary(meeting: dict) -> None:
    """Insert a new meeting summary, or update it in place if recording_id
    already exists — handles both a duplicate webhook retry (Fathom may resend
    the same event) and a manual backfill re-fetching a meeting it already has.

    Fathom's own data never includes a due date for an action item (see
    fathom_client.py) — due_date is the CEO's own manually-set tracking (see
    update_action_item_due_date). A re-sync must not silently wipe that out,
    so incoming action items are matched to the currently-stored ones by their
    text and any existing due_date carried over."""
    with _connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT action_items FROM meeting_summaries WHERE recording_id = %(recording_id)s",
            {"recording_id": meeting["recording_id"]},
        )
        existing = cur.fetchone()
        due_dates_by_text: dict[str, str] = {
            item["text"]: item["due_date"]
            for item in _normalize_action_items(existing["action_items"] if existing else [])
            if item.get("due_date") and item.get("text")
        }

        action_items = _normalize_action_items(meeting.get("action_items") or [])
        for item in action_items:
            if item["due_date"] is None and item["text"] in due_dates_by_text:
                item["due_date"] = due_dates_by_text[item["text"]]

        cur.execute(
            """
            INSERT INTO meeting_summaries
                (recording_id, title, meeting_url, started_at, participants,
                 summary_markdown, action_items)
            VALUES (%(recording_id)s, %(title)s, %(meeting_url)s, %(started_at)s,
                    %(participants)s, %(summary_markdown)s, %(action_items)s)
            ON CONFLICT (recording_id) DO UPDATE SET
                title = EXCLUDED.title,
                meeting_url = EXCLUDED.meeting_url,
                started_at = EXCLUDED.started_at,
                participants = EXCLUDED.participants,
                summary_markdown = EXCLUDED.summary_markdown,
                action_items = EXCLUDED.action_items
            """,
            {
                "recording_id": meeting["recording_id"],
                "title": meeting["title"],
                "meeting_url": meeting.get("meeting_url"),
                "started_at": meeting.get("started_at"),
                "participants": psycopg2.extras.Json(meeting.get("participants") or []),
                "summary_markdown": meeting.get("summary_markdown"),
                "action_items": psycopg2.extras.Json(action_items),
            },
        )


def update_action_item_due_date(recording_id: str, index: int, due_date: str | None) -> bool:
    """Sets (or clears, if due_date is None) the manually-tracked due date for
    one action item, identified by its position in the stored list. Returns
    False if the meeting or that index doesn't exist. See upsert_meeting_
    summary's docstring for why this survives a future Fathom re-sync."""
    with _connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT action_items FROM meeting_summaries WHERE recording_id = %(recording_id)s",
            {"recording_id": recording_id},
        )
        row = cur.fetchone()
        if not row:
            return False
        items = _normalize_action_items(row["action_items"])
        if index < 0 or index >= len(items):
            return False
        items[index]["due_date"] = due_date
        cur.execute(
            "UPDATE meeting_summaries SET action_items = %(action_items)s WHERE recording_id = %(recording_id)s",
            {"action_items": psycopg2.extras.Json(items), "recording_id": recording_id},
        )
        return True


def list_meeting_summaries(limit: int = 20) -> list[dict]:
    """Meeting summaries for the dashboard, most recent first."""
    with _connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT recording_id, title, meeting_url, started_at, participants,
                   summary_markdown, action_items, received_at
            FROM meeting_summaries
            ORDER BY COALESCE(started_at, received_at) DESC
            LIMIT %(limit)s
            """,
            {"limit": limit},
        )
        rows = [dict(r) for r in cur.fetchall()]

    for r in rows:
        if r.get("started_at") is not None:
            r["started_at"] = r["started_at"].isoformat()
        r["received_at"] = r["received_at"].isoformat()
        r["action_items"] = _normalize_action_items(r["action_items"])
    return rows


def upsert_industry_update(item: dict) -> None:
    """Insert a new industry update, or update it in place if this url was
    already stored — handles the same item turning up again on the next
    scheduled refresh."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO industry_updates
                (url, title, topic, content, published_at, relevance_reason)
            VALUES (%(url)s, %(title)s, %(topic)s, %(content)s, %(published_at)s,
                    %(relevance_reason)s)
            ON CONFLICT (url) DO UPDATE SET
                title = EXCLUDED.title,
                topic = EXCLUDED.topic,
                content = EXCLUDED.content,
                published_at = EXCLUDED.published_at,
                relevance_reason = EXCLUDED.relevance_reason
            """,
            {
                "url": item["url"],
                "title": item["title"],
                "topic": item.get("topic"),
                "content": item.get("content"),
                "published_at": item.get("published_at"),
                "relevance_reason": item.get("relevance_reason"),
            },
        )


def list_industry_updates(day_start: str, day_end: str, limit: int = 30) -> list[dict]:
    """Industry updates whose published_at (falling back to fetched_at, for
    items with no known publish date) falls within [day_start, day_end) —
    the caller passes today's exact bounds (see config.now()) so this reflects
    the app's own clock/timezone, not the database server's. Most recent
    first; never returns a prior day's item even if it's still the most
    recently fetched row."""
    with _connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT url, title, topic, content, published_at, relevance_reason, fetched_at
            FROM industry_updates
            WHERE COALESCE(published_at, fetched_at) >= %(day_start)s
              AND COALESCE(published_at, fetched_at) < %(day_end)s
            ORDER BY COALESCE(published_at, fetched_at) DESC
            LIMIT %(limit)s
            """,
            {"day_start": day_start, "day_end": day_end, "limit": limit},
        )
        rows = [dict(r) for r in cur.fetchall()]

    for r in rows:
        if r.get("published_at") is not None:
            r["published_at"] = r["published_at"].isoformat()
        r["fetched_at"] = r["fetched_at"].isoformat()
    return rows
