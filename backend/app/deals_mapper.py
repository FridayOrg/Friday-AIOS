"""Maps the raw "Deals" sheet (synthetic CRM source data) into RevenueOS's common
Opportunity structure. This is the only place that knows the source's field names
("Deal - Title", "Deal - Stage (pipeline)", ...) — everything downstream (stage
mapping, playbook rules, Actions, the dashboard) reads the common Opportunity shape
instead, so a different source (HubSpot, a partner's Excel sheet, a different CRM)
only ever needs a new mapper like this one, never changes to the rest of the app.

Opportunity IDs are always generated as OPP-001, OPP-002, ... in file order —
never derived from the source's own ID format, since that format isn't ours to
depend on (it's gone from plain numbers to "DEAL-001" once already). The raw
source ID is kept separately as `source_record_id` for traceability.

Deliberately does NOT fill in `revenueos_stage` — that translation (raw stage name
-> RevenueOS stage, e.g. "Proposal Sent" -> "Proposal") depends on the separate
Stage Map table and is a later step. This module only does field renaming, date
normalization and a generated id + data-quality flag.

Run directly (`python -m app.deals_mapper` from backend/) to regenerate
mock-data/opportunities.json from the source workbook's "Deals" sheet.
"""

import json

from .config import MOCK_DATA_DIR
from .xlsx_source import excel_value_to_iso_date, load_sheet

OUTPUT_PATH = MOCK_DATA_DIR / "opportunities.json"


def _clean(value):
    """Blank string -> None; everything else passed through unchanged."""
    if value == "":
        return None
    return value


def _data_quality(opportunity: dict) -> str:
    """Flags records that are missing fields later steps (playbook rules, actions)
    rely on. Matches the "Missing next action" / "Missing last interaction" / "OK"
    pattern used in the handoff doc's Opportunities tab."""
    if not opportunity["next_action"]:
        return "Missing next action"
    if not opportunity["last_interaction"]:
        return "Missing last interaction"
    return "OK"


def map_deal_to_opportunity(opportunity_id: str, raw: dict) -> dict:
    """Translates one raw deal row into the common Opportunity shape (mirrors the
    "21 Opportunities" tab). All source-specific field names are confined to this
    function."""
    opportunity = {
        "opportunity_id": opportunity_id,
        "source_system": "CRM",
        "source_record_id": raw["Deal - System ID"],
        "deal": raw["Deal - Title"],
        "account": raw["Organization"],
        "contact_person": _clean(raw.get("Contact person")),
        "owner": raw["Deal - Owner"],
        "source_stage": raw["Deal - Stage (pipeline)"],
        "revenueos_stage": None,  # filled in by the Stage Map step, not this one
        "status": raw["Deal - Status"],
        "value": raw["Deal - Value"],
        "currency": raw["Deal - Currency of value"],
        "probability": _clean(raw.get("Deal - Probability")),
        "created_date": excel_value_to_iso_date(raw.get("Deal - Creation date")),
        "expected_close": excel_value_to_iso_date(raw.get("Deal - Expected close date")),
        "closed_on": excel_value_to_iso_date(raw.get("Deal - Closed on")),
        "lost_reason": _clean(raw.get("Deal - Lost reason")),
        "last_interaction": excel_value_to_iso_date(raw.get("Last meaningful activity date")),
        "next_action": _clean(raw.get("Next action")),
        "next_action_due": excel_value_to_iso_date(raw.get("Next action due")),
        "primary_offer": _clean(raw.get("Primary Offer")),
        "offer_type": _clean(raw.get("Offer Type")),
        "source": _clean(raw.get("Lead source")),
    }
    opportunity["data_quality"] = _data_quality(opportunity)
    return opportunity


def build_opportunities() -> list[dict]:
    """Reads every row from the "Deals" sheet and returns the full list of mapped
    Opportunity records, in source order, with freshly generated OPP-xxx ids."""
    raw_deals = load_sheet("Deals")
    return [map_deal_to_opportunity(f"OPP-{i:03d}", raw) for i, raw in enumerate(raw_deals, start=1)]


def main() -> None:
    opportunities = build_opportunities()
    OUTPUT_PATH.write_text(json.dumps(opportunities, indent=2), encoding="utf-8")
    print(f"Wrote {len(opportunities)} opportunities to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
