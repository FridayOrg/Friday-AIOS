"""Maps the raw "Organizations" sheet into a clean common Organization shape. New
in V2 — needed for stale-account tracking (which accounts haven't had activity in
a while), which previously had no account-level data to read, only deal records.

Run directly (`python -m app.organizations_mapper` from backend/) to regenerate
mock-data/organizations.json.
"""

import json

from .config import MOCK_DATA_DIR
from .xlsx_source import excel_value_to_iso_date, load_sheet

OUTPUT_PATH = MOCK_DATA_DIR / "organizations.json"


def map_organization(raw: dict) -> dict:
    return {
        "org_id": raw["Org - System ID"],
        "name": raw["Org - Name"],
        "created_date": excel_value_to_iso_date(raw.get("Org - Created Date")),
        "last_activity_date": excel_value_to_iso_date(raw.get("Org - Last Activity Date")),
    }


def build_organizations() -> list[dict]:
    return [map_organization(raw) for raw in load_sheet("Organizations")]


def main() -> None:
    organizations = build_organizations()
    OUTPUT_PATH.write_text(json.dumps(organizations, indent=2), encoding="utf-8")
    print(f"Wrote {len(organizations)} organizations to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
