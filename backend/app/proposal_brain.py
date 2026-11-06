"""Loads the proposal generator's company brain (backend/proposal_brain/*.md) and its
master section list. Read from files on disk and cached; backend-only, never sent to
the browser except the section titles the user ticks in the section-check step.

Same approach as context_loader.py: no chunking or vector store, the whole brain is
small enough to go into the prompt as context every time.
"""

import re
from functools import lru_cache

from .config import PROPOSAL_BRAIN_DIR

TBD = "[To be determined per client]"

# Appended right after a number (price, payment %, duration) that came from a brain
# default rather than something the notes/additional info actually said — flags it
# in orange so a reviewer can tell "our standard default" apart from a confirmed deal
# fact, without hiding the figure itself the way TBD does.
CONFIRM = " (to be confirmed)"

# Everything except README.md (notes for humans) and sections.md (parsed separately).
_BRAIN_FILES = ("company.md", "products.md", "pricing.md", "standard_text.md", "references.md")

# e.g. "7. access_design | Access and permissions design | Optional | Include when ... | brain + notes"
_SECTION_RE = re.compile(r"^\s*(\d+)\.\s+(\w+)\s*\|\s*([^|]+?)\s*\|\s*(Core|Optional)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$")


@lru_cache(maxsize=1)
def load_brain() -> str:
    """All brain files joined into one context blob, each under its own file header."""
    parts = [
        f"## BRAIN FILE: {name}\n\n{(PROPOSAL_BRAIN_DIR / name).read_text(encoding='utf-8')}"
        for name in _BRAIN_FILES
    ]
    return "\n\n---\n\n".join(parts)


@lru_cache(maxsize=1)
def load_sections_text() -> str:
    """sections.md as-is, for the AI's context."""
    return (PROPOSAL_BRAIN_DIR / "sections.md").read_text(encoding="utf-8")


_TERMS_HEADING_RE = re.compile(r"^## Terms and conditions.*$", re.MULTILINE)
_NEXT_HEADING_RE = re.compile(r"^## ", re.MULTILINE)


@lru_cache(maxsize=1)
def _standard_text() -> str:
    return (PROPOSAL_BRAIN_DIR / "standard_text.md").read_text(encoding="utf-8")


def terms_and_conditions_text(client_name: str) -> str:
    """The 17 standard terms clauses, inserted word for word — never rewritten by the
    AI, per the rule that legal text must be identical on every proposal — with
    [Client] filled in. Each clause is already one line in standard_text.md; joined
    with a blank line between them so proposal_docx._add_body renders each as its
    own paragraph."""
    text = _standard_text()
    heading = _TERMS_HEADING_RE.search(text)
    if not heading:
        return TBD
    rest = text[heading.end():]
    next_heading = _NEXT_HEADING_RE.search(rest)
    body = rest[: next_heading.start() if next_heading else None].strip()
    clauses = [line.strip().replace("[Client]", client_name) for line in body.splitlines() if line.strip()]
    return "\n\n".join(clauses)


@lru_cache(maxsize=1)
def _company_text() -> str:
    return (PROPOSAL_BRAIN_DIR / "company.md").read_text(encoding="utf-8")


_SIGNATORY_RE = re.compile(r"^-\s*Signatory:\s*([^,]+),\s*([^,]+?)\s*,\s*.+$", re.MULTILINE)
_VALIDITY_RE = re.compile(r"valid for (\d+) days", re.IGNORECASE)


def spd_signatory() -> tuple[str, str]:
    """SPD's own signatory (name, title), read from company.md's "Signatory:" line —
    the one place this fact is defined, so the deterministic signature block in
    proposal_docx.py never carries its own separate copy."""
    m = _SIGNATORY_RE.search(_company_text())
    if not m:
        return TBD, TBD
    return m.group(1).strip(), m.group(2).strip()


def validity_days() -> int:
    """How many days a proposal stays valid, read from standard_text.md's own Terms
    clause 17 ("valid for N days") rather than a separate hardcoded copy."""
    m = _VALIDITY_RE.search(_standard_text())
    return int(m.group(1)) if m else 30


@lru_cache(maxsize=1)
def load_sections() -> tuple[dict, ...]:
    """sections.md parsed into structured rows, in document order, for the
    section-check screen and for validating the AI's picks."""
    sections = []
    for line in load_sections_text().splitlines():
        m = _SECTION_RE.match(line)
        if m:
            num, key, title, kind, guidance, sources = m.groups()
            sections.append({
                "order": int(num),
                "key": key,
                "title": title,
                "core": kind == "Core",
                "guidance": guidance,
                "sources": sources,
            })
    return tuple(sections)
