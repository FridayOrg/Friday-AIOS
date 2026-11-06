"""File-based storage for meeting summaries — replaces db.py's Postgres
meeting_summaries table with a JSON file kept on this repo's `live-data`
branch on GitHub, so data survives a server restart/redeploy without needing
a database. Same approach as industry_store.py.

Talks to GitHub's Contents API directly over HTTPS (via LIVE_DATA_GITHUB_TOKEN,
a fine-grained PAT scoped to Contents: Read & write on this one repo) instead
of shelling out to a local `git` command in a local clone/worktree. That
means this works identically on any machine running this backend — a laptop,
Render, a teammate's machine — with nothing more than this one token in its
.env; no local folder to set up per-machine.

Keeps the same function names db.py's meeting functions had
(upsert_meeting_summary, update_action_item_due_date, delete_meeting_summary,
list_meeting_summaries) so callers (main.py, context_loader.py, playbook.py)
don't need to change their call shape, just their import.
"""

import base64
import json
import logging
import threading
from datetime import datetime, timezone

import httpx

from .config import LIVE_DATA_GITHUB_BRANCH, LIVE_DATA_GITHUB_REPO, LIVE_DATA_GITHUB_TOKEN

logger = logging.getLogger(__name__)

_API_URL = f"https://api.github.com/repos/{LIVE_DATA_GITHUB_REPO}/contents/live-data/meeting_summaries.json"
_TIMEOUT_SECONDS = 15
_HEADERS = {
    "Authorization": f"Bearer {LIVE_DATA_GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
}

# Same reasoning as industry_store.py's lock: serializes read-modify-write
# cycles within this one process so two near-simultaneous writes (e.g. a
# webhook retry landing while a manual refresh is in flight) don't both read
# the same starting content and have the second write silently lost to a
# stale `sha`. Doesn't protect against two separate server instances writing
# at once, but matches this app's actual deployment shape (one backend
# instance).
_lock = threading.Lock()

_MAX_WRITE_ATTEMPTS = 3


def _get_file() -> tuple[list[dict], str | None]:
    """Returns (rows, sha). sha is GitHub's content-version id, needed to
    update the file; None if the file doesn't exist yet (first-ever write
    creates it)."""
    if not LIVE_DATA_GITHUB_TOKEN:
        logger.warning("LIVE_DATA_GITHUB_TOKEN not set; meeting summary storage disabled.")
        return [], None
    response = httpx.get(
        _API_URL, headers=_HEADERS, params={"ref": LIVE_DATA_GITHUB_BRANCH}, timeout=_TIMEOUT_SECONDS
    )
    if response.status_code == 404:
        return [], None
    response.raise_for_status()
    data = response.json()
    content = base64.b64decode(data["content"]).decode("utf-8")
    return json.loads(content), data["sha"]


def _put_file(rows: list[dict], sha: str | None, commit_message: str) -> None:
    body = {
        "message": commit_message,
        "content": base64.b64encode(json.dumps(rows, indent=2, default=str).encode("utf-8")).decode("ascii"),
        "branch": LIVE_DATA_GITHUB_BRANCH,
    }
    if sha:
        body["sha"] = sha
    response = httpx.put(_API_URL, headers=_HEADERS, json=body, timeout=_TIMEOUT_SECONDS)
    response.raise_for_status()


def _normalize_action_items(raw_items: list) -> list[dict]:
    """Coerces action items into the stored shape
    {text, owner, owner_email, due_date}. Handles legacy rows stored before
    this shape existed (plain strings) transparently — same behaviour db.py
    had."""
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


def _with_write_retry(apply_fn, commit_message: str) -> bool:
    """Reads the current file, applies apply_fn(rows) -> rows, writes it
    back, retrying from a fresh read if GitHub rejects the write because the
    file changed underneath us (another writer's save landed in between our
    read and our write). Returns False if the write never succeeded."""
    if not LIVE_DATA_GITHUB_TOKEN:
        logger.warning("LIVE_DATA_GITHUB_TOKEN not set; skipping meeting summary write.")
        return False

    with _lock:
        for attempt in range(1, _MAX_WRITE_ATTEMPTS + 1):
            try:
                rows, sha = _get_file()
            except Exception as e:  # noqa: BLE001 - a read failure shouldn't crash the caller
                logger.warning("Could not read live-data/meeting_summaries.json: %s", e)
                return False

            rows = apply_fn(rows)

            try:
                _put_file(rows, sha, commit_message)
                return True
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (409, 422) and attempt < _MAX_WRITE_ATTEMPTS:
                    logger.info(
                        "live-data/meeting_summaries.json changed concurrently; retrying (attempt %d)", attempt
                    )
                    continue
                logger.warning("Could not save meeting summaries to GitHub: %s", e)
                return False
            except Exception as e:  # noqa: BLE001 - a push failure shouldn't break the caller
                logger.warning("Could not save meeting summaries to GitHub: %s", e)
                return False
    return False


