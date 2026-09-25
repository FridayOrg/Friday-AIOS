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
from collections import defaultdict
from datetime import datetime, timezone

import httpx

from .config import HUBSPOT_ACCESS_TOKEN

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.hubapi.com"
_TIMEOUT_SECONDS = 20
_PAGE_LIMIT = 100

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
            response = httpx.get(f"{_BASE_URL}{path}", headers=_headers(), params=p, timeout=_TIMEOUT_SECONDS)
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


def get_stages() -> list[dict]:
    """Flattened stages across every deal pipeline in the account (an account
    can have more than one; Pipedrive's /stages wasn't scoped to a single
    pipeline either). Pipedrive-shaped: {id, name, order_nr, deal_probability,
    is_closed}. deal_probability is 0-100."""
    if not is_configured():
        return []
    try:
        response = httpx.get(f"{_BASE_URL}/crm/v3/pipelines/deals", headers=_headers(), timeout=_TIMEOUT_SECONDS)
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


def _company_names() -> dict[str, str]:
    companies = _get_paginated("/crm/v3/objects/companies", {"properties": "name"})
    return {str(c["id"]): (c.get("properties") or {}).get("name") or "Unnamed company" for c in companies}


def _deal_company_associations(deal_ids: list[str] | None = None) -> dict[str, str]:
    """deal_id -> company_id, via the batch Associations API (one call for
    every deal at once, not one call per deal). Callers that already have the
    deal id list (get_deals) should pass it in to skip re-fetching every deal
    a second time just for its id."""
    return _batch_associations("deals", "companies", deal_ids)


def _batch_associations(from_type: str, to_type: str, object_ids: list[str] | None = None) -> dict[str, str]:
    """First associated `to_type` id for each `from_type` id, via HubSpot's
    batch read endpoint. If object_ids isn't given, fetches every object of
    from_type first (id-only) to build the batch. Returns {} on any failure
    -- a missing association link is treated the same as "none set", never
    guessed."""
    if not is_configured():
        return {}
    if object_ids is None:
        objs = _get_paginated(f"/crm/v3/objects/{from_type}", {"properties": "hs_object_id"})
        object_ids = [str(o["id"]) for o in objs]
    if not object_ids:
        return {}

    result: dict[str, str] = {}
    for i in range(0, len(object_ids), _PAGE_LIMIT):
        batch = object_ids[i:i + _PAGE_LIMIT]
        try:
            response = httpx.post(
                f"{_BASE_URL}/crm/v4/associations/{from_type}/{to_type}/batch/read",
                headers=_headers(),
                json={"inputs": [{"id": oid} for oid in batch]},
                timeout=_TIMEOUT_SECONDS,
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


def _deal_activity_dates(deal_ids: list[str]) -> dict[str, dict[str, str | None]]:
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

    for engagement_type, ts_property, status_property in (
        ("tasks", "hs_timestamp", "hs_task_status"),
        ("calls", "hs_timestamp", None),
        ("meetings", "hs_timestamp", None),
    ):
        engagements = _get_paginated(f"/crm/v3/objects/{engagement_type}", {"properties": f"{ts_property},{status_property}" if status_property else ts_property})
        if not engagements:
            continue
        engagement_ids = [str(e["id"]) for e in engagements]
        assoc = _batch_associations(engagement_type, "deals", engagement_ids)
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


def get_deals(status: str = "all_not_deleted") -> list[dict]:
    """Pipedrive-shaped deals (see module docstring for the field mapping).
    `status` is accepted for call-site compatibility with pipedrive_client.py
    but not used to filter server-side — HubSpot's list endpoint doesn't
    support that the way Pipedrive's does; status is derived per-deal below
    instead."""
    raw = _get_paginated("/crm/v3/objects/deals", {"properties": _DEAL_PROPERTIES})
    if not raw:
        return []

    deal_ids = [str(d["id"]) for d in raw]
    stage_by_id = {s["id"]: s for s in get_stages()}
    owners = _owner_names()
    companies = _company_names()
    deal_company = _deal_company_associations(deal_ids)
    activity_dates = _deal_activity_dates(deal_ids)

    deals = []
    for d in raw:
        p = d.get("properties") or {}
        deal_id = str(d["id"])
        stage = stage_by_id.get(p.get("dealstage"))
        is_closed = bool(stage and stage["is_closed"])
        stage_prob = stage["deal_probability"] if stage else None
        if not is_closed:
            deal_status = "open"
        elif stage_prob is not None and stage_prob >= 99:
            deal_status = "won"
        elif stage_prob is not None and stage_prob <= 1:
            deal_status = "lost"
        else:
            # Closed stage with an ambiguous probability (rare/custom
            # pipeline) — fall back to the stage's own label text rather
            # than silently guessing won.
            deal_status = "lost" if "lost" in (stage["name"] if stage else "").lower() else "won"

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
            "org_name": companies.get(company_id) if company_id else None,
            "owner_name": owners.get(p.get("hubspot_owner_id")) if p.get("hubspot_owner_id") else None,
            "last_activity_date": activity.get("last_activity_date"),
            "next_activity_date": activity.get("next_activity_date"),
            "lost_reason": p.get("closed_lost_reason"),
        })
    return deals


