"""Shared raw-file reading for every mapper (deals_mapper.py, events_mapper.py,
leads_mapper.py, contacts_mapper.py, organizations_mapper.py). Each mapper still
owns its own field-translation logic — this module only does the generic part:
open the source workbook, find the right sheet, and turn its rows into dicts.

Finds the header row by scanning for the first row whose first cell is a string
ending in "System ID" — every sheet in the CRM source pack (Deals, Leads,
Contacts, Organizations, Activities, Notes) follows that pattern, with a title
and description above it. Older single-sheet files (header already on row 1)
match the same way, since that row is then simply the first one found.

Also converts Excel date cells to clean ISO strings here, once, so every mapper
downstream gets consistent values regardless of whether the source stored a date
as an Excel serial number or an already-parsed datetime (both occur across the
old and new source files).
"""

from datetime import date, datetime, timedelta

import openpyxl

from .config import MOCK_DATA_DIR

SOURCE_WORKBOOK_PATH = MOCK_DATA_DIR / "BookMySales_Demo_CRM_Source_Data_Expanded_V2.xlsx"

_EXCEL_EPOCH = date(1899, 12, 30)


def excel_value_to_iso_date(value) -> str | None:
    """Excel serial, datetime, date, or already-ISO string -> "YYYY-MM-DD"."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        return (_EXCEL_EPOCH + timedelta(days=int(value))).isoformat()
    if isinstance(value, str):
        return value[:10]
    return None


def excel_value_to_iso_datetime(value) -> str | None:
    """Same as above but keeps time-of-day as "YYYY-MM-DD HH:MM" when present."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        base = datetime(1899, 12, 30) + timedelta(days=value)
        return base.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, str):
        return value
    return None


def _find_header_row(rows: list[tuple]) -> int:
    for i, row in enumerate(rows):
        first_cell = row[0] if row else None
        if isinstance(first_cell, str) and first_cell.endswith("System ID"):
            return i
    raise ValueError("No header row found (expected a first cell ending in 'System ID')")


def load_sheet(sheet_name: str, path=SOURCE_WORKBOOK_PATH) -> list[dict]:
    """Reads one named sheet from the source workbook and returns one dict per
    data row, keyed by that sheet's own column headers."""
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet_name] if sheet_name in wb.sheetnames else wb.active
    rows = list(ws.iter_rows(values_only=True))
    header_idx = _find_header_row(rows)
    headers = rows[header_idx]
    return [dict(zip(headers, row)) for row in rows[header_idx + 1 :] if row and row[0] is not None]
