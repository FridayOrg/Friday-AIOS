"""Gmail integration — a standalone feature, isolated from Calendar/Fathom. It
reuses only the OAuth app identity (GOOGLE_CLIENT_ID/_SECRET), never the
calendar's own refresh token: this feature has its own gmail.readonly-scoped
token (GMAIL_REFRESH_TOKEN), so it can be added, changed, or removed without
ever touching the working calendar integration.

Fetches recent inbox messages via the Gmail REST API into a plain shape
(subject, sender, snippet, received_at, gmail_url), then hands them to
email_urgency.classify_emails() to filter down to only what needs an
immediate reply. A short in-memory cache (see get_cached_urgent_emails) avoids
re-fetching and re-classifying on every dashboard load; refresh_urgent_emails
forces a fresh pass (see main.py's POST /gmail/refresh).

Never raises on failure: a missing/expired token, an empty inbox, or a rate
limit all just return an empty list so the rest of the dashboard is
unaffected.
"""

import logging
import time
from datetime import datetime, timezone
from functools import lru_cache

import httpx
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials

from .config import GMAIL_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, now
from .email_urgency import classify_emails

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
_TIMEOUT_SECONDS = 15
_MAX_RESULTS = 20

# Building the dashboard calls get_cached_urgent_emails() independently of any
# manual refresh — cache briefly so a burst of page loads doesn't re-fetch and
# re-classify the whole inbox every time.
_CACHE_TTL_SECONDS = 60
_cache_emails: list[dict] | None = None
_cache_expires_at: float = 0.0


@lru_cache(maxsize=1)
def _credentials() -> Credentials | None:
    if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GMAIL_REFRESH_TOKEN):
        logger.warning(
            "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GMAIL_REFRESH_TOKEN not fully "
            "set; Gmail integration disabled."
        )
        return None
    return Credentials(
        token=None,
        refresh_token=GMAIL_REFRESH_TOKEN,
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=_SCOPES,
    )


def _access_token() -> str | None:
    creds = _credentials()
    if creds is None:
        return None
    try:
        creds.refresh(GoogleAuthRequest())
        return creds.token
    except Exception as e:  # noqa: BLE001 - expired/revoked token, network issue, etc.
        logger.warning("Gmail authentication failed: %s", e)
        return None


def _header(headers: list[dict], name: str) -> str | None:
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value")
    return None


def _parse_message(msg: dict) -> dict:
    headers = msg.get("payload", {}).get("headers", [])
    subject = _header(headers, "Subject") or "(no subject)"
    sender = _header(headers, "From") or "(unknown sender)"

    internal_date_ms = msg.get("internalDate")
    received_at = (
        datetime.fromtimestamp(int(internal_date_ms) / 1000, tz=timezone.utc).isoformat()
        if internal_date_ms
        else None
    )

    return {
        "id": msg.get("id", ""),
        "thread_id": msg.get("threadId", ""),
        "subject": subject,
        "sender": sender,
        "snippet": msg.get("snippet", ""),
        "received_at": received_at,
        "gmail_url": f"https://mail.google.com/mail/u/0/#inbox/{msg.get('id', '')}",
    }


def fetch_recent_emails(limit: int = _MAX_RESULTS) -> list[dict]:
    """Recent inbox messages (subject, sender, snippet, received_at,
    gmail_url). Empty list (never an exception) on any failure: missing/
    expired token, unreachable API, rate-limited, or a genuinely empty inbox."""
    token = _access_token()
    if token is None:
        return []

    headers = {"Authorization": f"Bearer {token}"}
    # Only today's messages — Gmail's after: operator is inclusive of that
    # calendar day onward, so "today" onward with no upper bound covers just
    # today (nothing "after" today exists yet).
    today_str = now().strftime("%Y/%m/%d")
    query = f"in:inbox after:{today_str}"
    try:
        list_resp = httpx.get(
            f"{_API_BASE}/messages",
            headers=headers,
            params={"maxResults": limit, "q": query},
            timeout=_TIMEOUT_SECONDS,
        )
        list_resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("Gmail API rate limit hit while listing messages.")
        else:
            logger.warning(
                "Gmail API error %s: %s", e.response.status_code, e.response.text[:200]
            )
        return []
    except httpx.HTTPError as e:
        logger.warning("Gmail API unreachable: %s", e)
        return []

    message_ids = [m["id"] for m in list_resp.json().get("messages", [])]
    if not message_ids:
        return []  # empty inbox (or nothing matching the query) - not an error

    emails = []
    for msg_id in message_ids:
        try:
            resp = httpx.get(
                f"{_API_BASE}/messages/{msg_id}",
                headers=headers,
                params={"format": "metadata", "metadataHeaders": ["Subject", "From"]},
                timeout=_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            emails.append(_parse_message(resp.json()))
        except httpx.HTTPError as e:
            logger.warning("Could not fetch Gmail message %s: %s", msg_id, e)
            continue  # skip this one message, don't fail the whole fetch

    return emails


def get_cached_urgent_emails() -> list[dict]:
    """The last classified batch of urgent emails, refreshing automatically
    once _CACHE_TTL_SECONDS has elapsed."""
    if _cache_emails is not None and time.monotonic() < _cache_expires_at:
        return _cache_emails
    return refresh_urgent_emails()


def refresh_urgent_emails() -> list[dict]:
    """Forces a fresh fetch + classify pass, bypassing the cache (see main.py's
    POST /gmail/refresh)."""
    global _cache_emails, _cache_expires_at

    emails = fetch_recent_emails()
    urgent = classify_emails(emails) if emails else []
    _cache_emails = urgent
    _cache_expires_at = time.monotonic() + _CACHE_TTL_SECONDS
    return urgent
