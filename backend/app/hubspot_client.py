"""Raw HubSpot API access (api.hubapi.com) — replaced pipedrive_client.py as
the CEO/CRM dashboard's data source. This module fetches deals, pipeline
stages, owners, companies, contacts, and engagements (tasks/calls/meetings),
then assembles them into the EXACT dict shape crm_metrics.py already expects
(mirrors pipedrive_client.py's public function names and each dict's field
names) — so crm_metrics.py itself needed no changes beyond which client
module it imports.

Same fail-safe convention as pipedrive_client.py/tavily/industry_client: a
missing token or an unreachable/erroring API never raises — it logs and
returns an empty list, so a HubSpot outage degrades the CRM dashboard to "no
data" rather than crashing it.

Field-mapping decisions worth knowing (HubSpot's data model isn't 1:1 with
Pipedrive's, so these are real translations, not guesses left undocumented):

- status (open/won/lost): HubSpot deals have a `dealstage` id, not a status
  enum. Derived from that stage's own metadata: isClosed=false -> "open";
  isClosed=true and probability>=0.99 -> "won"; isClosed=true and
  probability<=0.01 -> "lost". (Every closed stage seen on this account's
  pipelines follows that convention; see get_stages.)
- probability: HubSpot's per-STAGE probability (0-1), not a per-deal one
  (Pipedrive has both; HubSpot's UI exposes only the stage-level default) —
  converted to 0-100 to match crm_metrics.py's convention.
  expected_close_date / won_time / lost_time: HubSpot has one `closedate`
  property per deal, reused for either meaning depending on Pipedrive's own
  convention (forecast date while open, actual close date once closed) —
  same value, read differently: expected_close_date when the deal is still
  open, won_time/lost_time when it's closed.
- org/owner: resolved via the Associations API (deal -> company) and the
  Owners API (hubspot_owner_id -> name), not fabricated if missing.
- last_activity_date / next_activity_date: HubSpot doesn't put these on the
  deal record itself (Pipedrive does) — derived from Tasks/Calls/Meetings
  associated with each deal via the Associations API. A deal with no
  associated engagements simply has neither field set (None), not guessed.
- "qualified lead": HubSpot has no separate Leads Inbox object the way
  Pipedrive does — a "lead" here is a Contact at a given `lifecyclestage`.
  QUALIFIED_LIFECYCLE_STAGES (below) defines which stages count as
  "qualified" for the Daily Brief card; change that constant to adjust the
  business definition.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx

from .config import HUBSPOT_ACCESS_TOKEN

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.hubapi.com"
_TIMEOUT_SECONDS = 20
_PAGE_LIMIT = 100

# One pooled client for every HubSpot call: keeps the TLS connection alive
# between requests instead of paying a fresh DNS + TLS handshake (~1s from
# the backend) on each of the ~20 calls one CRM overview needs.
_client = httpx.Client(timeout=_TIMEOUT_SECONDS)

# Independent HubSpot calls run concurrently, capped well under HubSpot's
# private-app burst limit (100 requests / 10s).
_MAX_PARALLEL = 8

# How long a fetched snapshot is served as-is. Past that, the stale copy is
# still returned immediately while a background refresh runs, up to
# _SNAPSHOT_MAX_STALE_SECONDS — after which a caller waits for fresh data.
_SNAPSHOT_TTL_SECONDS = 120
_SNAPSHOT_MAX_STALE_SECONDS = 30 * 60

# Lifecycle stages (HubSpot's own contact property `lifecyclestage`) that
# count as a "qualified" lead for the Daily Brief card — everything past the
# raw, un-worked "lead" stage. Documented here, not a hidden assumption; see
# module docstring.
QUALIFIED_LIFECYCLE_STAGES = {"marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer"}


def is_configured() -> bool:
    return bool(HUBSPOT_ACCESS_TOKEN)


def _headers() -> dict:
    return {"Authorization": f"Bearer {HUBSPOT_ACCESS_TOKEN}"}


def _get_paginated(path: str, params: dict | None = None) -> list[dict]:
    """Follows HubSpot's cursor-based pagination (paging.next.after) until
    exhausted. Returns [] on any failure or if HubSpot isn't configured."""
    if not is_configured():
        return []

    items: list[dict] = []
    params = dict(params or {})
    params["limit"] = _PAGE_LIMIT
    after: str | None = None

    while True:
        p = dict(params)
        if after:
            p["after"] = after
        try:
            response = _client.get(f"{_BASE_URL}{path}", headers=_headers(), params=p)
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.warning("HubSpot API error %s for %s: %s", e.response.status_code, path, e.response.text[:200])
            return items
        except httpx.HTTPError as e:
            logger.warning("HubSpot API unreachable for %s: %s", path, e)
            return items

        body = response.json()
        items.extend(body.get("results") or [])

        after = ((body.get("paging") or {}).get("next") or {}).get("after")
        if not after:
            break

    return items


