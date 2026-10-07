"""Maps the raw "Contacts" sheet into a clean common Contact shape. New in V2 —
previously there was no dedicated contact data, only buyer names attached to
deals, so "New Contacts" on the dashboard had nothing to read.

Run directly (`python -m app.contacts_mapper` from backend/) to regenerate
mock-data/contacts.json.
"""

import json

from .config import MOCK_DATA_DIR
from .xlsx_source import excel_value_to_iso_date, load_sheet

OUTPUT_PATH = MOCK_DATA_DIR / "contacts.json"


def map_contact(raw: dict) -> dict:
    return {
        "contact_id": raw["Contact - System ID"],
        "name": raw["Contact - Name"],
        "created_date": excel_value_to_iso_date(raw.get("Contact - Created Date")),
    }


def build_contacts() -> list[dict]:
    return [map_contact(raw) for raw in load_sheet("Contacts")]


def main() -> None:
    contacts = build_contacts()
    OUTPUT_PATH.write_text(json.dumps(contacts, indent=2), encoding="utf-8")
    print(f"Wrote {len(contacts)} contacts to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
