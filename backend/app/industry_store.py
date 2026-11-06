"""File-based storage for Industry Updates — replaces db.py's Postgres table
with a JSON file kept on a separate `live-data` branch of this repo on
GitHub, so data survives a server restart/redeploy without needing a
database.

Talks to GitHub's Contents API directly over HTTPS (via LIVE_DATA_GITHUB_TOKEN,
a fine-grained PAT scoped to Contents: Read & write on this one repo) instead
of shelling out to a local `git` command in a local clone/worktree. That
means this works identically on any machine running this backend — a laptop,
Render, a teammate's machine — with nothing more than this one token in its
.env; no local folder to set up per-machine.

Keeps the exact same two function signatures as db.py
(upsert_industry_update, list_top_industry_updates) so callers (main.py,
context_loader.py) don't need to change at all.
"""

import base64
import json
import logging
import threading
from datetime import datetime, timezone

import httpx

from .config import LIVE_DATA_GITHUB_BRANCH, LIVE_DATA_GITHUB_REPO, LIVE_DATA_GITHUB_TOKEN

logger = logging.getLogger(__name__)

_API_URL = f"https://api.github.com/repos/{LIVE_DATA_GITHUB_REPO}/contents/live-data/industry_updates.json"
_TIMEOUT_SECONDS = 15
_HEADERS = {
    "Authorization": f"Bearer {LIVE_DATA_GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
}

# Serializes read-modify-write cycles within this one process — two refresh
# calls (e.g. a user double-clicking Refresh) landing at the same instant
# would otherwise both read the same starting content, then the second
# write would be rejected by GitHub (stale `sha`) and silently lost. Doesn't
# protect against two *separate* server instances writing at once, but matches
# this app's actual deployment shape (one backend instance).
_lock = threading.Lock()


def _get_file() -> tuple[list[dict], str | None]:
    """Returns (items, sha). sha is GitHub's content-version id, needed to
    update the file; None if the file doesn't exist yet (first-ever write
    creates it)."""
    if not LIVE_DATA_GITHUB_TOKEN:
        logger.warning("LIVE_DATA_GITHUB_TOKEN not set; Industry Updates storage disabled.")
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


def _put_file(items: list[dict], sha: str | None, commit_message: str) -> None:
    body = {
        "message": commit_message,
        "content": base64.b64encode(json.dumps(items, indent=2, default=str).encode("utf-8")).decode("ascii"),
        "branch": LIVE_DATA_GITHUB_BRANCH,
    }
    if sha:
        body["sha"] = sha
    response = httpx.put(_API_URL, headers=_HEADERS, json=body, timeout=_TIMEOUT_SECONDS)
    response.raise_for_status()


def _merge(items: list[dict], new_items: list[dict], now_iso: str) -> list[dict]:
    """Applies every item in new_items onto items — insert, or update in
    place if its url was already stored (same ON CONFLICT (url) behaviour
    the Postgres version had)."""
    by_url = {existing.get("url"): i for i, existing in enumerate(items)}
    for item in new_items:
        now_item = {**item, "fetched_at": now_iso}
        existing_idx = by_url.get(item["url"])
        if existing_idx is not None:
            items[existing_idx] = {**items[existing_idx], **now_item}
        else:
            by_url[item["url"]] = len(items)
            items.append(now_item)
    return items


# Up to this many attempts if GitHub rejects a write because the file
# changed underneath us (someone else — another refresh, another server
# instance — saved in between our read and our write). Each retry re-reads
# the latest version and reapplies our changes on top of it, so nothing is
# lost on either side; this is the real cross-process safety net (the lock
# above only helps within this one running process).
_MAX_WRITE_ATTEMPTS = 3


def _upsert_batch(new_items: list[dict]) -> int:
    """Writes all of new_items in a single commit (fast — one GitHub save
    instead of one per item), retrying if another writer's save landed in
    between our read and our write. Returns how many were stored."""
    if not LIVE_DATA_GITHUB_TOKEN:
        logger.warning("LIVE_DATA_GITHUB_TOKEN not set; skipping industry update storage.")
        return 0
    if not new_items:
        return 0

    with _lock:
        for attempt in range(1, _MAX_WRITE_ATTEMPTS + 1):
            try:
                items, sha = _get_file()
            except Exception as e:  # noqa: BLE001 - a read failure shouldn't crash the refresh loop
                logger.warning("Could not read live-data/industry_updates.json: %s", e)
                return 0

            now_iso = datetime.now(timezone.utc).isoformat()
            merged = _merge(items, new_items, now_iso)

            try:
                _put_file(merged, sha, f"Industry updates refresh: {len(new_items)} item(s)")
                return len(new_items)
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (409, 422) and attempt < _MAX_WRITE_ATTEMPTS:
                    logger.info("live-data/industry_updates.json changed concurrently; retrying (attempt %d)", attempt)
                    continue
                logger.warning("Could not save industry updates to GitHub: %s", e)
                return 0
            except Exception as e:  # noqa: BLE001 - a push failure shouldn't break the refresh call
                logger.warning("Could not save industry updates to GitHub: %s", e)
                return 0
    return 0


def upsert_industry_update(item: dict) -> None:
    """Insert a new industry update, or update it in place if this url was
    already stored. Prefer upsert_industry_updates_batch when saving several
    items from one refresh — it does a single commit instead of one per
    item."""
    _upsert_batch([item])


def upsert_industry_updates_batch(items: list[dict]) -> int:
    """Same as upsert_industry_update, but for many items from one refresh
    at once — a single commit instead of one per item. Returns how many
    were stored."""
    return _upsert_batch(items)


def list_top_industry_updates(per_category: int = 2) -> dict[str, list[dict]]:
    """The `per_category` most recent items for each distinct `category`
    ("industry", "competitor"), ranked by published_at (falling back to
    fetched_at) — same ranking the Postgres version used. Nothing is ever
    deleted; older items just drop out of this top-N view once something
    newer in their category outranks them."""
    try:
        items, _ = _get_file()
    except Exception as e:  # noqa: BLE001
        logger.warning("Could not read live-data/industry_updates.json: %s", e)
        items = []

    by_category: dict[str, list[dict]] = {}
    for item in items:
        category = item.get("category")
        if category:
            by_category.setdefault(category, []).append(item)

    result: dict[str, list[dict]] = {}
    for category, cat_items in by_category.items():
        cat_items.sort(key=lambda i: i.get("published_at") or i.get("fetched_at") or "", reverse=True)
        result[category] = cat_items[:per_category]
    return result
