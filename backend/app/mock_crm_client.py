"""Synthetic CRM source, standing in for hubspot_client.py — reads the
RevenueOS demo data (mock-data/opportunities.json, events.json, leads.json,
contacts.json, organizations.json) and reshapes it into the exact same dict
shapes hubspot_client.py's get_deals()/get_stages()/get_activities()/
get_persons()/get_organizations()/get_leads() already return, so
crm_metrics.py (which only ever calls `pd.get_...()`) needs no changes to
run against this instead of live HubSpot.

V2 source pack (leads.json/contacts.json/organizations.json, added after the
V1 gap report) covers New Qualified Leads and New Contacts properly now.
Organizations is a known partial case — per its generating commit, only 18
of 25 accounts have a record, and the file's own created_date values don't
reconcile against the workbook's "Data Check" tab under either created-date
or last-activity-date (still awaiting a CEO answer on what "new organization"
should mean here). So: org name + last_activity_date (stale-account
tracking) are trusted from the file; an org's add_time is used ONLY when the
file actually has a record for it — never backfilled from its deals' dates
— so "new organizations this period" stays undercounted-but-honest for the
7 accounts missing a record, rather than fabricated. won_deals_count/
open_deals_count are still derived from the deals themselves (matched by
account name), since that's a legitimate roll-up, not an identity fact the
org file would need to supply.
"""

from __future__ import annotations

import json
from pathlib import Path

MOCK_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "mock-data"

# Mirrors Tab 30 "Stage Map" exactly — order_nr/deal_probability per
# RevenueOS Stage, used the same way hubspot_client._fetch_stages() builds
# the HubSpot pipeline-stage list.
_STAGE_DEFS = [
    ("New Lead", 10, 10, False),
    ("Qualified", 20, 25, False),
    ("Discovery", 30, 35, False),
    ("Solution", 40, 50, False),
    ("Proposal", 50, 60, False),
    ("Decision", 60, 80, False),
    ("Won", 90, 100, True),
    ("Lost / Nurture", 95, 0, True),
]


def _read_json(name: str) -> list[dict]:
    path = MOCK_DATA_DIR / name
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def is_configured() -> bool:
    # Always "on" — this is the synthetic demo dataset, not a live
    # integration that can be unconfigured/offline.
    return True


def get_stages() -> list[dict]:
    return [
        {"id": name, "name": name, "order_nr": order, "deal_probability": float(prob), "is_closed": closed}
        for name, order, prob, closed in _STAGE_DEFS
    ]


def get_deals(status: str = "all_not_deleted") -> list[dict]:
    opportunities = _read_json("opportunities.json")
    deals = []
    for o in opportunities:
        status_lower = (o.get("status") or "").lower()
        closed_on = o.get("closed_on")
        # V2 source pack stores probability as a 0-1 fraction (e.g. 0.6);
        # crm_metrics.build_forecast does value * probability/100, so this
        # must be normalized back to a 0-100 scale like HubSpot/V1 used, or
        # every forecast number silently comes out 100x too small.
        raw_prob = o.get("probability")
        probability = raw_prob * 100 if isinstance(raw_prob, (int, float)) and raw_prob <= 1 else raw_prob
        deals.append({
            "id": o["opportunity_id"],
            "title": o.get("deal"),
            "value": float(o.get("value") or 0),
            "currency": o.get("currency") or "GBP",
            "status": status_lower,
            "stage_id": o.get("revenueos_stage"),
            "probability": probability,
            "expected_close_date": o.get("expected_close") if status_lower == "open" else None,
            "won_time": closed_on if status_lower == "won" else None,
            "lost_time": closed_on if status_lower == "lost" else None,
            "add_time": o.get("created_date"),
            "org_name": o.get("account"),
            "owner_name": o.get("owner"),
            "last_activity_date": o.get("last_interaction"),
            "next_activity_date": o.get("next_action_due"),
            "lost_reason": o.get("lost_reason"),
        })
    return deals


def get_activities(done: int | None = None) -> list[dict]:
    events = _read_json("events.json")
    activities = [
        {
            "id": e["event_id"],
            "subject": e.get("summary") or e.get("event_type") or "(untitled event)",
            "type": (e.get("event_type") or "event").lower(),
            "due_date": e.get("commitment_due") or e.get("date"),
            # An event that still needs an action (creates_action: true) is
            # treated as not-yet-done; everything else as done, since the
            # source data has no separate "task completed" flag of its own.
            "done": not e.get("creates_action", False),
        }
        for e in events
    ]
    if done is None:
        return activities
    return [a for a in activities if a["done"] == bool(done)]


def get_persons() -> list[dict]:
    contacts = _read_json("contacts.json")
    return [{"id": c["contact_id"], "add_time": c.get("created_date")} for c in contacts]


def get_organizations() -> list[dict]:
    # won/open deal counts: legitimate roll-up from the deals themselves,
    # matched by account name (every account referenced by a deal gets an
    # entry here, even the 7 missing from organizations.json).
    deals = get_deals()
    counts_by_account: dict[str, dict] = {}
    for d in deals:
        name = d.get("org_name")
        if not name:
            continue
        c = counts_by_account.setdefault(name, {"won": 0, "open": 0})
        if d["status"] == "won":
            c["won"] += 1
        elif d["status"] == "open":
            c["open"] += 1

    # add_time/last_activity_date: ONLY from organizations.json's own
    # records — never backfilled from deal dates (see module docstring on
    # why that would misrepresent an org's real history).
    orgs_file = {o["name"]: o for o in _read_json("organizations.json")}

    all_names = set(counts_by_account) | set(orgs_file)
    result = []
    for name in all_names:
        record = orgs_file.get(name)
        counts = counts_by_account.get(name, {"won": 0, "open": 0})
        result.append({
            "id": record["org_id"] if record else name,
            "name": name,
            "add_time": record.get("created_date") if record else None,
            "last_activity_date": record.get("last_activity_date") if record else None,
            "won_deals_count": counts["won"],
            "open_deals_count": counts["open"],
        })
    return result


def get_leads() -> list[dict]:
    leads = _read_json("leads.json")
    return [
        {
            "id": l["lead_id"],
            "add_time": l.get("created_date"),
            "is_archived": bool(l.get("archived", False)),
            "next_activity_id": l.get("next_activity_source_id"),
        }
        for l in leads
    ]


def warm_cache_in_background() -> None:
    pass  # nothing to pre-fetch; this reads local files, not a network API
