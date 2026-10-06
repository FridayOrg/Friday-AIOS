"""Maps synthetic Pipedrive-shaped deal records (mock-data/Deals.xlsx) into RevenueOS's
common Opportunity structure. This is the only place that knows Pipedrive's field names
("Deal - Stage (pipeline)", "Deal - Value", ...) — everything downstream (stage mapping,
playbook rules, Actions, the dashboard) reads the common Opportunity shape instead, so a
different source (HubSpot, a partner's Excel sheet, a different CRM) only ever needs a
new mapper like this one, never changes to the rest of the app.

Deliberately does NOT fill in `revenueos_stage` — that translation (raw stage name ->
RevenueOS stage, e.g. "Proposal Sent" -> "Proposal") depends on the separate Stage Map
table and is a later step. This module only does field renaming, date-format conversion
(Excel serial numbers -> ISO date strings) and a generated id + data-quality flag.

Run directly (`python -m app.deals_mapper` from backend/) to regenerate
mock-data/opportunities.json from mock-data/Deals.xlsx.
"""

import json
from datetime import date, timedelta

import openpyxl

from .config import MOCK_DATA_DIR

EXCEL_PATH = MOCK_DATA_DIR / "Deals.xlsx"
OUTPUT_PATH = MOCK_DATA_DIR / "opportunities.json"

# Excel's date epoch is 1899-12-30 (not 1900-01-01) because Excel wrongly treats 1900
# as a leap year; this offset is the standard correction and matches the worked
# examples in the handoff doc (46289 -> 2026-09-24, 46296 -> 2026-10-01).
_EXCEL_EPOCH = date(1899, 12, 30)


def _excel_serial_to_iso(value) -> str | None:
    """Converts an Excel date serial number (e.g. 46289) to an ISO date string
    (e.g. "2026-09-24"). Returns None for blank cells."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return (_EXCEL_EPOCH + timedelta(days=int(value))).isoformat()
    # openpyxl sometimes returns an already-parsed datetime/date if the cell is
    # formatted as a date in the workbook.
    if hasattr(value, "isoformat"):
        return value.isoformat()[:10]
    return None


def _clean(value):
    """Blank string -> None; everything else passed through unchanged."""
    if value == "":
        return None
    return value


def _load_raw_deals() -> list[dict]:
    """Reads mock-data/Deals.xlsx and returns one dict per deal row, keyed by the
    exact column headers in the sheet (Pipedrive-style field names)."""
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    headers = rows[0]
    return [dict(zip(headers, row)) for row in rows[1:] if row[0] is not None]


def _data_quality(opportunity: dict) -> str:
    """Flags records that are missing fields later steps (playbook rules, actions)
    rely on. Matches the "Missing next action" / "Missing last interaction" / "OK"
    pattern used in the handoff doc's Opportunities tab."""
    if not opportunity["next_action"]:
        return "Missing next action"
    if not opportunity["last_interaction"]:
        return "Missing last interaction"
    return "OK"


def map_deal_to_opportunity(index: int, raw: dict) -> dict:
    """Translates one raw Pipedrive-shaped deal row into the common Opportunity shape
    (mirrors the "21 Opportunities" tab). All Pipedrive-specific field names are
    confined to this function."""
    opportunity = {
        "opportunity_id": f"OPP-{raw['Deal - Pipedrive System ID']}",
        "source_system": "CRM",
        "source_record_id": raw["Deal - Pipedrive System ID"],
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
        "created_date": _excel_serial_to_iso(raw.get("Deal - Creation date")),
        "expected_close": _excel_serial_to_iso(raw.get("Deal - Expected close date")),
        "closed_on": _excel_serial_to_iso(raw.get("Deal - Closed on")),
        "lost_reason": _clean(raw.get("Deal - Lost reason")),
        "last_interaction": _excel_serial_to_iso(raw.get("Last meaningful activity date")),
        "next_action": _clean(raw.get("Next action")),
        "next_action_due": _excel_serial_to_iso(raw.get("Next action due")),
        "primary_offer": _clean(raw.get("Primary Offer")),
        "offer_type": _clean(raw.get("Offer Type")),
        "source": _clean(raw.get("Lead source")),
    }
    opportunity["data_quality"] = _data_quality(opportunity)
    return opportunity


def build_opportunities() -> list[dict]:
    """Reads all rows from Deals.xlsx and returns the full list of mapped
    Opportunity records, in source order."""
    raw_deals = _load_raw_deals()
    return [map_deal_to_opportunity(i, raw) for i, raw in enumerate(raw_deals, start=1)]


def main() -> None:
    opportunities = build_opportunities()
    OUTPUT_PATH.write_text(json.dumps(opportunities, indent=2), encoding="utf-8")
    print(f"Wrote {len(opportunities)} opportunities to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
