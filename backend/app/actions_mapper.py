"""Runs the Playbook rules (playbook.py) over mock-data/opportunities.json and
mock-data/events.json to produce Actions (tab 40).

generate_actions() is called live by GET /actions in main.py on every request,
so "due today" / "overdue" are always computed against the real current date —
see build_actions()'s use of config.now(). There is no cached/written-to-disk
snapshot anymore: mock-data/generated_actions.json previously played that role
and went stale between manual reruns (see git history), which this replaces.

Can still be run directly (`python -m app.actions_mapper` from backend/) for a
quick manual check — it just prints the count rather than writing a file.

Every opportunity in _LIVE_OPPORTUNITIES is evaluated against the real
system of record (HubSpot/Fathom/Calendar/Gmail) via
playbook.build_live_opportunity() instead of its mock-data/opportunities.json
record, even when that record still exists in the file — the mock entry is
deliberately KEPT in the file (not deleted) as a fallback: if the live
HubSpot fetch fails for any reason (API down, rate limited), generate_actions()
falls back to that opportunity's mock record rather than silently dropping
it from the dashboard. At runtime the two are mutually exclusive per
opportunity_id — never both, which would double it up in the list.

Northstar Legal (OPP-002) has no mock-data entry at all (it never existed
there) — its suggestion_override text lives in _SUGGESTION_OVERRIDES below
since there's no mock record to read one from. OakBridge is the same. The
newer live-wired deals (below) keep their mock record AND whatever
"suggestion_override" is already written into it — build_live_opportunity
doesn't know about that text on its own, so generate_actions() copies it
across from the mock record it's replacing.

No contact name is hardcoded here for any of these — matching against live
Meeting/Calendar/Email data is done by account name alone
(playbook._mentions), since HubSpot has no contact actually associated with
any of these deals to fetch live.
"""

import json
import logging

from .config import MOCK_DATA_DIR
from .playbook import build_actions, build_live_opportunity

logger = logging.getLogger(__name__)

OPPORTUNITIES_PATH = MOCK_DATA_DIR / "opportunities.json"
EVENTS_PATH = MOCK_DATA_DIR / "events.json"

# (opportunity_id, account name) — every deal here is evaluated against the
# real system of record instead of its mock-data record, which stays in the
# file as a fallback (see module docstring).
_LIVE_OPPORTUNITIES = [
    ("OPP-002", "Northstar Legal"),
    ("OPP-006", "OakBridge Consulting"),
    ("OPP-007", "Stonegate Software"),
    ("OPP-001", "Beacon Manufacturing"),
    ("OPP-003", "GreenGrid Energy"),
    ("OPP-004", "Atlas Logistics"),
    ("OPP-005", "Crest Health"),
    ("OPP-008", "Lumina Education"),
    ("OPP-009", "QuarryWorks"),
    ("OPP-010", "Silverline Media"),
]

# opportunity_id -> hand-written suggestion text, used verbatim in place of
# the rule's generic phrasing (R-002's "requalify or set a next step" / R-004's
# "do {next_action}") — see playbook._action's suggestion_override handling
# for why this exists per-deal instead of as a generic template (some
# situations read better with specific phrasing, e.g. naming who to confirm
# with first, than any generic sentence could).
_SUGGESTION_OVERRIDES = {}

# opportunity_id -> hand-written row headline, used in place of the rule's
# generic action text (R-001's "Create a dated next action or requalify the
# deal" / R-002's "Requalify proposal and set a new dated next step") — same
# "the detailed recommendation is specific, so the headline should be too"
# reasoning as _SUGGESTION_OVERRIDES, just for the title instead of the body.
_ACTION_OVERRIDES = {}


def generate_actions() -> list[dict]:
    opportunities = json.loads(OPPORTUNITIES_PATH.read_text(encoding="utf-8"))
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))

    mock_by_id = {o["opportunity_id"]: o for o in opportunities}
    live_ids = {opportunity_id for opportunity_id, _ in _LIVE_OPPORTUNITIES}
    # Pull every live-wired opportunity's mock record OUT of the active list —
    # it stays in the file (never deleted), but at runtime it's replaced by
    # the live version, not shown alongside it (which would double the deal
    # up in the dashboard).
    opportunities = [o for o in opportunities if o["opportunity_id"] not in live_ids]

    for opportunity_id, account in _LIVE_OPPORTUNITIES:
        live_opp = build_live_opportunity(opportunity_id, account)
        if live_opp:
            override = _SUGGESTION_OVERRIDES.get(opportunity_id) or (mock_by_id.get(opportunity_id) or {}).get("suggestion_override")
            if override:
                live_opp["suggestion_override"] = override
            action_override = _ACTION_OVERRIDES.get(opportunity_id) or (mock_by_id.get(opportunity_id) or {}).get("action_override")
            if action_override:
                live_opp["action_override"] = action_override
            opportunities.append(live_opp)
        elif opportunity_id in mock_by_id:
            # Live fetch failed (HubSpot down, rate limited, etc.) — fall back
            # to the mock record rather than silently dropping this deal from
            # the dashboard mid-demo.
            logger.warning("Live HubSpot fetch failed for %s (%s) — falling back to mock data.", account, opportunity_id)
            opportunities.append(mock_by_id[opportunity_id])
        else:
            logger.warning("No live HubSpot deal found for %s (%s) and no mock fallback exists — skipped.", account, opportunity_id)

    return build_actions(opportunities, events)


def main() -> None:
    actions = generate_actions()
    print(f"Computed {len(actions)} actions (live, not written to a file)")


if __name__ == "__main__":
    main()