def _fetch_stages() -> list[dict]:
    """Flattened stages across every deal pipeline in the account (an account
    can have more than one; Pipedrive's /stages wasn't scoped to a single
    pipeline either). Pipedrive-shaped: {id, name, order_nr, deal_probability,
    is_closed}. deal_probability is 0-100."""
    if not is_configured():
        return []
    try:
        response = _client.get(f"{_BASE_URL}/crm/v3/pipelines/deals", headers=_headers())
        response.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("Could not fetch HubSpot deal pipelines: %s", e)
        return []

    stages = []
    order = 0
    for pipeline in response.json().get("results") or []:
        for stage in pipeline.get("stages") or []:
            meta = stage.get("metadata") or {}
            prob_raw = meta.get("probability")
            stages.append({
                "id": stage["id"],
                "name": stage.get("label") or stage["id"],
                "order_nr": order,
                "deal_probability": float(prob_raw) * 100 if prob_raw not in (None, "") else None,
                "is_closed": str(meta.get("isClosed")).lower() == "true",
            })
            order += 1
    return stages


def _owner_names() -> dict[str, str]:
    """hubspot_owner_id -> display name, for both deal.owner_name and the
    Best-Owners chart."""
    owners = _get_paginated("/crm/v3/owners")
    names: dict[str, str] = {}
    for o in owners:
        name = f"{o.get('firstName') or ''} {o.get('lastName') or ''}".strip() or o.get("email") or str(o.get("id"))
        names[str(o.get("id"))] = name
    return names


def _batch_associations(from_type: str, to_type: str, object_ids: list[str]) -> dict[str, str]:
    """First associated `to_type` id for each `from_type` id, via HubSpot's
    batch read endpoint (one call per 100 ids, not one call per object).
    Returns {} on any failure -- a missing association link is treated the
    same as "none set", never guessed."""
    if not is_configured() or not object_ids:
        return {}

    result: dict[str, str] = {}
    for i in range(0, len(object_ids), _PAGE_LIMIT):
        batch = object_ids[i:i + _PAGE_LIMIT]
        try:
            response = _client.post(
                f"{_BASE_URL}/crm/v4/associations/{from_type}/{to_type}/batch/read",
                headers=_headers(),
                json={"inputs": [{"id": oid} for oid in batch]},
            )
            response.raise_for_status()
        except httpx.HTTPError as e:
            logger.warning("Could not fetch HubSpot associations %s -> %s: %s", from_type, to_type, e)
            continue
        for row in response.json().get("results") or []:
            from_id = str((row.get("from") or {}).get("id") or "")
            to_list = row.get("to") or []
            if from_id and to_list:
                result[from_id] = str(to_list[0].get("toObjectId") or to_list[0].get("id") or "")
    return result


# (object type, timestamp property, status property) for the engagement types
# last/next activity dates are derived from. Tasks are fetched with the extra
# properties get_activities() needs too, so they're only fetched once.
_ENGAGEMENT_TYPES = (
    ("tasks", "hs_timestamp", "hs_task_status"),
    ("calls", "hs_timestamp", None),
    ("meetings", "hs_timestamp", None),
)
_ENGAGEMENT_PROPERTIES = {
    "tasks": "hs_task_subject,hs_task_status,hs_timestamp,hs_task_type",
    "calls": "hs_timestamp",
    "meetings": "hs_timestamp",
}


