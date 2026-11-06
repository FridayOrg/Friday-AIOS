"""Runs saved proposal test cases through the full pipeline and checks the Word output.

Usage (from the repo root):
    .venv/Scripts/python.exe -m backend.proposal_tests.run_checks <cases_dir> [runs_per_case]

<cases_dir> holds one folder per case, each with:
    notes.txt  - the meeting notes
    case.json  - client_name, client_contact, additional_info, plus the expectations
                 checked below (all optional, all case-insensitive substrings)

Test cases are read only by this script — never by the app, the brain or any prompt —
so a case's content can't leak into other clients' proposals.
"""

import base64
import io
import json
import logging
import re
import sys
from pathlib import Path

import docx
from docx.table import Table
from docx.text.paragraph import Paragraph
from fastapi.testclient import TestClient

from backend.app.main import app

GENERIC_BANNED = ["data residency", "natively"]
_HEADING_RE = re.compile(r"^\d+\.\s+(.+)$")


def _sections(docx_bytes: bytes) -> dict[str, str]:
    """{section title (lowercase): all text under it, tables included}, in order."""
    document = docx.Document(io.BytesIO(docx_bytes))
    sections: dict[str, list[str]] = {}
    current = "_front"
    for child in document.element.body.iterchildren():
        if child.tag.endswith("}p"):
            p = Paragraph(child, document)
            text = p.text.strip()
            m = _HEADING_RE.match(text)
            if m and p.style.name.startswith("Heading 1"):
                current = m.group(1).strip().lower()
                sections.setdefault(current, [])
            elif text:
                sections.setdefault(current, []).append(text)
        elif child.tag.endswith("}tbl"):
            for row in Table(child, document).rows:
                sections.setdefault(current, []).append(" | ".join(c.text for c in row.cells))
    return {k: "\n".join(v) for k, v in sections.items()}


def _find(sections: dict[str, str], title_word: str) -> str:
    return "\n".join(v for k, v in sections.items() if title_word in k)


def _check(case: dict, sections: dict[str, str]) -> list[str]:
    failures = []
    everything = "\n".join(sections.values()).lower()
    scope = _find(sections, "scope").lower()
    open_items = _find(sections, "open items").lower()
    spd_steps = _find(sections, "next steps").lower()
    payment = _find(sections, "payment schedule").lower()

    for phrase in GENERIC_BANNED + case.get("anywhere_must_not_contain", []):
        if phrase.lower() in everything:
            failures.append(f'banned phrase present: "{phrase}"')
    if payment and "milestone" not in payment:
        failures.append("payment schedule is not a Milestone table")

    for word in case.get("scope_must_not_contain", []) + case.get("scope_must_not_contain_extra", []):
        if word.lower() in scope:
            failures.append(f'Scope contains "{word}"')
    for word in case.get("scope_must_contain", []):
        if word.lower() not in scope:
            failures.append(f'Scope is missing "{word}"')
    for options in case.get("spd_next_steps_must_contain_any", []):
        if not any(o.lower() in spd_steps for o in options):
            failures.append(f"Next steps from SPD mentions none of {options}")
    investment = _find(sections, "investment").lower()
    for word in case.get("investment_must_not_contain", []):
        if word.lower() in investment:
            failures.append(f'Investment contains "{word}"')
    for word in case.get("investment_must_contain", []):
        if word.lower() not in investment:
            failures.append(f'Investment is missing "{word}"')
    for title in case.get("sections_must_not_be_placeholder_only", []):
        body = _find(sections, title).strip()
        if body and body.lower() == "[to be determined per client]":
            failures.append(f'"{title}" is only a placeholder')
    for options in case.get("open_items_must_contain_any", []):
        if not any(o.lower() in open_items for o in options):
            failures.append(f"Open items mentions none of {options}")
    for word in case.get("open_items_must_not_contain", []):
        if word.lower() in open_items:
            failures.append(f'Open items contains "{word}" (should be an SPD task, not a client item)')

    sentences = re.split(r"(?<=[.!?])\s+|\n", everything)
    for rule in case.get("hedged_sentences", []):
        for s in sentences:
            if all(w in s for w in rule["if_contains_all"]) and not any(w in s for w in rule["must_contain_any"]):
                failures.append(f"un-hedged claim: {s.strip()[:160]}")
    return failures


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cases_dir = Path(sys.argv[1])
    runs = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    logging.basicConfig(level=logging.INFO, format="    %(message)s")
    for noisy in ("httpx", "google_genai", "google_genai.models"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    client = TestClient(app)
    total_failed = 0
    for case_dir in sorted(p for p in cases_dir.iterdir() if p.is_dir()):
        case = json.loads((case_dir / "case.json").read_text(encoding="utf-8"))
        payload = {
            "client_name": case["client_name"],
            "client_contact": case["client_contact"],
            "meeting_notes": (case_dir / "notes.txt").read_text(encoding="utf-8"),
            "additional_info": case.get("additional_info", ""),
        }
        for run in range(1, runs + 1):
            print(f"\n=== {case_dir.name} — run {run}/{runs} ===")
            analysed = client.post("/proposals/analyse", json=payload)
            analysed.raise_for_status()
            generated = client.post("/proposals/generate", json={**payload, "sections": analysed.json()["sections"]})
            generated.raise_for_status()
            docx_bytes = base64.b64decode(generated.json()["docx_base64"])
            (case_dir / f"output_run{run}.docx").write_bytes(docx_bytes)
            failures = _check(case, _sections(docx_bytes))
            if failures:
                total_failed += 1
                print("  FAIL")
                for f in failures:
                    print(f"   - {f}")
            else:
                print("  PASS")
    print(f"\n{total_failed} failing run(s)")
    return 1 if total_failed else 0


if __name__ == "__main__":
    sys.exit(main())
