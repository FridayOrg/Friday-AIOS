"""Maps the raw "Leads" sheet into a clean common Lead shape. New in V2 — the
synthetic data previously only had deals, so "New Qualified Leads" on the
dashboard had nothing to read and always showed 0.

Run directly (`python -m app.leads_mapper` from backend/) to regenerate
mock-data/leads.json.
"""

import json

from .config import MOCK_DATA_DIR
from .xlsx_source import excel_value_to_iso_date, load_sheet

OUTPUT_PATH = MOCK_DATA_DIR / "leads.json"


def map_lead(raw: dict) -> dict:
    return {
        "lead_id": raw["Lead - System ID"],
        "created_date": excel_value_to_iso_date(raw.get("Lead - Created Date")),
        "archived": bool(raw.get("Lead - Archived")),
        "next_activity_source_id": raw.get("Lead - Next Activity ID") or None,
    }


def build_leads() -> list[dict]:
    return [map_lead(raw) for raw in load_sheet("Leads")]


def main() -> None:
    leads = build_leads()
    OUTPUT_PATH.write_text(json.dumps(leads, indent=2), encoding="utf-8")
    print(f"Wrote {len(leads)} leads to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
