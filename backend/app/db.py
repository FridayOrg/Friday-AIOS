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
    """Creates the meeting_summaries table if it doesn't exist yet. Called once
    at startup (see main.py) — safe to run on every deploy."""
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


def upsert_meeting_summary(meeting: dict) -> None:
    """Insert a new meeting summary, or update it in place if recording_id
    already exists — handles both a duplicate webhook retry (Fathom may resend
    the same event) and a manual backfill re-fetching a meeting it already has."""
    with _connect() as conn, conn.cursor() as cur:
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
                "action_items": psycopg2.extras.Json(meeting.get("action_items") or []),
            },
        )


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
    return rows