def get_activities(done: int | None = None) -> list[dict]:
    """Pipedrive-shaped activities, from HubSpot Tasks (calls/meetings don't
    carry a due date / done concept the way Pipedrive Activities and HubSpot
    Tasks do, so only Tasks map cleanly onto this shape)."""
    raw = _get_paginated("/crm/v3/objects/tasks", {"properties": "hs_task_subject,hs_task_status,hs_timestamp,hs_task_type"})
    activities = []
    for t in raw:
        p = t.get("properties") or {}
        is_done = p.get("hs_task_status") == "COMPLETED"
        if done is not None and bool(done) != is_done:
            continue
        ts = p.get("hs_timestamp")
        activities.append({
            "id": t["id"],
            "subject": p.get("hs_task_subject") or "(untitled task)",
            "type": "task",
            "due_date": ts[:10] if ts else None,
            "done": is_done,
        })
    return activities


def get_persons() -> list[dict]:
    """Pipedrive-shaped persons (add_time only — the one field
    crm_metrics.build_contacts actually reads), from HubSpot Contacts."""
    raw = _get_paginated("/crm/v3/objects/contacts", {"properties": "createdate"})
    return [{"id": c["id"], "add_time": (c.get("properties") or {}).get("createdate")} for c in raw]


def _lightweight_deal_statuses() -> dict[str, str]:
    """deal_id -> open/won/lost, using only dealstage (no owner/company/
    activity-date enrichment) — a cheap version of get_deals()'s status
    derivation for get_organizations()'s won/open counts, so it doesn't
    trigger get_deals()'s much more expensive engagement-association lookup
    a second time per request."""
    raw = _get_paginated("/crm/v3/objects/deals", {"properties": "dealstage"})
    stage_by_id = {s["id"]: s for s in get_stages()}
    statuses = {}
    for d in raw:
        stage = stage_by_id.get((d.get("properties") or {}).get("dealstage"))
        is_closed = bool(stage and stage["is_closed"])
        stage_prob = stage["deal_probability"] if stage else None
        if not is_closed:
            status = "open"
        elif stage_prob is not None and stage_prob >= 99:
            status = "won"
        elif stage_prob is not None and stage_prob <= 1:
            status = "lost"
        else:
            status = "lost" if "lost" in (stage["name"] if stage else "").lower() else "won"
        statuses[str(d["id"])] = status
    return statuses


def get_organizations() -> list[dict]:
    """Pipedrive-shaped organizations, from HubSpot Companies.
    won_deals_count/open_deals_count are derived from deal->company
    associations (HubSpot doesn't compute these the way Pipedrive does
    natively). last_activity_date uses hs_lastmodifieddate as the closest
    available proxy (documented, not presented as a literal "last activity"
    the way Pipedrive's field is)."""
    raw = _get_paginated("/crm/v3/objects/companies", {"properties": "name,createdate,hs_lastmodifieddate"})
    if not raw:
        return []

    deal_company = _deal_company_associations()
    deals_by_company: dict[str, list[str]] = defaultdict(list)
    company_status_by_deal = _lightweight_deal_statuses()
    for deal_id, company_id in deal_company.items():
        if company_id:
            deals_by_company[company_id].append(company_status_by_deal.get(deal_id, "open"))

    orgs = []
    for c in raw:
        p = c.get("properties") or {}
        cid = str(c["id"])
        statuses = deals_by_company.get(cid, [])
        orgs.append({
            "id": c["id"],
            "name": p.get("name") or "Unnamed company",
            "add_time": p.get("createdate"),
            "last_activity_date": (p.get("hs_lastmodifieddate") or "")[:10] or None,
            "won_deals_count": statuses.count("won"),
            "open_deals_count": statuses.count("open"),
        })
    return orgs


def get_leads() -> list[dict]:
    """Pipedrive-shaped leads, from HubSpot Contacts filtered to
    QUALIFIED_LIFECYCLE_STAGES (see module docstring — HubSpot has no
    separate Leads Inbox object). is_archived is always False (HubSpot
    contacts don't have Pipedrive's archive concept); next_activity_id is a
    real per-contact engagement association (non-null placeholder string) so
    crm_metrics.build_qualified_leads's "awaiting first contact" check
    (not ld.get("next_activity_id")) reflects whether any task/call/meeting
    is actually associated with that contact."""
    raw = _get_paginated("/crm/v3/objects/contacts", {"properties": "createdate,lifecyclestage"})
    qualified = [c for c in raw if (c.get("properties") or {}).get("lifecyclestage") in QUALIFIED_LIFECYCLE_STAGES]
    if not qualified:
        return []

    contact_ids = [str(c["id"]) for c in qualified]
    has_task = _batch_associations("contacts", "tasks", contact_ids)
    has_call = _batch_associations("contacts", "calls", contact_ids)
    has_meeting = _batch_associations("contacts", "meetings", contact_ids)

    leads = []
    for c in qualified:
        cid = str(c["id"])
        contacted = cid in has_task or cid in has_call or cid in has_meeting
        leads.append({
            "id": c["id"],
            "add_time": (c.get("properties") or {}).get("createdate"),
            "is_archived": False,
            "next_activity_id": "has-engagement" if contacted else None,
        })
    return leads
