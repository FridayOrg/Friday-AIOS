"""Turns the raw "Activities" and "Notes" sheets into RevenueOS's "Events"
structure (tab 22), and fills in the `revenueos_stage` field on the Opportunities
built by deals_mapper.py (tab 21), using the Stage Map (tab 30).

Only "material" signals become Events — not every CRM touch. Each Event also gets
a `creates_action` flag so the playbook rules (Task 3) know which events still
need follow-up. See the two rules below for exactly how that's decided; the
next_action-based rule is a close-fit approximation of the handoff doc's
hand-authored examples, not a perfect match in every case.

Each Activity/Note row references its deal by the source's own deal ID (e.g.
"DEAL-001") — never the same thing as our generated `opportunity_id`. This module
looks that up via the `source_record_id -> opportunity_id` map built from
deals_mapper.py's output (opportunities.json), rather than assuming any
relationship between the two ID schemes.

Run directly (`python -m app.events_mapper` from backend/) to regenerate
mock-data/events.json and refresh the revenueos_stage field in
mock-data/opportunities.json.
"""

import json

from .config import MOCK_DATA_DIR
from .stage_map import map_source_stage_to_revenueos
from .xlsx_source import excel_value_to_iso_date, excel_value_to_iso_datetime, load_sheet

OPPORTUNITIES_PATH = MOCK_DATA_DIR / "opportunities.json"
EVENTS_OUTPUT_PATH = MOCK_DATA_DIR / "events.json"

# Which activity types count as a real touchpoint worth keeping, vs. routine/
# unanswered ones that are noise (see tab 22: every Meeting/Call activity in the
# handoff doc's sample is Material, every Email/Task is not).
_MATERIAL_ACTIVITY_TYPES = {"Meeting", "Call"}


def map_activity_to_event(raw: dict, opportunity_id: str, opportunity_next_action: str | None) -> dict:
    """Converts one Activities row into an Event.

    `creates_action` is Yes when the activity is still undone, or when it's done
    but the related deal already has a next_action on file (meaning this activity
    is what produced that commitment). A deliberate V1 simplification — catching
    every case exactly would need reading the free-text outcome, not just
    structured fields — flagged here rather than silently treated as exact.
    """
    activity_type = raw["Activity - Type"]
    done = raw["Activity - Done"] == "Done"
    creates_action = (not done) or bool(opportunity_next_action)

    return {
        "event_id": f"EV-{raw['Activity - System ID']}",
        "opportunity_id": opportunity_id,
        "event_type": activity_type,
        "date": excel_value_to_iso_date(raw.get("Activity - Due date")),
        "source": "CRM Activity",
        "actor": raw.get("Activity - Assigned to user"),
        "summary": raw.get("Activity - Subject"),
        "material": activity_type in _MATERIAL_ACTIVITY_TYPES,
        "customer_interaction": raw.get("Customer interaction?") == "Yes",
        "commitment_or_decision": raw.get("Outcome / result"),
        # Only still-pending (undone) activities carry a concrete due date forward —
        # a completed meeting that produced a commitment doesn't need its own date,
        # the still-open follow-up activity already carries it.
        "commitment_due": excel_value_to_iso_date(raw.get("Activity - Due date")) if not done else None,
        "creates_action": creates_action,
        "linked_source_id": raw["Activity - System ID"],
    }


def map_note_to_event(raw: dict, opportunity_id: str) -> dict:
    """Converts one Notes row into an Event. Notes never auto-create an action on
    their own (creates_action = "potentially") — that call is left to Task 3's
    playbook rules, which check whether a matching action already exists."""
    return {
        "event_id": f"EV-{raw['Note - System ID']}",
        "opportunity_id": opportunity_id,
        "event_type": "CRM Note",
        "date": excel_value_to_iso_datetime(raw.get("Note - Created at")),
        "source": "CRM Note",
        "actor": raw.get("Note - Author"),
        "summary": raw.get("Note - Content"),
        "material": raw.get("Material signal?") == "Yes",
        "customer_interaction": False,
        "commitment_or_decision": raw.get("Note - Content"),
        "commitment_due": None,
        "creates_action": "potentially",
        "linked_source_id": raw["Note - System ID"],
    }


def build_events(opportunities: list[dict]) -> list[dict]:
    opportunity_id_by_source = {o["source_record_id"]: o["opportunity_id"] for o in opportunities}
    next_action_by_opportunity = {o["opportunity_id"]: o.get("next_action") for o in opportunities}

    events = []
    for raw in load_sheet("Activities"):
        source_deal_id = raw["Deal - System ID"]
        opp_id = opportunity_id_by_source.get(source_deal_id)
        if opp_id is None:
            continue  # activity references a deal not present in this run's Opportunities
        events.append(map_activity_to_event(raw, opp_id, next_action_by_opportunity.get(opp_id)))
    for raw in load_sheet("Notes"):
        source_deal_id = raw["Deal - System ID"]
        opp_id = opportunity_id_by_source.get(source_deal_id)
        if opp_id is None:
            continue
        events.append(map_note_to_event(raw, opp_id))
    return events


def apply_stage_map(opportunities: list[dict]) -> list[dict]:
    for opportunity in opportunities:
        opportunity["revenueos_stage"] = map_source_stage_to_revenueos(opportunity["source_stage"])
    return opportunities


def main() -> None:
    opportunities = json.loads(OPPORTUNITIES_PATH.read_text(encoding="utf-8"))
    opportunities = apply_stage_map(opportunities)
    OPPORTUNITIES_PATH.write_text(json.dumps(opportunities, indent=2), encoding="utf-8")

    events = build_events(opportunities)
    EVENTS_OUTPUT_PATH.write_text(json.dumps(events, indent=2), encoding="utf-8")

    print(f"Updated revenueos_stage on {len(opportunities)} opportunities.")
    print(f"Wrote {len(events)} events to {EVENTS_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