def _deal_activity_dates(
    deal_ids: list[str],
    engagements_by_type: dict[str, list[dict]],
    engagement_deal_assoc: dict[str, dict[str, str]],
) -> dict[str, dict[str, str | None]]:
    """deal_id -> {last_activity_date, next_activity_date} (YYYY-MM-DD or
    None), derived from Tasks/Calls/Meetings associated with each deal.
    HubSpot has no such field on the deal record itself (Pipedrive does) —
    this is the real, honest substitute: a deal with no associated
    engagements gets neither field set, not a fabricated value."""
    if not deal_ids:
        return {}

    now = datetime.now(timezone.utc)
    last_by_deal: dict[str, datetime] = {}
    next_by_deal: dict[str, datetime] = {}

    for engagement_type, ts_property, status_property in _ENGAGEMENT_TYPES:
        engagements = engagements_by_type.get(engagement_type) or []
        if not engagements:
            continue
        assoc = engagement_deal_assoc.get(engagement_type) or {}
        by_id = {str(e["id"]): e for e in engagements}
        for engagement_id, deal_id in assoc.items():
            e = by_id.get(engagement_id)
            if not e:
                continue
            props = e.get("properties") or {}
            ts_raw = props.get(ts_property)
            if not ts_raw:
                continue
            try:
                ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            except ValueError:
                continue
            is_done = status_property and props.get(status_property) == "COMPLETED"
            if ts <= now or is_done:
                if deal_id not in last_by_deal or ts > last_by_deal[deal_id]:
                    last_by_deal[deal_id] = ts
            else:
                if deal_id not in next_by_deal or ts < next_by_deal[deal_id]:
                    next_by_deal[deal_id] = ts

    out: dict[str, dict[str, str | None]] = {}
    for deal_id in deal_ids:
        out[deal_id] = {
            "last_activity_date": last_by_deal[deal_id].date().isoformat() if deal_id in last_by_deal else None,
            "next_activity_date": next_by_deal[deal_id].date().isoformat() if deal_id in next_by_deal else None,
        }
    return out


_DEAL_PROPERTIES = "dealname,amount,dealstage,pipeline,closedate,createdate,hubspot_owner_id,hs_lastmodifieddate,closed_lost_reason"


def _deal_status(stage: dict | None) -> str:
    """open/won/lost from a deal's stage metadata (see module docstring)."""
    is_closed = bool(stage and stage["is_closed"])
    stage_prob = stage["deal_probability"] if stage else None
    if not is_closed:
        return "open"
    if stage_prob is not None and stage_prob >= 99:
        return "won"
    if stage_prob is not None and stage_prob <= 1:
        return "lost"
    # Closed stage with an ambiguous probability (rare/custom pipeline) — fall
    # back to the stage's own label text rather than silently guessing won.
    return "lost" if "lost" in (stage["name"] if stage else "").lower() else "won"


# ---------------------------------------------------------------------------
# Snapshot: every HubSpot object the CRM dashboard needs, fetched once
# ---------------------------------------------------------------------------
#
# One CRM overview used to make ~23 sequential HubSpot calls (deals, stages,
# companies and contacts were each re-fetched 2-3 times by different getters),
# and the Home page, CRM page and chat prompt each rebuilt it independently.
# Now every object type is fetched exactly once, independent calls run in
# parallel, and the assembled result is shared by all callers for a short
# window (see _SNAPSHOT_TTL_SECONDS). The public get_* functions below keep
# their original names and return shapes.

_EMPTY_SNAPSHOT = {"stages": [], "deals": [], "activities": [], "persons": [], "orgs": [], "leads": []}

_snapshot: dict | None = None
_snapshot_at = 0.0
_snapshot_lock = threading.Lock()  # held while a fetch is in flight (single-flight)
_refreshing = threading.Event()


