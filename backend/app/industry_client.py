"""Industry Updates — fetches recent tech-industry news via Tavily's search
API (tavily.com), filters it down to genuinely significant items with an LLM
relevance pass (industry_relevance.py), and persists the result in Postgres
(db.py) so a scheduled background refresh (see main.py's
POST /industry-updates/refresh, triggered by a GitHub Actions cron — this app
has no in-process scheduler) keeps the dashboard fresh independent of anyone
actually viewing it.

TOPICS is a plain list of search queries, not company-specific integration
code — new companies/domains get added here later with no other changes
needed anywhere in this module.

Restricted to today's news only (time_range="day" on the Tavily request, plus
a published_date sanity check on the response) so a stale item from a prior
day's fetch never lingers into "today" on the dashboard — the calling code in
main.py additionally filters storage reads to today's date range.

Never raises on failure: a missing/invalid API key, an unreachable API, a
rate limit, or a genuinely quiet news day all just return an empty list so a
Tavily outage never breaks the rest of the dashboard.
"""

import logging
from datetime import date, datetime, timedelta, timezone

import httpx

from .config import TAVILY_API_KEY

logger = logging.getLogger(__name__)

_API_URL = "https://api.tavily.com/search"
_TIMEOUT_SECONDS = 15
_MAX_RESULTS_PER_TOPIC = 10

# Currently tracking BookMySales.ai's two closest direct competitors in the
# B2B appointment-setting / SDR-as-a-service space (both also offer a
# meetings guarantee, same positioning as BookMySales.ai itself). Extend this
# list later with more competitors without touching anything else in this
# file — just add another {name, query, domains} entry.
#
# Restricted to each company's own domain (include_domains) rather than a
# generic web search: both are small agencies with little independent press
# coverage, so an unrestricted query matched unrelated noise in practice —
# "Belkins" matched Belkin (the electronics brand), "SalesRoads" matched
# generic appointment-setter job postings and Salesforce stock news. Their
# own site is a far more reliable signal for genuine company updates. Uses
# topic="general" rather than "news" for the same reason — Tavily's news
# index is built for publishers, not a small company's own blog.
TOPICS: list[dict] = [
    {"name": "Belkins", "query": "new service pricing case study announcement", "domains": ["belkins.io"]},
    {"name": "SalesRoads", "query": "new service pricing case study announcement", "domains": ["salesroads.com"]},
]


def _parse_published_date(raw: str | None) -> str | None:
    """Tavily's published_date is a loosely-formatted string (varies by
    source); returns an ISO datetime string if parseable, else None (treated
    as "unknown date" downstream, not dropped outright)."""
    if not raw:
        return None
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).astimezone(timezone.utc).isoformat()
        except ValueError:
            continue
    return None


def _is_today(published_at_iso: str | None, today: date) -> bool:
    """True if published_at_iso falls on `today`, or if the date is unknown
    (Tavily doesn't always return one) — the query itself is already scoped
    to today via time_range="day", so an unknown date isn't treated as stale."""
    if published_at_iso is None:
        return True
    try:
        return datetime.fromisoformat(published_at_iso).date() == today
    except ValueError:
        return True


def _fetch_topic(topic: dict, today: date) -> list[dict]:
    name = topic["name"]
    try:
        response = httpx.post(
            _API_URL,
            headers={"Authorization": f"Bearer {TAVILY_API_KEY}"},
            json={
                "query": topic["query"],
                "include_domains": topic["domains"],
                "include_domains_mode": "filter",
                "time_range": "day",
                "max_results": _MAX_RESULTS_PER_TOPIC,
            },
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("Tavily rate limit hit for topic %r.", name)
        else:
            logger.warning(
                "Tavily API error %s for topic %r: %s",
                e.response.status_code, name, e.response.text[:200],
            )
        return []
    except httpx.HTTPError as e:
        logger.warning("Tavily API unreachable for topic %r: %s", name, e)
        return []

    items = []
    for r in response.json().get("results", []):
        published_at = _parse_published_date(r.get("published_date"))
        if not _is_today(published_at, today):
            continue
        items.append(
            {
                "url": r.get("url", ""),
                "title": r.get("title") or "(untitled)",
                "topic": name,
                "content": r.get("content", ""),
                "published_at": published_at,
            }
        )
    return items


def day_bounds(now: datetime) -> tuple[str, str]:
    """Midnight through the following midnight of `now`'s calendar day, as
    RFC3339 with an explicit UTC offset — used to scope the stored-data read
    (db.list_industry_updates) to today only, in the app's own timezone
    rather than the database server's. Mirrors calendar_client.py's
    _week_bounds."""
    start = datetime.combine(now.date(), datetime.min.time())
    end = start + timedelta(days=1)
    if now.tzinfo is not None:
        start, end = start.replace(tzinfo=now.tzinfo), end.replace(tzinfo=now.tzinfo)
    else:
        start, end = start.astimezone(), end.astimezone()
    return start.isoformat(), end.isoformat()


def fetch_todays_updates(today: date) -> list[dict]:
    """Raw (unfiltered) news items for every topic in TOPICS, restricted to
    `today`. Empty list (never an exception) on any failure: missing API key,
    unreachable API, rate-limited, or genuinely no news matching."""
    if not TAVILY_API_KEY:
        logger.warning("TAVILY_API_KEY not set; Industry Updates disabled.")
        return []

    items = []
    seen_urls: set[str] = set()
    for topic in TOPICS:
        for item in _fetch_topic(topic, today):
            if item["url"] and item["url"] not in seen_urls:
                seen_urls.add(item["url"])
                items.append(item)
    return items
