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

Read functions never raise on failure: a missing/expired token, an empty
inbox, or a rate limit all just return an empty list so the rest of the
dashboard is unaffected. send_email() (bottom of this file) is the one
exception — it's a real write and raises GmailSendError on failure, using its
own separate write-scoped token (GMAIL_SEND_REFRESH_TOKEN), same isolation
pattern as GOOGLE_CALENDAR_WRITE_REFRESH_TOKEN in calendar_client.py.
"""

import base64
import html
import logging
import re
import time
from datetime import datetime, timezone
from email.mime.text import MIMEText
from functools import lru_cache

import httpx
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials

from .config import GMAIL_REFRESH_TOKEN, GMAIL_SEND_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, now
from .email_urgency import classify_emails

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
_SEND_SCOPES = ["https://www.googleapis.com/auth/gmail.send"]
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
    """Reuses the cached access token while it's still valid (Credentials.valid
    already accounts for expiry) instead of refreshing on every single call —
    an unconditional refresh() here meant every Gmail request paid for a full
    extra OAuth round trip, and running several of these concurrently (see
    playbook._prefetch_gmail_evidence) serialized on that redundant refresh
    rather than actually running in parallel."""
    creds = _credentials()
    if creds is None:
        return None
    try:
        if not creds.valid:
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


_QUOTE_CHAIN_RE = re.compile(r"\n\s*On .{0,80} wrote:|\n-{2,}\s*Original Message\s*-{2,}", re.IGNORECASE)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_TAG_RE = re.compile(r"<[^>]+>")


def _extract_plain_text(payload: dict) -> str:
    """Walks a Gmail message payload's MIME tree for the first text/plain
    part (falling back to text/html, tags stripped, if that's all there is),
    decoding the base64url body. Returns "" if nothing usable is found —
    callers fall back to the snippet, never raise."""
    mime_type = payload.get("mimeType", "")
    body_data = (payload.get("body") or {}).get("data")

    if mime_type == "text/plain" and body_data:
        return base64.urlsafe_b64decode(body_data + "=" * (-len(body_data) % 4)).decode("utf-8", errors="replace")

    html_fallback = None
    if mime_type == "text/html" and body_data:
        html_fallback = base64.urlsafe_b64decode(body_data + "=" * (-len(body_data) % 4)).decode("utf-8", errors="replace")

    for part in payload.get("parts") or []:
        text = _extract_plain_text(part)
        if text:
            return text

    return _TAG_RE.sub(" ", html_fallback) if html_fallback else ""


def _summarize_body(text: str, max_sentences: int = 2, max_chars: int = 220) -> str:
    """A short, sentence-bounded summary of an email body — the first couple
    of complete sentences of the NEW content (quoted reply chains cut off
    first), not Gmail's own snippet field, which truncates at a fixed
    character count mid-word/mid-sentence with no indication it's
    incomplete. Deterministic (first sentences, not genuine summarization —
    this system doesn't use an LLM), but reads as a clean, complete thought
    instead of a sentence that just stops."""
    if not text:
        return ""
    # Cut at the first quoted-reply-chain marker, so a long thread's summary
    # reflects the newest message, not whatever's quoted below it.
    match = _QUOTE_CHAIN_RE.search(text)
    if match:
        text = text[: match.start()]
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    sentences = _SENTENCE_SPLIT_RE.split(text)
    summary = " ".join(sentences[:max_sentences]).strip()
    if len(summary) > max_chars:
        summary = summary[:max_chars].rsplit(" ", 1)[0] + "…"
    return summary


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

    body_text = _extract_plain_text(msg.get("payload", {}) or {})
    summary = _summarize_body(body_text) if body_text else ""

    return {
        "id": msg.get("id", ""),
        "thread_id": msg.get("threadId", ""),
        "subject": subject,
        "sender": sender,
        # Gmail's snippet field comes back with HTML entities un-decoded
        # (e.g. "partners&#39; meeting" instead of "partners' meeting") —
        # unescape() here so downstream consumers (e.g. the Why panel) show
        # readable text instead of garbled markup.
        "snippet": html.unescape(msg.get("snippet", "")),
        # A clean, sentence-bounded summary built from the full body (see
        # _summarize_body) — falls back to the raw snippet if the body
        # couldn't be parsed for any reason, so callers always get something.
        "summary": summary or html.unescape(msg.get("snippet", "")),
        "received_at": received_at,
        "gmail_url": f"https://mail.google.com/mail/u/0/#inbox/{msg.get('id', '')}",
    }


def fetch_recent_emails(limit: int = _MAX_RESULTS) -> list[dict]:
    """Recent inbox messages (subject, sender, snippet, received_at,
    gmail_url). Empty list (never an exception) on any failure: missing/
    expired token, unreachable API, rate-limited, or a genuinely empty inbox."""
    # Only today's messages — Gmail's after: operator is inclusive of that
    # calendar day onward, so "today" onward with no upper bound covers just
    # today (nothing "after" today exists yet).
    today_str = now().strftime("%Y/%m/%d")
    return search_emails(f"in:inbox after:{today_str}", limit=limit)


def search_emails(query: str, limit: int = _MAX_RESULTS) -> list[dict]:
    """Inbox messages matching an arbitrary Gmail search query (same shape as
    fetch_recent_emails) — used to match a live email thread to a CRM
    opportunity by sender/subject text (see playbook.py's
    _matching_gmail_emails), not just "today". Empty list on any failure,
    same convention as every other read function here."""
    token = _access_token()
    if token is None:
        return []

    headers = {"Authorization": f"Bearer {token}"}
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
            # format=full (not metadata) so _parse_message has the actual
            # body to build a real summary from — not just Gmail's own
            # pre-truncated snippet.
            resp = httpx.get(
                f"{_API_BASE}/messages/{msg_id}",
                headers=headers,
                params={"format": "full"},
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


# ---------------------------------------------------------------------------
# SEND PATH — only ever called from main.py after the user has explicitly
# confirmed a draft in Ask Friday (see _pending_email_draft /
# _is_send_confirmation), or from the direct POST /gmail/send endpoint given
# full details up front. Uses GMAIL_SEND_REFRESH_TOKEN, a separate credential
# from the readonly one every function above this uses.
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _send_credentials() -> Credentials | None:
    if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GMAIL_SEND_REFRESH_TOKEN):
        logger.warning(
            "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GMAIL_SEND_REFRESH_TOKEN not fully "
            "set; Gmail sending disabled."
        )
        return None
    return Credentials(
        token=None,
        refresh_token=GMAIL_SEND_REFRESH_TOKEN,
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=_SEND_SCOPES,
    )


def _send_access_token() -> str | None:
    creds = _send_credentials()
    if creds is None:
        return None
    try:
        if not creds.valid:
            creds.refresh(GoogleAuthRequest())
        return creds.token
    except Exception as e:  # noqa: BLE001 - any auth failure just disables sending
        logger.warning("Gmail send authentication failed: %s", e)
        return None


class GmailSendError(Exception):
    """Raised by send_email() with a message safe to show the user directly.
    Unlike every read function in this module, a send failure must NOT be
    silently swallowed into an empty result — the caller (main.py) needs to
    tell the user it didn't actually go out, never report success."""


def send_email(to_email: str, subject: str, body: str) -> dict:
    """Sends a single plain-text email via the Gmail API. Returns {"id"} on
    success. Raises GmailSendError (never a raw exception) on any failure:
    missing/invalid token, or Google rejecting the request."""
    token = _send_access_token()
    if token is None:
        raise GmailSendError(
            "Gmail send access isn't configured yet (GMAIL_SEND_REFRESH_TOKEN missing) "
            "— this email was not sent."
        )

    message = MIMEText(body)
    message["to"] = to_email
    message["subject"] = subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")

    try:
        response = httpx.post(
            f"{_API_BASE}/messages/send",
            headers={"Authorization": f"Bearer {token}"},
            json={"raw": raw},
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.warning("Gmail send failed %s: %s", e.response.status_code, e.response.text[:300])
        raise GmailSendError(
            f"Google rejected the request (status {e.response.status_code}) — this email was not sent."
        ) from e
    except httpx.HTTPError as e:
        logger.warning("Gmail unreachable while sending: %s", e)
        raise GmailSendError("Could not reach Gmail — this email was not sent.") from e

    return {"id": response.json().get("id", "")}