def _fetch_snapshot() -> dict:
    with ThreadPoolExecutor(max_workers=_MAX_PARALLEL) as pool:
        # Round 1: every object list (independent of each other).
        f_stages = pool.submit(_fetch_stages)
        f_owners = pool.submit(_owner_names)
        f_deals = pool.submit(_get_paginated, "/crm/v3/objects/deals", {"properties": _DEAL_PROPERTIES})
        f_companies = pool.submit(_get_paginated, "/crm/v3/objects/companies", {"properties": "name,createdate,hs_lastmodifieddate"})
        f_contacts = pool.submit(_get_paginated, "/crm/v3/objects/contacts", {"properties": "createdate,lifecyclestage,lead_created_date"})
        f_engagements = {
            t: pool.submit(_get_paginated, f"/crm/v3/objects/{t}", {"properties": _ENGAGEMENT_PROPERTIES[t]})
            for t, _, _ in _ENGAGEMENT_TYPES
        }

        raw_deals = f_deals.result()
        raw_contacts = f_contacts.result()
        engagements = {t: f.result() for t, f in f_engagements.items()}

        # Round 2: associations, which need the ids from round 1.
        deal_ids = [str(d["id"]) for d in raw_deals]
        qualified = [c for c in raw_contacts if (c.get("properties") or {}).get("lifecyclestage") in QUALIFIED_LIFECYCLE_STAGES]
        contact_ids = [str(c["id"]) for c in qualified]
        f_deal_company = pool.submit(_batch_associations, "deals", "companies", deal_ids)
        f_engagement_deal = {
            t: pool.submit(_batch_associations, t, "deals", [str(e["id"]) for e in engagements[t]])
            for t in engagements
        }
        f_contact_engaged = [
            pool.submit(_batch_associations, "contacts", t, contact_ids) for t in ("tasks", "calls", "meetings")
        ]

        stages = f_stages.result()
        owners = f_owners.result()
        raw_companies = f_companies.result()
        deal_company = f_deal_company.result()
        engagement_deal_assoc = {t: f.result() for t, f in f_engagement_deal.items()}
        contacted_ids: set[str] = set()
        for f in f_contact_engaged:
            contacted_ids.update(f.result())

    stage_by_id = {s["id"]: s for s in stages}
    company_names = {str(c["id"]): (c.get("properties") or {}).get("name") or "Unnamed company" for c in raw_companies}
    activity_dates = _deal_activity_dates(deal_ids, engagements, engagement_deal_assoc)

    deals = []
    for d in raw_deals:
        p = d.get("properties") or {}
        deal_id = str(d["id"])
        stage = stage_by_id.get(p.get("dealstage"))
        stage_prob = stage["deal_probability"] if stage else None
        deal_status = _deal_status(stage)
        close_date = p.get("closedate")
        company_id = deal_company.get(deal_id)
        activity = activity_dates.get(deal_id, {})

        deals.append({
            "id": d["id"],
            "title": p.get("dealname"),
            "value": float(p["amount"]) if p.get("amount") not in (None, "") else 0.0,
            "currency": "USD",  # HubSpot deals don't carry a per-deal currency property on this account
            "status": deal_status,
            "stage_id": p.get("dealstage"),
            "probability": stage_prob,
            "expected_close_date": close_date if deal_status == "open" else None,
            "won_time": close_date if deal_status == "won" else None,
            "lost_time": close_date if deal_status == "lost" else None,
            "add_time": p.get("createdate"),
            "org_name": company_names.get(company_id) if company_id else None,
            "owner_name": owners.get(p.get("hubspot_owner_id")) if p.get("hubspot_owner_id") else None,
            "last_activity_date": activity.get("last_activity_date"),
            "next_activity_date": activity.get("next_activity_date"),
            "lost_reason": p.get("closed_lost_reason"),
        })

    activities = []
    for t in engagements["tasks"]:
        p = t.get("properties") or {}
        ts = p.get("hs_timestamp")
        activities.append({
            "id": t["id"],
            "subject": p.get("hs_task_subject") or "(untitled task)",
            "type": "task",
            "due_date": ts[:10] if ts else None,
            "done": p.get("hs_task_status") == "COMPLETED",
        })

    persons = [{"id": c["id"], "add_time": (c.get("properties") or {}).get("createdate")} for c in raw_contacts]

    # Won/open counts per company reuse the deal statuses derived above
    # instead of re-fetching every deal a second time.
    status_by_deal = {str(d["id"]): d["status"] for d in deals}
    deals_by_company: dict[str, list[str]] = defaultdict(list)
    for deal_id, company_id in deal_company.items():
        if company_id:
            deals_by_company[company_id].append(status_by_deal.get(deal_id, "open"))
    orgs = []
    for c in raw_companies:
        p = c.get("properties") or {}
        statuses = deals_by_company.get(str(c["id"]), [])
        orgs.append({
            "id": c["id"],
            "name": p.get("name") or "Unnamed company",
            "add_time": p.get("createdate"),
            "last_activity_date": (p.get("hs_lastmodifieddate") or "")[:10] or None,
            "won_deals_count": statuses.count("won"),
            "open_deals_count": statuses.count("open"),
        })

    leads = []
    for c in qualified:
        props = c.get("properties") or {}
        leads.append({
            "id": c["id"],
            "add_time": props.get("lead_created_date") or props.get("createdate"),
            "is_archived": False,
            "next_activity_id": "has-engagement" if str(c["id"]) in contacted_ids else None,
        })

    return {"stages": stages, "deals": deals, "activities": activities, "persons": persons, "orgs": orgs, "leads": leads}


def _refresh_snapshot() -> dict:
    """Fetches a new snapshot unless another thread just did (callers that
    queued behind an in-flight fetch reuse its result instead of starting
    their own). A snapshot with no pipeline stages means HubSpot failed —
    every account has at least one pipeline — so it's returned but not
    cached, and the next request retries."""
    global _snapshot, _snapshot_at
    with _snapshot_lock:
        if _snapshot is not None and time.monotonic() - _snapshot_at < _SNAPSHOT_TTL_SECONDS:
            return _snapshot
        snap = _fetch_snapshot()
        if snap["stages"]:
            _snapshot, _snapshot_at = snap, time.monotonic()
        return snap


