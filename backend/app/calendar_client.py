"""Live Google Calendar integration — the real-time source of truth for meeting
data, replacing mock-data/calendar.json (left in the repo, just no longer read).

Authenticates via an OAuth refresh token (GOOGLE_CLIENT_ID/_SECRET/_REFRESH_TOKEN +
GOOGLE_CALENDAR_ID in .env) rather than a service-account key — the Google Cloud
project this app runs under has an org policy blocking service-account key
creation (iam.disableServiceAccountKeyCreation), so a one-time interactive consent
(done once via `npx @cocal/google-calendar-mcp auth`) plus its long-lived refresh
token is the credential used here instead. The refresh token lets the backend
mint new access tokens indefinitely with no further browser login, same as a
service account would have, just issued under the founder's own Google account
rather than a separate machine identity.

Returns the same {"calendar": {"meetings": [...]}} document shape calendar.json
used to provide, with each meeting shaped like the old mock's records (id, name,
category, priority, time, duration_minutes, mode, attendees, agenda, date) — so
context_loader.py and the frontend need no shape changes downstream. Google
Calendar events have no category/priority/mode fields at all, so those three are
inferred from the event title (see _classify) rather than sourced from the API.

Never raises: any failure (missing config, unreachable, unauthenticated, no
events) logs a warning and returns an empty meetings list, so a Calendar outage
degrades gracefully instead of breaking the agent or dashboard.
"""

import logging
import time
from datetime import datetime, timedelta
from functools import lru_cache
from urllib.parse import quote

import httpx
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials

from .config import (
    GOOGLE_CALENDAR_ID,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN,
)

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
_TIMEOUT_SECONDS = 8

# Building one system prompt calls fetch_meetings() twice (schedule digest + the raw
# mock-data-style dump) — cache briefly so that costs one Calendar API round trip,
# not two, and a slow/unreachable Calendar doesn't double request latency.
_CACHE_TTL_SECONDS = 30
_cache_meetings: list[dict] | None = None
_cache_expires_at: float = 0.0

# Google Calendar events carry no category/priority/mode — infer them from the
# title since the old mock data always did. First matching keyword wins; anything
# else defaults to ("Meeting", "medium").
_KEYWORD_RULES: list[tuple[tuple[str, ...], tuple[str, str]]] = [
    (("board",), ("Board", "high")),
    (("budget", "finance"), ("Budget", "high")),
    (("client",), ("Client", "high")),
    (("standup", "stand-up", "sync"), ("Standup", "medium")),
    (("interview", "hiring"), ("Hiring", "medium")),
]


def _classify(title: str) -> tuple[str, str]:
    lowered = title.lower()
    for keywords, result in _KEYWORD_RULES:
        if any(k in lowered for k in keywords):
            return result
    return ("Meeting", "medium")


@lru_cache(maxsize=1)
def _credentials() -> Credentials | None:
    if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN):
        logger.warning(
            "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN not fully "
            "set; live calendar disabled."
        )
        return None
    return Credentials(
        token=None,
        refresh_token=GOOGLE_REFRESH_TOKEN,
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
    except Exception as e:  # noqa: BLE001 - any auth failure just disables live calendar
        logger.warning("Google Calendar authentication failed: %s", e)
        return None


def _week_bounds(now: datetime) -> tuple[str, str]:
    """Monday 00:00 through the following Monday 00:00 of `now`'s week, as RFC3339
    with an explicit UTC offset (Google's Calendar API requires one) — the same
    one-week window mock-data/calendar.json used to cover."""
    monday = now.date() - timedelta(days=now.weekday())
    start = datetime.combine(monday, datetime.min.time())
    end = start + timedelta(days=7)
    if now.tzinfo is not None:
        start, end = start.replace(tzinfo=now.tzinfo), end.replace(tzinfo=now.tzinfo)
    else:
        # Naive local time (no FRIDAY_TZ set) — astimezone() on a naive datetime
        # assumes it's already local and attaches the correct UTC offset without
        # changing the wall-clock value, which is exactly what RFC3339 needs here.
        start, end = start.astimezone(), end.astimezone()
    return start.isoformat(), end.isoformat()


def _parse_event(event: dict) -> dict | None:
    title = event.get("summary") or "(untitled)"
    start = event.get("start", {})
    end = event.get("end", {})

    date_str = start.get("date")  # all-day event: date only, no time
    time_str = None
    duration_minutes = None

    start_dt_raw = start.get("dateTime")
    if start_dt_raw:
        start_dt = datetime.fromisoformat(start_dt_raw)
        date_str = start_dt.date().isoformat()
        time_str = start_dt.strftime("%H:%M")
        end_dt_raw = end.get("dateTime")
        if end_dt_raw:
            end_dt = datetime.fromisoformat(end_dt_raw)
            duration_minutes = int((end_dt - start_dt).total_seconds() // 60)

    if not date_str:
        return None  # no usable date at all - skip this event

    category, priority = _classify(title)
    mode = "online" if (event.get("hangoutLink") or event.get("conferenceData")) else "offline"
    attendees = [
        a.get("displayName") or a.get("email")
        for a in event.get("attendees", [])
        if a.get("displayName") or a.get("email")
    ]

    return {
        "id": event.get("id", ""),
        "name": title,
        "category": category,
        "priority": priority,
        "time": time_str,
        "duration_minutes": duration_minutes,
        "mode": mode,
        "attendees": attendees,
        "agenda": event.get("description"),
        "date": date_str,
    }


def fetch_meetings(now: datetime) -> list[dict]:
    """Live meetings for the current week, in the exact shape mock-data/calendar.json
    used to provide. Empty list (never an exception) on any failure — missing
    config, unauthenticated, unreachable, or genuinely no events on the calendar.
    Cached briefly (see _CACHE_TTL_SECONDS) since one prompt build calls this twice."""
    global _cache_meetings, _cache_expires_at
    ts = time.monotonic()
    if _cache_meetings is not None and ts < _cache_expires_at:
        return _cache_meetings

    meetings = _fetch_meetings_uncached(now)
    _cache_meetings = meetings
    _cache_expires_at = ts + _CACHE_TTL_SECONDS
    return meetings


def _fetch_meetings_uncached(now: datetime) -> list[dict]:
    token = _access_token()
    if token is None:
        return []
    if not GOOGLE_CALENDAR_ID:
        logger.warning("GOOGLE_CALENDAR_ID not set; live calendar disabled.")
        return []

    time_min, time_max = _week_bounds(now)
    url = _EVENTS_URL.format(calendar_id=quote(GOOGLE_CALENDAR_ID, safe=""))
    try:
        response = httpx.get(
            url,
            params={
                "timeMin": time_min,
                "timeMax": time_max,
                "singleEvents": "true",
                "orderBy": "startTime",
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.warning(
            "Google Calendar API error %s: %s", e.response.status_code, e.response.text[:200]
        )
        return []
    except httpx.HTTPError as e:
        logger.warning("Google Calendar unreachable: %s", e)
        return []

    items = response.json().get("items", [])
    return [m for m in (_parse_event(e) for e in items) if m is not None]


def fetch_calendar_document(now: datetime) -> dict:
    """The full document shape context_loader.py / the frontend expect in place of
    calendar.json's parsed contents: {"calendar": {"meetings": [...]}}."""
    return {"calendar": {"meetings": fetch_meetings(now)}}
