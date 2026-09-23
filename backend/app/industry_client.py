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

Restricted to the past week (time_range="week" on the Tavily request, plus a
published_date sanity check on the response) so nothing older than 7 days
lingers on the dashboard — the calling code in main.py additionally filters
storage reads to the same rolling 7-day window, and caps the displayed count
to the 3 most recent items.

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

# Two named direct competitors (domain-restricted — see below) plus one
# broader entry that surfaces ANY similar company's news, not just these two.
# Extend this list later with more named competitors without touching
# anything else in this file — just add another {name, query, domains} entry;
# "domains" is optional (omit it for a broad, unrestricted web search).
#
# Named entries are restricted to each company's own domain (include_domains):
# both are small agencies with little independent press coverage, so an
# unrestricted query matched unrelated noise in practice — "Belkins" matched
# Belkin (the electronics brand), "SalesRoads" matched generic appointment-
# setter job postings and Salesforce stock news. Their own site is a far more
# reliable signal for genuine company updates.
#
# The broad entries have no domain restriction and use topic="news" (Tavily's
# news-indexed search, appropriate here since we're looking for actual press
# coverage, not one small company's own blog).
#
# Two broad entries deliberately, not one: "B2B Appointment Setting Industry"
# catches other named companies' news (funding, launches, partnerships) the
# same way the two named competitors above do; "Sales Development Trends"
# catches content with no single company attached at all - market/industry
# trend pieces, research/reports, how outbound sales teams are adopting AI,
# etc. On a quiet day with no competitor-specific news, this second topic is
# what keeps the card from coming back empty - see industry_relevance.py's
# relaxed hard filter, which now accepts genuine trend/analysis content, not
# only company-specific developments.
TOPICS: list[dict] = [
    {"name": "Belkins", "query": "new service pricing case study announcement", "domains": ["belkins.io"]},
    {"name": "SalesRoads", "query": "new service pricing case study announcement", "domains": ["salesroads.com"]},
    {
        "name": "B2B Appointment Setting Industry",
        "query": "B2B appointment setting agency OR SDR-as-a-service company launch funding partnership",
        "news": True,
    },
    {
        "name": "Sales Development Trends",
        "query": "B2B sales development trends OR outbound sales strategy OR SDR industry report OR "
        "AI in sales prospecting OR cold outreach benchmarks",
        "news": True,
    },
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


def _within_window(published_at_iso: str | None, start: date, end: date) -> bool:
    """True if published_at_iso falls within [start, end] (inclusive), or if
    the date is unknown (Tavily doesn't always return one) — the query itself
    is already scoped to the past week via time_range="week", so an unknown
    date isn't treated as stale."""
    if published_at_iso is None:
        return True
    try:
        published_date = datetime.fromisoformat(published_at_iso).date()
        return start <= published_date <= end
    except ValueError:
        return True


def _fetch_topic(topic: dict, start: date, end: date) -> list[dict]:
    name = topic["name"]
    payload = {
        "query": topic["query"],
        "time_range": "week",
        "max_results": _MAX_RESULTS_PER_TOPIC,
    }
    if topic.get("domains"):
        payload["include_domains"] = topic["domains"]
        payload["include_domains_mode"] = "filter"
    if topic.get("news"):
        payload["topic"] = "news"

    try:
        response = httpx.post(
            _API_URL,
            headers={"Authorization": f"Bearer {TAVILY_API_KEY}"},
            json=payload,
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
        if not _within_window(published_at, start, end):
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


def week_bounds(now: datetime) -> tuple[str, str]:
    """Midnight 7 days ago through the following midnight of `now`'s calendar
    day (a rolling 7-day window, inclusive of today), as RFC3339 with an
    explicit UTC offset — used to scope the stored-data read
    (db.list_industry_updates) in the app's own timezone rather than the
    database server's. Mirrors calendar_client.py's _week_bounds."""
    end = datetime.combine(now.date(), datetime.min.time()) + timedelta(days=1)
    start = end - timedelta(days=7)
    if now.tzinfo is not None:
        start, end = start.replace(tzinfo=now.tzinfo), end.replace(tzinfo=now.tzinfo)
    else:
        start, end = start.astimezone(), end.astimezone()
    return start.isoformat(), end.isoformat()


def fetch_recent_updates(today: date) -> list[dict]:
    """Raw (unfiltered) news items for every topic in TOPICS, restricted to
    the past 7 days (through `today`). Empty list (never an exception) on any
    failure: missing API key, unreachable API, rate-limited, or genuinely no
    news matching."""
    if not TAVILY_API_KEY:
        logger.warning("TAVILY_API_KEY not set; Industry Updates disabled.")
        return []

    start = today - timedelta(days=6)  # 7-day window inclusive of today
    items = []
    seen_urls: set[str] = set()
    for topic in TOPICS:
        for item in _fetch_topic(topic, start, today):
            if item["url"] and item["url"] not in seen_urls:
                seen_urls.add(item["url"])
                items.append(item)
    return items