def _background_refresh() -> None:
    try:
        _refresh_snapshot()
    except Exception as e:  # noqa: BLE001 - a background refresh must never crash the process
        logger.warning("Background HubSpot refresh failed: %s", e)
    finally:
        _refreshing.clear()


def _start_background_refresh() -> None:
    if not _refreshing.is_set():
        _refreshing.set()
        threading.Thread(target=_background_refresh, daemon=True).start()


def get_snapshot() -> dict:
    """Every HubSpot-derived list the CRM dashboard needs:
    {stages, deals, activities, persons, orgs, leads}, each in the same shape
    the matching get_* function returns. Fresh for _SNAPSHOT_TTL_SECONDS;
    after that the previous copy is returned immediately while a background
    refresh runs (stale-while-revalidate), until it's older than
    _SNAPSHOT_MAX_STALE_SECONDS, when the caller waits for fresh data."""
    if not is_configured():
        return _EMPTY_SNAPSHOT
    age = time.monotonic() - _snapshot_at
    if _snapshot is not None and age < _SNAPSHOT_TTL_SECONDS:
        return _snapshot
    if _snapshot is not None and age < _SNAPSHOT_MAX_STALE_SECONDS:
        _start_background_refresh()
        return _snapshot
    return _refresh_snapshot()


def warm_cache_in_background() -> None:
    """Starts the first HubSpot fetch at backend startup so the first page
    load finds it already done (or joins it mid-flight) rather than paying
    for it from scratch."""
    if is_configured():
        _start_background_refresh()


def get_stages() -> list[dict]:
    """Flattened stages across every deal pipeline in the account.
    Pipedrive-shaped: {id, name, order_nr, deal_probability, is_closed}.
    deal_probability is 0-100."""
    return get_snapshot()["stages"]


def get_deals(status: str = "all_not_deleted") -> list[dict]:
    """Pipedrive-shaped deals (see module docstring for the field mapping).
    `status` is accepted for call-site compatibility with pipedrive_client.py
    but not used to filter server-side — HubSpot's list endpoint doesn't
    support that the way Pipedrive's does; status is derived per-deal
    instead."""
    return get_snapshot()["deals"]


def get_activities(done: int | None = None) -> list[dict]:
    """Pipedrive-shaped activities, from HubSpot Tasks (calls/meetings don't
    carry a due date / done concept the way Pipedrive Activities and HubSpot
    Tasks do, so only Tasks map cleanly onto this shape)."""
    activities = get_snapshot()["activities"]
    if done is None:
        return activities
    return [a for a in activities if a["done"] == bool(done)]


def get_persons() -> list[dict]:
    """Pipedrive-shaped persons (add_time only — the one field
    crm_metrics.build_contacts actually reads), from HubSpot Contacts."""
    return get_snapshot()["persons"]


def get_organizations() -> list[dict]:
    """Pipedrive-shaped organizations, from HubSpot Companies.
    won_deals_count/open_deals_count are derived from deal->company
    associations (HubSpot doesn't compute these the way Pipedrive does
    natively). last_activity_date uses hs_lastmodifieddate as the closest
    available proxy (documented, not presented as a literal "last activity"
    the way Pipedrive's field is)."""
    return get_snapshot()["orgs"]


def get_leads() -> list[dict]:
    """Pipedrive-shaped leads, from HubSpot Contacts filtered to
    QUALIFIED_LIFECYCLE_STAGES (see module docstring — HubSpot has no
    separate Leads Inbox object). is_archived is always False (HubSpot
    contacts don't have Pipedrive's archive concept); next_activity_id is a
    real per-contact engagement association (non-null placeholder string) so
    crm_metrics.build_qualified_leads's "awaiting first contact" check
    (not ld.get("next_activity_id")) reflects whether any task/call/meeting
    is actually associated with that contact.

    add_time prefers the account's custom `lead_created_date` property over
    the standard `createdate` system field when set — this account backdates
    when a contact was actually sourced as a lead via that custom property
    (verified directly against the account: createdate is always the day the
    record was synced into HubSpot, but lead_created_date has a real spread
    across months), so using createdate here would make every month-over-
    month leads comparison meaningless. Falls back to createdate for any
    contact that doesn't have the custom property set."""
    return get_snapshot()["leads"]
