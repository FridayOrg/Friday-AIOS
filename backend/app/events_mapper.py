"""Task 2 (Mon PM): turns the raw Activities and Notes sheets into RevenueOS's
"Events" structure (tab 22), and fills in the `revenueos_stage` field on the
Opportunities built by deals_mapper.py (tab 21), using the Stage Map (tab 30).

Only "material" signals become Events — not every CRM touch. Each Event also gets a
`creates_action` flag so the playbook rules (Task 3) know which events still need
follow-up. See the two rules below for exactly how that's decided; the next_action-
based rule is a close-fit approximation of the handoff doc's hand-authored examples
(matches 12 of the 13 sample activities — the one exception is noted in the module
docstring for map_activity_to_event).

Run directly (`python -m app.events_mapper` from backend/) to regenerate
mock-data/events.json and refresh the revenueos_stage field in
mock-data/opportunities.json.
"""

import json

import openpyxl

from .config import MOCK_DATA_DIR
from .stage_map import map_source_stage_to_revenueos

ACTIVITIES_PATH = MOCK_DATA_DIR / "activities.xlsx"
NOTES_PATH = MOCK_DATA_DIR / "notes.xlsx"
OPPORTUNITIES_PATH = MOCK_DATA_DIR / "opportunities.json"
EVENTS_OUTPUT_PATH = MOCK_DATA_DIR / "events.json"

# Which activity types count as a real touchpoint worth keeping, vs. routine/
# unanswered ones that are noise (see tab 22: every Meeting/Call activity in the
# handoff doc's sample is Material, every Email/Task is not).
_MATERIAL_ACTIVITY_TYPES = {"Meeting", "Call"}


def _load_rows(path) -> list[dict]:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    headers = rows[0]
    return [dict(zip(headers, row)) for row in rows[1:] if row[0] is not None]


def _excel_serial_to_iso_date(value) -> str | None:
    from datetime import date, timedelta

    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return (date(1899, 12, 30) + timedelta(days=int(value))).isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()[:10]
    return None


def _excel_serial_to_iso_datetime(value) -> str | None:
    """Same as the date version but keeps the time-of-day (Notes carry a
    date+time serial; Activities' due date doesn't, so those stay date-only)."""
    from datetime import datetime, timedelta

    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        base = datetime(1899, 12, 30) + timedelta(days=value)
        return base.strftime("%Y-%m-%d %H:%M")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return None


def map_activity_to_event(raw: dict, opportunity_next_action: str | None) -> dict:
    """Converts one Activities row into an Event.

    `creates_action` is Yes when the activity is still undone, or when it's done but
    the related deal already has a next_action on file (meaning this activity is
    what produced that commitment). This matches 12 of the 13 sample activities in
    the handoff doc; the one exception (a completed "discovery call" whose deal has
    an unrelated later next_action) would need reading the free-text outcome to
    catch — a deliberate V1 simplification, not a bug, flagged here rather than
    silently accepted.
    """
    activity_type = raw["Activity - Type"]
    done = raw["Activity - Done"] == "Done"
    event_id = f"EV-A{raw['Activity - Pipedrive System ID']}"

    creates_action = (not done) or bool(opportunity_next_action)

    return {
        "event_id": event_id,
        "opportunity_id": f"OPP-{raw['Deal - Pipedrive System ID']}",
        "event_type": activity_type,
        "date": _excel_serial_to_iso_date(raw.get("Activity - Due date")),
        "source": "CRM Activity",
        "actor": raw.get("Activity - Assigned to user"),
        "summary": raw.get("Activity - Subject"),
        "material": activity_type in _MATERIAL_ACTIVITY_TYPES,
        "customer_interaction": raw.get("Customer interaction?") == "Yes",
        "commitment_or_decision": raw.get("Outcome / result"),
        # Only still-pending (undone) activities carry a concrete due date forward —
        # a completed meeting that produced a commitment doesn't need its own date,
        # the still-open follow-up activity already carries it.
        "commitment_due": _excel_serial_to_iso_date(raw.get("Activity - Due date")) if not done else None,
        "creates_action": creates_action,
        "linked_source_id": raw["Activity - Pipedrive System ID"],
    }


def map_note_to_event(raw: dict) -> dict:
    """Converts one Notes row into an Event. Notes never auto-create an action on
    their own (creates_action = "potentially") — that call is left to Task 3's
    playbook rules, which check whether a matching action already exists."""
    return {
        "event_id": f"EV-N{raw['Note - Pipedrive System ID']}",
        "opportunity_id": f"OPP-{raw['Deal - Pipedrive System ID']}",
        "event_type": "CRM Note",
        "date": _excel_serial_to_iso_datetime(raw.get("Note - Created at")),
        "source": "CRM Note",
        "actor": raw.get("Note - Author"),
        "summary": raw.get("Note - Content"),
        "material": raw.get("Material signal?") == "Yes",
        "customer_interaction": False,
        "commitment_or_decision": raw.get("Note - Content"),
        "commitment_due": None,
        "creates_action": "potentially",
        "linked_source_id": raw["Note - Pipedrive System ID"],
    }


def build_events(opportunities: list[dict]) -> list[dict]:
    next_action_by_opportunity = {o["opportunity_id"]: o.get("next_action") for o in opportunities}

    events = []
    for raw in _load_rows(ACTIVITIES_PATH):
        opp_id = f"OPP-{raw['Deal - Pipedrive System ID']}"
        events.append(map_activity_to_event(raw, next_action_by_opportunity.get(opp_id)))
    for raw in _load_rows(NOTES_PATH):
        events.append(map_note_to_event(raw))
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