def upsert_meeting_summary(meeting: dict) -> None:
    """Insert a new meeting summary, or update it in place if recording_id
    already exists — handles both a duplicate webhook retry (Fathom may
    resend the same event) and a manual backfill re-fetching a meeting it
    already has.

    Fathom's own data never includes a due date for an action item (see
    fathom_client.py) — due_date is the CEO's own manually-set tracking (see
    update_action_item_due_date). A re-sync must not silently wipe that out,
    so incoming action items are matched to the currently-stored ones by
    their text and any existing due_date carried over. Same behaviour db.py's
    upsert_meeting_summary had."""
    recording_id = meeting["recording_id"]

    def apply(rows: list[dict]) -> list[dict]:
        now_iso = datetime.now(timezone.utc).isoformat()
        existing_idx = next((i for i, r in enumerate(rows) if r.get("recording_id") == recording_id), None)
        existing = rows[existing_idx] if existing_idx is not None else None

        due_dates_by_text: dict[str, str] = {
            item["text"]: item["due_date"]
            for item in _normalize_action_items(existing["action_items"] if existing else [])
            if item.get("due_date") and item.get("text")
        }

        action_items = _normalize_action_items(meeting.get("action_items") or [])
        for item in action_items:
            if item["due_date"] is None and item["text"] in due_dates_by_text:
                item["due_date"] = due_dates_by_text[item["text"]]

        row = {
            "recording_id": recording_id,
            "title": meeting["title"],
            "meeting_url": meeting.get("meeting_url"),
            "started_at": meeting.get("started_at"),
            "participants": meeting.get("participants") or [],
            "summary_markdown": meeting.get("summary_markdown"),
            "action_items": action_items,
            "received_at": existing["received_at"] if existing else now_iso,
        }

        if existing_idx is not None:
            rows[existing_idx] = row
        else:
            rows.append(row)
        return rows

    _with_write_retry(apply, f"Meeting summary upsert: {recording_id}")


def update_action_item_due_date(recording_id: str, index: int, due_date: str | None) -> bool:
    """Sets (or clears, if due_date is None) the manually-tracked due date
    for one action item, identified by its position in the stored list.
    Returns False if the meeting or that index doesn't exist, or if the
    write itself failed."""
    result = {"ok": False}

    def apply(rows: list[dict]) -> list[dict]:
        row = next((r for r in rows if r.get("recording_id") == recording_id), None)
        if row is None:
            return rows
        items = _normalize_action_items(row.get("action_items"))
        if index < 0 or index >= len(items):
            return rows
        items[index]["due_date"] = due_date
        row["action_items"] = items
        result["ok"] = True
        return rows

    succeeded = _with_write_retry(apply, f"Meeting summary action-item due date: {recording_id}[{index}]")
    return succeeded and result["ok"]


def delete_meeting_summary(recording_id: str) -> bool:
    """Permanently removes one meeting summary row. Returns False if no row
    with that recording_id exists, or if the write itself failed."""
    result = {"ok": False}

    def apply(rows: list[dict]) -> list[dict]:
        remaining = [r for r in rows if r.get("recording_id") != recording_id]
        result["ok"] = len(remaining) != len(rows)
        return remaining

    succeeded = _with_write_retry(apply, f"Meeting summary delete: {recording_id}")
    return succeeded and result["ok"]


def list_meeting_summaries(limit: int = 20) -> list[dict]:
    """Meeting summaries for the dashboard, most recent first — same shape
    and ordering db.list_meeting_summaries() returned."""
    try:
        rows, _ = _get_file()
    except Exception as e:  # noqa: BLE001 - a read failure shouldn't break the dashboard
        logger.warning("Could not read live-data/meeting_summaries.json: %s", e)
        return []

    rows = [{**r, "action_items": _normalize_action_items(r.get("action_items"))} for r in rows]
    rows.sort(key=lambda r: r.get("started_at") or r.get("received_at") or "", reverse=True)
    return rows[:limit]
