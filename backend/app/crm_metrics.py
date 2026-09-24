"""Derives CEO-facing CRM metrics from raw Pipedrive data (pipedrive_client.py).

Every number here is computed directly from real Pipedrive fields — nothing
is fabricated. Where Pipedrive doesn't give us what we'd need for a metric
(e.g. deal-level probability unset, or multiple currencies mixed together),
that metric comes back as `null` with a plain-English reason in
`limitations`, rather than a guessed value. See MODULE-level docstrings on
each function for exactly which Pipedrive field(s) it reads and how it's
calculated — that doubles as the "how is this metric calculated" answer.

Two explicit, documented assumptions (both configurable constants below,
not hidden magic numbers):
  STALE_ACTIVITY_DAYS — how long since last_activity_date before a deal/
    account is considered "stalled" / "without recent activity".
  APPROACHING_CLOSE_DAYS — how close to expected_close_date counts as
    "approaching" for the risk section.
Pipedrive has no built-in definition of "stalled" or "approaching" — these
are reporting thresholds, called out here so they're easy to find and tune.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta

from . import pipedrive_client as pd

logger = logging.getLogger(__name__)

STALE_ACTIVITY_DAYS = 14
APPROACHING_CLOSE_DAYS = 7
TOP_DEALS_LIMIT = 10
ACTIVITY_TYPE_LABELS = {"call": "Calls", "meeting": "Meetings", "email": "Emails", "task": "Tasks"}

# Thresholds for the single proactive insight line Ask Friday may surface
# unprompted (see build_notable_insight) — another explicit, tunable
# assumption, not a hidden magic number. Deliberately conservative: this is
# the one exception to "never volunteer," so it should only fire for
# something genuinely worth interrupting for.
NOTABLE_REVENUE_DROP_PCT = -20.0
NOTABLE_OVERDUE_ACTIVITIES = 5

# Trailing window for the "Deal Win Rate" Daily Brief card — deliberately
# NOT tied to the dashboard's selected date-range filter, since a win-rate
# stat is more meaningful over a rolling window than "since the 1st of the
# month." Configurable here, not a hidden magic number.
WIN_RATE_WINDOW_DAYS = 90


# ---------------------------------------------------------------------------
# Parsing helpers — Pipedrive dates are plain "YYYY-MM-DD" or
# "YYYY-MM-DD HH:MM:SS" strings, not RFC3339, and several fields
# (org_id/person_id/user_id) are either an int, null, or an expanded object
# depending on the endpoint — helpers below normalize both.
# ---------------------------------------------------------------------------

def _parse_date(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return datetime.strptime(raw[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _linked_name(field) -> str | None:
    """org_id / person_id / user_id come back as an expanded {"value":..,
    "name":..} object on the /deals endpoint, or occasionally a bare id."""
    if isinstance(field, dict):
        return field.get("name")
    return None


def resolve_range(
    range_key: str, custom_start: str | None, custom_end: str | None, today: date
) -> tuple[date, date, str | None]:
    """Maps a range key to a concrete [start, end] (inclusive) date pair.
    "Period to date" semantics for week/month/quarter/year (e.g. "this
    month" = the 1st through today, not the full calendar month) since a
    CEO dashboard filter is almost always used to answer "how are we doing
    so far this period," matching common SaaS-dashboard convention.
    Returns (start, end, error) — error is set (and start/end default to
    today) if range_key=="custom" without valid start/end."""
    if range_key == "today":
        return today, today, None
    if range_key == "week":
        return today - timedelta(days=today.weekday()), today, None
    if range_key == "month":
        return today.replace(day=1), today, None
    if range_key == "quarter":
        q_start_month = ((today.month - 1) // 3) * 3 + 1
        return today.replace(month=q_start_month, day=1), today, None
    if range_key == "year":
        return today.replace(month=1, day=1), today, None
    if range_key == "custom":
        s, e = _parse_date(custom_start), _parse_date(custom_end)
        if s and e and s <= e:
            return s, e, None
        return today, today, "invalid or missing custom start/end; defaulted to today"
    return today, today, f"unknown range '{range_key}'; defaulted to today"


def _previous_period(start: date, end: date) -> tuple[date, date]:
    """The immediately-preceding period of equal length, for the KPI cards'
    period-over-period comparison."""
    span = (end - start).days + 1
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=span - 1)
    return prev_start, prev_end


def _pct_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return None  # undefined, not "infinite%" — don't fabricate a number
    return round(((current - previous) / previous) * 100, 1)


def _stage_lookup(stages: list[dict]) -> dict[int, dict]:
    return {s["id"]: s for s in stages}


def _sum_value(deals: list[dict]) -> float:
    return round(sum(float(d.get("value") or 0) for d in deals), 2)


def _mixed_currency_note(deals: list[dict], label: str) -> str | None:
    currencies = {d.get("currency") for d in deals if d.get("currency")}
    if len(currencies) > 1:
        return (
            f"{label}: deals use multiple currencies ({', '.join(sorted(currencies))}) "
            "summed at face value with no FX conversion — treat as approximate."
        )
    return None


# ---------------------------------------------------------------------------
# Revenue
# ---------------------------------------------------------------------------

def _won_in_range(won_deals: list[dict], start: date, end: date) -> list[dict]:
    out = []
    for d in won_deals:
        won_on = _parse_date(d.get("won_time"))
        if won_on and start <= won_on <= end:
            out.append(d)
    return out


def build_revenue(all_deals: list[dict], start: date, end: date, limitations: list[str]) -> dict:
    """won deal value: sum(value) for status=="won" deals whose won_time
    falls in [start, end]. "Pipeline value" = sum(value) of all currently
    open deals (not date-scoped — pipeline is a point-in-time snapshot).
    Growth = % change vs. the immediately preceding period of equal length."""
    won_deals = [d for d in all_deals if d.get("status") == "won"]
    open_deals = [d for d in all_deals if d.get("status") == "open"]

    in_range = _won_in_range(won_deals, start, end)
    prev_start, prev_end = _previous_period(start, end)
    in_prev_range = _won_in_range(won_deals, prev_start, prev_end)

    revenue = _sum_value(in_range)
    prev_revenue = _sum_value(in_prev_range)

    note = _mixed_currency_note(in_range, "Revenue (won deals)")
    if note:
        limitations.append(note)

    return {
        "won_revenue": revenue,
        "won_deal_count": len(in_range),
        "pipeline_value": _sum_value(open_deals),
        "growth_pct": _pct_change(revenue, prev_revenue),
        "previous_period_revenue": prev_revenue,
    }


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def build_pipeline(all_deals: list[dict], stages: list[dict], today: date) -> dict:
    """Pipeline-by-stage: groups every OPEN deal by stage_id (from
    /stages, mapped id -> name/order) summing value and counting deals per
    stage — a point-in-time snapshot, not date-range-scoped, since "current
    pipeline" means deals open right now regardless of when they were
    created."""
    open_deals = [d for d in all_deals if d.get("status") == "open"]
    stage_by_id = _stage_lookup(stages)

    by_stage: dict[int, dict] = {}
    for d in open_deals:
        sid = d.get("stage_id")
        stage = stage_by_id.get(sid)
        name = stage["name"] if stage else f"Stage {sid}"
        order = stage["order_nr"] if stage else 999
        row = by_stage.setdefault(sid, {"stage_id": sid, "stage_name": name, "order": order, "count": 0, "value": 0.0})
        row["count"] += 1
        row["value"] += float(d.get("value") or 0)

    stage_rows = sorted(by_stage.values(), key=lambda r: r["order"])
    for r in stage_rows:
        r["value"] = round(r["value"], 2)

    approaching = []
    overdue = []
    for d in open_deals:
        close_on = _parse_date(d.get("expected_close_date"))
        if not close_on:
            continue
        if close_on < today:
            overdue.append(d)
        elif close_on <= today + timedelta(days=APPROACHING_CLOSE_DAYS):
            approaching.append(d)

    # Open deals expected to close within the current calendar month (for
    # the "Open Sales Pipeline" Daily Brief card's "expected to close this
    # month" subtext) — a calendar-month window, not date-range-scoped.
    month_start = today.replace(day=1)
    month_end = (
        date(today.year + 1, 1, 1) if today.month == 12 else date(today.year, today.month + 1, 1)
    ) - timedelta(days=1)
    closing_this_month = [
        d for d in open_deals
        if (close_on := _parse_date(d.get("expected_close_date"))) and month_start <= close_on <= month_end
    ]

    return {
        "total_open_value": _sum_value(open_deals),
        "total_open_count": len(open_deals),
        "by_stage": stage_rows,
        "approaching_close_count": len(approaching),
        "overdue_close_count": len(overdue),
        "closing_this_month_value": _sum_value(closing_this_month),
        "closing_this_month_count": len(closing_this_month),
    }


# ---------------------------------------------------------------------------
# Qualified leads (Daily Brief card) — Pipedrive's own Leads Inbox is unused
# on this account (checked directly against /leads: always empty), so there
# is no dedicated "lead" object or qualification field to read. Instead this
# uses the pipeline's own stage design as the qualification signal: every
# deal starts in the pipeline's first stage (its lowest order_nr, e.g. "Lead
# generation") and only advances once it's been worked — so "qualified" =
# a deal that has moved past that first stage. This is a business-defined
# proxy, not a Pipedrive-native field, so it's called out explicitly here
# rather than assumed to be authoritative the way stage/value/date fields are.
# ---------------------------------------------------------------------------

def build_qualified_leads(all_deals: list[dict], stages: list[dict], start: date, end: date) -> dict:
    """count_this_month: deals added (add_time) in [start, end] whose current
    stage is past the pipeline's first stage — i.e. they've been qualified/
    worked, regardless of whether they later won, lost, or are still open.
    pct_change_vs_last_month: vs. the immediately preceding period of equal
    length (None if nothing qualified last period — undefined, not 0%).
    awaiting_first_contact: OPEN deals still sitting in the first stage with
    no last_activity_date recorded yet — i.e. raw leads nobody has touched."""
    if not stages:
        return {"count_this_month": None, "pct_change_vs_last_month": None, "awaiting_first_contact": None}

    first_stage_id = min(stages, key=lambda s: s["order_nr"])["id"]

    def added_in(d: dict, s: date, e: date) -> bool:
        added = _parse_date(d.get("add_time"))
        return added is not None and s <= added <= e

    qualified = [d for d in all_deals if d.get("stage_id") != first_stage_id]
    qualified_this_month = [d for d in qualified if added_in(d, start, end)]
    prev_start, prev_end = _previous_period(start, end)
    qualified_prev_month = [d for d in qualified if added_in(d, prev_start, prev_end)]

    open_deals = [d for d in all_deals if d.get("status") == "open"]
    awaiting_first_contact = [
        d for d in open_deals if d.get("stage_id") == first_stage_id and not d.get("last_activity_date")
    ]

    return {
        "count_this_month": len(qualified_this_month),
        "pct_change_vs_last_month": _pct_change(len(qualified_this_month), len(qualified_prev_month)),
        "awaiting_first_contact": len(awaiting_first_contact),
    }


# ---------------------------------------------------------------------------
# Deals table
# ---------------------------------------------------------------------------

def _deal_row(d: dict, today: date) -> dict:
    added = _parse_date(d.get("add_time"))
    return {
        "id": d.get("id"),
        "name": d.get("title"),
        "company": _linked_name(d.get("org_id")) or d.get("org_name"),
        "value": d.get("value"),
        "currency": d.get("currency"),
        "stage_id": d.get("stage_id"),
        "probability": d.get("probability"),
        "expected_close_date": d.get("expected_close_date"),
        "owner": _linked_name(d.get("user_id")) or d.get("owner_name"),
        "age_days": (today - added).days if added else None,
        "last_activity_date": d.get("last_activity_date"),
        "next_activity_date": d.get("next_activity_date"),
    }


def build_top_deals(all_deals: list[dict], stages: list[dict], today: date) -> list[dict]:
    """Top open deals by value, descending, capped at TOP_DEALS_LIMIT — a
    compact "what matters most right now" table rather than a full deal
    list."""
    open_deals = [d for d in all_deals if d.get("status") == "open"]
    stage_by_id = _stage_lookup(stages)
    ranked = sorted(open_deals, key=lambda d: float(d.get("value") or 0), reverse=True)[:TOP_DEALS_LIMIT]
    rows = []
    for d in ranked:
        row = _deal_row(d, today)
        stage = stage_by_id.get(d.get("stage_id"))
        row["stage_name"] = stage["name"] if stage else None
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Risks / attention required
# ---------------------------------------------------------------------------

def build_risks(all_deals: list[dict], stages: list[dict], today: date) -> dict:
    """Every item here is a factual read of Pipedrive fields, not a scored
    heuristic:
      - overdue: open deal, expected_close_date < today
      - approaching_close: open deal, expected_close_date within
        APPROACHING_CLOSE_DAYS
      - stalled: open deal, last_activity_date is null or older than
        STALE_ACTIVITY_DAYS
      - large_without_upcoming_activity: open deal in the top half of open
        deal values (by median) with no next_activity_date set at all
    """
    open_deals = [d for d in all_deals if d.get("status") == "open"]
    stage_by_id = _stage_lookup(stages)

    def with_stage(d: dict) -> dict:
        row = _deal_row(d, today)
        stage = stage_by_id.get(d.get("stage_id"))
        row["stage_name"] = stage["name"] if stage else None
        return row

    overdue, approaching, stalled = [], [], []
    for d in open_deals:
        close_on = _parse_date(d.get("expected_close_date"))
        if close_on:
            if close_on < today:
                overdue.append(with_stage(d))
            elif close_on <= today + timedelta(days=APPROACHING_CLOSE_DAYS):
                approaching.append(with_stage(d))
        last_activity = _parse_date(d.get("last_activity_date"))
        if last_activity is None or (today - last_activity).days > STALE_ACTIVITY_DAYS:
            stalled.append(with_stage(d))

    values = sorted(float(d.get("value") or 0) for d in open_deals)
    median = values[len(values) // 2] if values else 0
    large_no_activity = [
        with_stage(d)
        for d in open_deals
        if float(d.get("value") or 0) >= median and not d.get("next_activity_date")
    ]

    return {
        "overdue_close_deals": overdue,
        "approaching_close_deals": approaching,
        "stalled_deals": stalled,
        "large_deals_without_upcoming_activity": large_no_activity,
        "stale_activity_threshold_days": STALE_ACTIVITY_DAYS,
        "approaching_close_threshold_days": APPROACHING_CLOSE_DAYS,
    }


# ---------------------------------------------------------------------------
# Activities
# ---------------------------------------------------------------------------

def build_activities(activities: list[dict], start: date, end: date, today: date) -> dict:
    """by_type: counts activities (any done state) whose due_date falls in
    [start, end], grouped by Pipedrive's `type` field, bucketed into
    Calls/Meetings/Emails/Tasks (anything else grouped as "Other").
    overdue/due_today/upcoming are NOT date-range-scoped (always relative to
    `today`) since those are operational, "what needs doing right now"
    numbers regardless of which reporting period is selected."""
    in_range = [a for a in activities if (d := _parse_date(a.get("due_date"))) and start <= d <= end]

    by_type: dict[str, int] = defaultdict(int)
    for a in in_range:
        label = ACTIVITY_TYPE_LABELS.get(a.get("type"), "Other")
        by_type[label] += 1

    not_done = [a for a in activities if not a.get("done")]
    overdue = [a for a in not_done if (d := _parse_date(a.get("due_date"))) and d < today]
    due_today = [a for a in not_done if _parse_date(a.get("due_date")) == today]
    upcoming = [a for a in not_done if (d := _parse_date(a.get("due_date"))) and d > today]

    return {
        "by_type": dict(by_type),
        "overdue_count": len(overdue),
        "due_today_count": len(due_today),
        "upcoming_count": len(upcoming),
        "recent": sorted(in_range, key=lambda a: a.get("due_date") or "", reverse=True)[:15],
    }


# ---------------------------------------------------------------------------
# Contacts / companies
# ---------------------------------------------------------------------------

def build_contacts(persons: list[dict], orgs: list[dict], start: date, end: date) -> dict:
    """new_contacts/new_organizations: add_time within [start, end].
    active_customers: orgs with won_deals_count > 0 (Pipedrive computes this
    field itself). prospects: orgs with open_deals_count > 0 and
    won_deals_count == 0. accounts_without_recent_activity: orgs whose
    last_activity_date is null or older than STALE_ACTIVITY_DAYS relative
    to `end`."""
    new_contacts = [p for p in persons if (d := _parse_date(p.get("add_time"))) and start <= d <= end]
    new_orgs = [o for o in orgs if (d := _parse_date(o.get("add_time"))) and start <= d <= end]
    active_customers = [o for o in orgs if (o.get("won_deals_count") or 0) > 0]
    prospects = [
        o for o in orgs
        if (o.get("open_deals_count") or 0) > 0 and (o.get("won_deals_count") or 0) == 0
    ]
    stale = [
        o for o in orgs
        if not (la := _parse_date(o.get("last_activity_date"))) or (end - la).days > STALE_ACTIVITY_DAYS
    ]

    return {
        "new_contacts_count": len(new_contacts),
        "new_organizations_count": len(new_orgs),
        "active_customers_count": len(active_customers),
        "prospects_count": len(prospects),
        "accounts_without_recent_activity_count": len(stale),
        "accounts_without_recent_activity": [
            {"id": o.get("id"), "name": o.get("name"), "last_activity_date": o.get("last_activity_date")}
            for o in stale[:15]
        ],
    }


# ---------------------------------------------------------------------------
# Conversion + forecast
# ---------------------------------------------------------------------------

def build_conversion(all_deals: list[dict], start: date, end: date, limitations: list[str]) -> dict | None:
    """won / (won + lost) among deals whose won_time/lost_time falls in
    [start, end]. Returns None (not 0%) if there's no closed-deal activity
    in the range at all — an undefined rate is not the same as a 0% rate."""
    won = [d for d in all_deals if d.get("status") == "won" and (w := _parse_date(d.get("won_time"))) and start <= w <= end]
    lost = [d for d in all_deals if d.get("status") == "lost" and (l := _parse_date(d.get("lost_time"))) and start <= l <= end]
    total = len(won) + len(lost)
    if total == 0:
        return None
    return {
        "won_count": len(won),
        "lost_count": len(lost),
        "rate_pct": round(len(won) / total * 100, 1),
    }


def build_win_rate(all_deals: list[dict], today: date, window_days: int = WIN_RATE_WINDOW_DAYS) -> dict:
    """Win rate over a trailing window ending today (see WIN_RATE_WINDOW_DAYS)
    for the Daily Brief's "Deal Win Rate" card — won / (won + lost) among
    deals whose won_time/lost_time falls in the last `window_days` days.
    rate_pct is None (not 0%) when nothing closed in the window at all."""
    start = today - timedelta(days=window_days - 1)
    won = [d for d in all_deals if d.get("status") == "won" and (w := _parse_date(d.get("won_time"))) and start <= w <= today]
    lost = [d for d in all_deals if d.get("status") == "lost" and (l := _parse_date(d.get("lost_time"))) and start <= l <= today]
    total = len(won) + len(lost)
    return {
        "won_count": len(won),
        "lost_count": len(lost),
        "closed_count": total,
        "rate_pct": round(len(won) / total * 100, 1) if total else None,
        "window_days": window_days,
    }


def build_forecast(all_deals: list[dict], stages: list[dict], start: date, end: date, limitations: list[str]) -> dict | None:
    """Weighted forecast = sum(value * probability/100) for open deals with
    an expected_close_date in [start, end]. Uses the deal's own
    `probability` if set, else falls back to its stage's
    `deal_probability` (Pipedrive's per-stage default win %). If NEITHER
    is available for a deal, that deal is excluded from the forecast total
    and counted in `excluded_no_probability` — never assumed to be 0% or
    100%, since that would fabricate a number Pipedrive doesn't provide."""
    stage_by_id = _stage_lookup(stages)
    open_deals = [d for d in all_deals if d.get("status") == "open"]
    in_range = [
        d for d in open_deals
        if (c := _parse_date(d.get("expected_close_date"))) and start <= c <= end
    ]
    if not in_range:
        return None

    forecast_value = 0.0
    included = 0
    excluded = 0
    for d in in_range:
        prob = d.get("probability")
        if prob is None:
            stage = stage_by_id.get(d.get("stage_id"))
            prob = stage.get("deal_probability") if stage else None
        if prob is None:
            excluded += 1
            continue
        forecast_value += float(d.get("value") or 0) * (float(prob) / 100)
        included += 1

    if included == 0:
        limitations.append(
            "Sales forecast unavailable: none of the deals with an expected close date in "
            "this range have a probability set on the deal or its stage. Set deal_probability "
            "on each pipeline stage in Pipedrive, or set probability on individual deals, to "
            "enable this."
        )
        return None

    if excluded:
        limitations.append(
            f"Sales forecast excludes {excluded} deal(s) in range with no probability set "
            "(deal or stage-level) — forecast is a partial total, not the full open pipeline."
        )

    return {
        "forecast_value": round(forecast_value, 2),
        "included_deal_count": included,
        "excluded_no_probability_count": excluded,
    }


# ---------------------------------------------------------------------------
# Revenue trend (chart)
# ---------------------------------------------------------------------------

_TREND_BUCKET_DAYS = {"7d": 1, "30d": 1, "90d": 7, "quarter": 7, "year": 30}
_TREND_SPAN_DAYS = {"7d": 7, "30d": 30, "90d": 90, "quarter": 92, "year": 365}


def build_revenue_trend(all_deals: list[dict], period: str, today: date) -> dict:
    """Buckets WON deal value by won_time into fixed-size buckets (1 day
    for 7d/30d views, weekly for 90d/quarter, monthly-ish 30-day buckets
    for year) so the chart stays readable at each zoom level rather than
    plotting 365 individual daily points."""
    span_days = _TREND_SPAN_DAYS.get(period, 30)
    bucket_days = _TREND_BUCKET_DAYS.get(period, 1)
    start = today - timedelta(days=span_days - 1)

    won_deals = [d for d in all_deals if d.get("status") == "won"]
    won_by_date: dict[date, float] = defaultdict(float)
    for d in won_deals:
        won_on = _parse_date(d.get("won_time"))
        if won_on and start <= won_on <= today:
            won_by_date[won_on] += float(d.get("value") or 0)

    points = []
    cursor = start
    while cursor <= today:
        bucket_end = min(cursor + timedelta(days=bucket_days - 1), today)
        total = sum(v for d, v in won_by_date.items() if cursor <= d <= bucket_end)
        points.append({"date": cursor.isoformat(), "value": round(total, 2)})
        cursor = bucket_end + timedelta(days=1)

    return {"period": period, "points": points}


# ---------------------------------------------------------------------------
# Won vs lost (chart)
# ---------------------------------------------------------------------------

def build_won_vs_lost(all_deals: list[dict], start: date, end: date) -> list[dict]:
    """Monthly won vs. lost VALUE totals across [start, end] — month
    buckets keyed by the deal's won_time/lost_time month."""
    won_deals = [d for d in all_deals if d.get("status") == "won"]
    lost_deals = [d for d in all_deals if d.get("status") == "lost"]

    buckets: dict[str, dict] = {}

    def month_key(d: date) -> str:
        return f"{d.year:04d}-{d.month:02d}"

    def add(deals: list[dict], time_field: str, out_field: str):
        for d in deals:
            on = _parse_date(d.get(time_field))
            if on and start <= on <= end:
                key = month_key(on)
                row = buckets.setdefault(key, {"month": key, "won_value": 0.0, "lost_value": 0.0})
                row[out_field] += float(d.get("value") or 0)

    add(won_deals, "won_time", "won_value")
    add(lost_deals, "lost_time", "lost_value")

    rows = sorted(buckets.values(), key=lambda r: r["month"])
    for r in rows:
        r["won_value"] = round(r["won_value"], 2)
        r["lost_value"] = round(r["lost_value"], 2)
    return rows


# ---------------------------------------------------------------------------
# Deals-by-stage (donut chart) — same grouping as pipeline.by_stage, kept as
# a thin separate accessor so the frontend chart and the pipeline bar chart
# can each just take the slice of the response they need.
# ---------------------------------------------------------------------------

def build_deals_by_stage_chart(pipeline: dict) -> list[dict]:
    return [{"stage_name": r["stage_name"], "count": r["count"], "value": r["value"]} for r in pipeline["by_stage"]]


# ---------------------------------------------------------------------------
# Deals by owner (rep leaderboard chart) — ALL open deals, not just the
# TOP_DEALS_LIMIT-capped top_deals table, so the ranking is complete.
# ---------------------------------------------------------------------------

def build_deals_by_owner(all_deals: list[dict]) -> list[dict]:
    """Open deal value + count grouped by owner (Pipedrive's user_id, expanded
    name), sorted by value descending. Deals with no owner set are grouped
    under "Unassigned" rather than dropped, so the total always reconciles
    with pipeline.total_open_value."""
    open_deals = [d for d in all_deals if d.get("status") == "open"]
    by_owner: dict[str, dict] = {}
    for d in open_deals:
        owner = _linked_name(d.get("user_id")) or d.get("owner_name") or "Unassigned"
        row = by_owner.setdefault(owner, {"owner": owner, "value": 0.0, "count": 0})
        row["value"] += float(d.get("value") or 0)
        row["count"] += 1
    rows = sorted(by_owner.values(), key=lambda r: r["value"], reverse=True)
    for r in rows:
        r["value"] = round(r["value"], 2)
    return rows


# ---------------------------------------------------------------------------
# Lost deal reasons (donut chart) — Pipedrive's own `lost_reason` field on
# lost deals, grouped and counted; never inferred or guessed.
# ---------------------------------------------------------------------------

def build_lost_reasons(all_deals: list[dict], start: date, end: date) -> list[dict]:
    """Lost deals whose lost_time falls in [start, end], grouped by Pipedrive's
    lost_reason field. Deals lost with no reason recorded are grouped under
    "Not specified" rather than dropped, so counts reconcile with the total
    lost-deal count for the period."""
    lost_deals = [
        d for d in all_deals
        if d.get("status") == "lost" and (lt := _parse_date(d.get("lost_time"))) and start <= lt <= end
    ]
    by_reason: dict[str, dict] = {}
    for d in lost_deals:
        reason = (d.get("lost_reason") or "").strip() or "Not specified"
        row = by_reason.setdefault(reason, {"reason": reason, "count": 0, "value": 0.0})
        row["count"] += 1
        row["value"] += float(d.get("value") or 0)
    rows = sorted(by_reason.values(), key=lambda r: r["count"], reverse=True)
    for r in rows:
        r["value"] = round(r["value"], 2)
    return rows


# ---------------------------------------------------------------------------
# Proactive insight — the one thing Ask Friday may surface unprompted (see
# NOTABLE_* thresholds above). Only ever built from metrics this module
# already computes honestly elsewhere; never a new/fabricated comparison.
# ---------------------------------------------------------------------------


def build_notable_insight(revenue: dict, risks: dict, activity_metrics: dict) -> dict | None:
    """Picks at most ONE notable signal to surface, most severe first, so the
    UI never has to juggle competing insights. Returns None when nothing
    crosses a threshold - "quiet" is the common case, not an error."""
    overdue_deals = risks["overdue_close_deals"]
    if overdue_deals:
        total_value = sum(float(d.get("value") or 0) for d in overdue_deals)
        return {
            "message": (
                f"{len(overdue_deals)} deal{'s' if len(overdue_deals) != 1 else ''} "
                f"past their expected close date (${total_value:,.0f} total) — want details?"
            ),
            "query": "What deals are overdue on their expected close date?",
        }

    growth = revenue.get("growth_pct")
    if growth is not None and growth <= NOTABLE_REVENUE_DROP_PCT:
        return {
            "message": f"Won revenue is down {abs(growth):.0f}% vs. the previous period — want details?",
            "query": "Why is revenue down compared to last period?",
        }

    overdue_activities = activity_metrics["overdue_count"]
    if overdue_activities >= NOTABLE_OVERDUE_ACTIVITIES:
        return {
            "message": f"{overdue_activities} overdue activities in the CRM — want details?",
            "query": "What activities are overdue right now?",
        }

    return None


# ---------------------------------------------------------------------------
# Top-level orchestration
# ---------------------------------------------------------------------------

def build_overview(
    range_key: str,
    custom_start: str | None,
    custom_end: str | None,
    trend_period: str,
    today: date,
    revenue_target: float | None = None,
) -> dict:
    if not pd.is_configured():
        return {
            "configured": False,
            "message": (
                "Pipedrive is not configured — set PIPEDRIVE_API_TOKEN and PIPEDRIVE_DOMAIN "
                "in the backend environment to enable live CRM data."
            ),
        }

    start, end, range_error = resolve_range(range_key, custom_start, custom_end, today)
    limitations: list[str] = []
    if range_error:
        limitations.append(range_error)

    all_deals = pd.get_deals("all_not_deleted")
    stages = pd.get_stages()
    activities = pd.get_activities()
    persons = pd.get_persons()
    orgs = pd.get_organizations()

    if not all_deals and not stages:
        limitations.append(
            "No data returned from Pipedrive for deals/stages — check the API token's "
            "permissions or whether the account actually has deals."
        )

    revenue = build_revenue(all_deals, start, end, limitations)
    pipeline = build_pipeline(all_deals, stages, today)
    qualified_leads = build_qualified_leads(all_deals, stages, start, end)
    top_deals = build_top_deals(all_deals, stages, today)
    risks = build_risks(all_deals, stages, today)
    activity_metrics = build_activities(activities, start, end, today)
    contacts = build_contacts(persons, orgs, start, end)
    conversion = build_conversion(all_deals, start, end, limitations)
    win_rate = build_win_rate(all_deals, today)
    forecast = build_forecast(all_deals, stages, start, end, limitations)
    trend = build_revenue_trend(all_deals, trend_period, today)
    won_vs_lost = build_won_vs_lost(all_deals, start, end)
    deals_by_stage = build_deals_by_stage_chart(pipeline)
    deals_by_owner = build_deals_by_owner(all_deals)
    lost_reasons = build_lost_reasons(all_deals, start, end)
    notable_insight = build_notable_insight(revenue, risks, activity_metrics)

    return {
        "configured": True,
        "range": {"key": range_key, "start": start.isoformat(), "end": end.isoformat()},
        "kpis": {
            "won_revenue": revenue["won_revenue"],
            "revenue_growth_pct": revenue["growth_pct"],
            "open_pipeline_value": pipeline["total_open_value"],
            "deals_won": revenue["won_deal_count"],
            "conversion_rate_pct": conversion["rate_pct"] if conversion else None,
            "activities_due": activity_metrics["overdue_count"] + activity_metrics["due_today_count"],
            "new_contacts": contacts["new_contacts_count"],
        },
        "revenue": revenue,
        "pipeline": pipeline,
        "qualified_leads": qualified_leads,
        "top_deals": top_deals,
        "risks": risks,
        "activities": activity_metrics,
        "contacts": contacts,
        "conversion": conversion,
        "win_rate": win_rate,
        "revenue_target": revenue_target,
        "forecast": forecast,
        "revenue_trend": trend,
        "won_vs_lost": won_vs_lost,
        "deals_by_stage": deals_by_stage,
        "deals_by_owner": deals_by_owner,
        "lost_reasons": lost_reasons,
        "limitations": limitations,
        "notable_insight": notable_insight,
    }
