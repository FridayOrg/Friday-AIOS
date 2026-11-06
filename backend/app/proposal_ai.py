"""The AI calls behind the proposal generator. Kept separate from main.py (routing)
and proposal_docx.py (layout/design — the AI never touches that file) per the
project's existing module split.

Flow for one proposal:
  analyse   select_sections()        which optional sections apply
  generate  build_scope_decisions()  every possible work item from the notes, sorted
                                     into agreed / open / SPD's own task, each with a
                                     word-for-word quote that code checks really is in
                                     the notes
            draft                    the writer drafts every AI-written section
            review -> fix (x2)       an independent reviewer lists grounding problems
                                     against the notes (first) and brain (second); the
                                     writer fixes only those; repeated once more

What the engagement includes is decided once, in the scope decisions, and the Scope,
Open items and SPD next-steps sections are built from them in code — so the writer
can't quietly promise something that was only discussed.

Every call returns strict JSON (enforced by its system prompt, parsed defensively in
case the model still wraps it in a code fence) and covers all sections in one call.
"""

import json
import logging
import re
from difflib import SequenceMatcher

from .llm_client import ask_friday
from .proposal_brain import CONFIRM, TBD, load_brain, load_sections

logger = logging.getLogger(__name__)

SCOPE_KEY = "scope"
OPEN_KEY = "open_items"
SPD_STEPS_KEY = "spd_next_steps"
INVESTMENT_KEY = "investment"
TEAM_KEY = "project_team"
_CODE_BUILT_KEYS = {SCOPE_KEY, OPEN_KEY, SPD_STEPS_KEY, INVESTMENT_KEY}

REVIEW_ROUNDS = 2

# Phrases that overstate what any meeting could establish. Checked in code after
# every draft/fix rather than trusted to the prompt alone, since the model doesn't
# reliably avoid them on its own.
BANNED_PHRASES = {
    "data residency": "if the source says data stays in the client's Microsoft tenant, say exactly that instead",
    "natively": "describe it plainly as running within the client's environment instead",
}

# "<client>'s offices" / "its offices" is the exact wording of a mistake that keeps
# recurring: a location list that belongs to a parent/affiliate group mentioned in the
# notes gets attributed to the client itself. Code can't know the right wording, but it
# can force every occurrence back in front of the fix pass instead of trusting one
# general instruction to catch it.
def _offices_attribution_re(client_name: str) -> re.Pattern:
    return re.compile(rf"\b(?:its|{re.escape(client_name)}'s)\s+(?:own\s+)?offices\b", re.IGNORECASE)


# Material described as already attached/included/provided while the proposal itself
# still marks it as a placeholder — a direct contradiction a reader would notice
# immediately.
_FALSE_ATTACHMENT_RE = re.compile(
    r"\b(?:attached to this proposal|attached below|included with this proposal|provided with this proposal)\b",
    re.IGNORECASE,
)

AGREED, OPEN, SPD_ACTION, OTHER_CLIENT = "agreed", "open", "spd_action", "other_client"
_KEPT_STATUSES = (AGREED, OPEN, SPD_ACTION)

# A next step that's just "send/prepare the <product> proposal" is the document being
# generated right now — listing it as a next step inside itself reads as nonsense, so
# it's dropped. Anything with real content beyond naming the product (e.g. "...
# covering implementation, customization and site expansion") is kept.
_SELF_PROPOSAL_RE = re.compile(
    r"^(?:(?:prepare|send|draft|create|provide|deliver)\s+(?:and\s+send\s+)?)?(?:the\s+)?(?:\w+\s+)?proposal$",
    re.IGNORECASE,
)

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```\s*$", re.MULTILINE)


def _parse_json(text: str) -> dict:
    cleaned = _FENCE_RE.sub("", text.strip()).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end == -1:
            raise
        return json.loads(cleaned[start : end + 1])


def _notes_block(meeting_notes: str, additional_info: str) -> str:
    extra = additional_info.strip() or "(none given)"
    return f"MEETING NOTES:\n{meeting_notes.strip()}\n\nADDITIONAL INFORMATION (optional, may be empty):\n{extra}"


# ---------------------------------------------------------------------------
# Step 1: which optional sections apply
# ---------------------------------------------------------------------------

ANALYSE_SYSTEM_PROMPT = """You are selecting which optional sections belong in a \
SharePoint Designs (SPD) sales proposal, based on a meeting-notes summary and any \
additional information the SPD team member drafting it has supplied.

Rules:
- Include a section ONLY when the notes or additional information clearly support \
its stated condition below. When genuinely unsure, leave it out: a missed optional \
section is far less of a problem than one that doesn't belong.
- Base your decision only on the OPTIONAL SECTIONS list and its conditions, and the \
notes/additional information given to you in the next message. Nothing else.
- Respond with strict JSON only, no markdown code fences, no commentary: \
{"include": ["key1", "key2"]} — keys only from the OPTIONAL SECTIONS list below. An \
empty array is a valid answer if nothing qualifies."""


def select_sections(client_name: str, client_contact: str, meeting_notes: str, additional_info: str) -> list[str]:
    optional_rows = [s for s in load_sections() if not s["core"]]
    listing = "\n".join(f"- {s['key']} | {s['title']} | {s['guidance']}" for s in optional_rows)
    question = (
        f"OPTIONAL SECTIONS (choose from these keys only):\n{listing}\n\n"
        f"Client: {client_name} (contact: {client_contact})\n\n"
        f"{_notes_block(meeting_notes, additional_info)}\n\n"
        "Decide which optional sections to include and return the JSON now."
    )
    data = _parse_json(ask_friday(ANALYSE_SYSTEM_PROMPT, question))
    valid_keys = {s["key"] for s in optional_rows}
    included = data.get("include", [])
    if not isinstance(included, list):
        return []
    return [k for k in included if k in valid_keys]


# ---------------------------------------------------------------------------
# Step 2: scope decisions — what this engagement includes, decided once
# ---------------------------------------------------------------------------

SCOPE_SYSTEM_PROMPT = """You read a meeting-notes summary (and any additional \
information) from a SharePoint Designs (SPD) sales conversation and list every item it \
mentions, each as exactly one kind:

- "deliverable": a product, piece of work or service that the engagement itself would \
deliver to the client if they sign — e.g. a product licence, implementation, \
configuration, customisation, training, a later-phase product. A product being \
proposed is one deliverable; the individual features shown while presenting it are \
not separate items.
- "follow_up": an action before any engagement is signed — preparing or sending the \
proposal, sending documents, documentation, references, certifications or other \
material the client wants to see before deciding, researching something, scheduling \
a meeting or demonstration, getting feedback, making a decision. Never a \
deliverable, even when the client asked for it.
- "other_client": work SPD described doing for a different client, told as an \
illustration of what SPD can do.

For a "deliverable", set "agreed": true only if the client explicitly asked for it to \
be included in this proposal or engagement, or both sides clearly agreed it will be \
delivered. When the client asks for the proposal to cover or price a product or \
piece of work, that product or work is an agreed deliverable — list it as its own \
item — while preparing and sending the proposal, and any documents requested \
alongside it, are separate follow_ups. If it was only discussed, shown, suggested, of interest, or named as a \
possible later phase, "agreed" is false. When unsure, false.

For a "follow_up", set "owner": "spd" if SPD (or a named SPD person) said they will do \
it; "client" if the client will; "both" if it needs both sides.

Rules:
- Use only the meeting notes and additional information. Not general knowledge.
- Do not list the same thing twice.
- "item": one short, plain line describing the item — no marketing language, no claims \
beyond what the evidence shows.
- "evidence": a passage copied WORD FOR WORD, as one continuous piece of text, from \
the meeting notes or additional information, at most about 30 words, that shows why \
the kind and agreed/owner value are right. Never paraphrase or join separate passages \
— it is checked against the notes mechanically and the item is dropped if it isn't \
found there.

Respond with strict JSON only, no markdown code fences, no commentary: \
{"items": [{"item": "...", "kind": "deliverable|follow_up|other_client", \
"agreed": true, "owner": "spd|client|both", "evidence": "..."}]} — include "agreed" \
only for deliverables and "owner" only for follow-ups."""


def _status_for(entry: dict) -> str | None:
    """Turns the AI's kind/agreed/owner answer into a status in code, so only a
    deliverable can ever reach Scope and every pre-signature action lands in Open items
    or SPD's next steps."""
    kind = str(entry.get("kind", "")).strip()
    if kind == "other_client":
        return OTHER_CLIENT
    if kind == "deliverable":
        return AGREED if entry.get("agreed") is True else OPEN
    if kind == "follow_up":
        return SPD_ACTION if str(entry.get("owner", "")).strip() == "spd" else OPEN
    return None


def _normalise(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def _evidence_in_source(evidence: str, source_normalised: str) -> bool:
    """True if the quoted evidence really appears in the notes/additional info —
    exactly, or with at least 80% of it as one unbroken match (tolerating small
    differences like punctuation or a dropped word at either end)."""
    quote = _normalise(evidence)
    if len(quote) < 12:
        return False
    if quote in source_normalised:
        return True
    match = SequenceMatcher(None, quote, source_normalised, autojunk=False).find_longest_match(
        0, len(quote), 0, len(source_normalised)
    )
    return match.size >= 0.8 * len(quote)


def build_scope_decisions(meeting_notes: str, additional_info: str) -> list[dict]:
    question = f"{_notes_block(meeting_notes, additional_info)}\n\nList and sort every item now."
    data = _parse_json(ask_friday(SCOPE_SYSTEM_PROMPT, question))
    raw_items = data.get("items", [])
    if not isinstance(raw_items, list):
        raw_items = []

    source = _normalise(f"{meeting_notes}\n{additional_info}")
    decisions, seen = [], set()
    for entry in raw_items:
        if not isinstance(entry, dict):
            continue
        item = str(entry.get("item", "")).strip().rstrip(".").strip()
        status = _status_for(entry)
        evidence = str(entry.get("evidence", "")).strip()
        if not item or status is None:
            continue
        if status == OTHER_CLIENT:
            logger.info("Scope: left out another client's example: %s", item)
            continue
        if status == SPD_ACTION and _SELF_PROPOSAL_RE.match(item):
            logger.info("Scope: left out %r — it's this proposal document itself", item)
            continue
        if not _evidence_in_source(evidence, source):
            logger.warning("Scope: dropped %r (%s) — its evidence isn't in the notes: %r", item, status, evidence)
            continue
        if item.lower() in seen:
            continue
        seen.add(item.lower())
        decisions.append({"item": item, "status": status, "kind": entry.get("kind"), "evidence": evidence})
    return decisions


def _decisions_listing(decisions: list[dict]) -> str:
    if not decisions:
        return "(none found in the notes)"
    return "\n".join(f'- [{d["status"]}] {d["item"]} — evidence: "{d["evidence"]}"' for d in decisions)


def _render_decisions(decisions: list[dict], status: str, marker: str = "") -> str:
    lines = [f"- {d['item']}{marker}" for d in decisions if d["status"] == status]
    return "\n".join(lines) if lines else TBD


def _code_built_sections(decisions: list[dict]) -> dict[str, str]:
    return {
        SCOPE_KEY: _render_decisions(decisions, AGREED),
        OPEN_KEY: _render_decisions(decisions, OPEN, CONFIRM),
        SPD_STEPS_KEY: _render_decisions(decisions, SPD_ACTION, CONFIRM),
    }


# ---------------------------------------------------------------------------
# Investment — one price line per agreed item, built in code
# ---------------------------------------------------------------------------

PRICING_SYSTEM_PROMPT = """You look up the price of each agreed deliverable in a \
SharePoint Designs (SPD) proposal. For each item listed under AGREED ITEMS:

1. If the meeting notes or additional information state a price for that item, use \
it: "price_source": "notes".
2. Otherwise, if the SPD company brain gives a default price for that exact item, \
use it: "price_source": "brain".
3. Otherwise "price_source": "none" and "unit_price": null. Never estimate.

"unit_price" is a plain number (no currency symbol or commas). "price_evidence" is \
the passage containing that price, copied WORD FOR WORD as one continuous piece of \
text from the source you used (notes/additional information, or the brain), at most \
about 30 words — it is checked mechanically. "recurring" is "month" or "year" if the \
source says the price is charged per month or per year, otherwise "".

"quantity" is how many units the unit price applies to, only if the meeting notes or \
additional information state it (e.g. a number of sites or licences), otherwise null; \
"quantity_evidence" is the word-for-word passage from the notes or additional \
information that states it.

Respond with strict JSON only, no markdown code fences, no commentary: \
{"prices": [{"item": "<exactly as listed>", "unit_price": null, "price_source": \
"notes|brain|none", "price_evidence": "", "recurring": "", "quantity": null, \
"quantity_evidence": ""}]}"""


def _money(amount: float) -> str:
    return f"${amount:,.0f}" if float(amount).is_integer() else f"${amount:,.2f}"


def _price_cell(entry: dict, notes_norm: str, brain_norm: str) -> str:
    """The Price cell for one agreed item. Every figure is checked against the source
    it claims to come from; anything that doesn't check out becomes the placeholder.
    Quantity x unit maths is done here, never by the model."""
    try:
        unit = float(entry.get("unit_price"))
    except (TypeError, ValueError):
        return TBD
    source = entry.get("price_source")
    evidence = str(entry.get("price_evidence", ""))
    source_norm = notes_norm if source == "notes" else brain_norm if source == "brain" else None
    unit_digits = f"{unit:.2f}".rstrip("0").rstrip(".").replace(".", " ")
    if (
        source_norm is None
        or unit <= 0
        or not _evidence_in_source(evidence, source_norm)
        or unit_digits not in _normalise(evidence.replace(",", ""))
    ):
        return TBD

    marker = CONFIRM if source == "brain" else ""
    recurring = str(entry.get("recurring", "")).strip()
    per = f" per {recurring}" if recurring in ("month", "year") and recurring in evidence.lower() else ""

    try:
        quantity = float(entry.get("quantity"))
    except (TypeError, ValueError):
        quantity = None
    quantity_ok = quantity is not None and quantity.is_integer() and quantity > 1
    if quantity_ok and _evidence_in_source(str(entry.get("quantity_evidence", "")), notes_norm):
        return f"{int(quantity)} x {_money(unit)}{marker}{per} = {_money(unit * quantity)}{marker}{per}"
    return f"{_money(unit)}{marker}{per}"


def build_investment(decisions: list[dict], meeting_notes: str, additional_info: str) -> str:
    agreed = [d["item"] for d in decisions if d["status"] == AGREED]
    if not agreed:
        return TBD
    question = (
        "AGREED ITEMS:\n" + "\n".join(f"- {item}" for item in agreed) + "\n\n"
        f"SPD COMPANY BRAIN:\n{load_brain()}\n\n"
        f"{_notes_block(meeting_notes, additional_info)}\n\n"
        "Return the prices JSON now."
    )
    try:
        data = _parse_json(ask_friday(PRICING_SYSTEM_PROMPT, question))
        entries = {str(p.get("item", "")).strip().lower(): p for p in data.get("prices", []) if isinstance(p, dict)}
    except Exception as e:
        logger.warning("Pricing lookup failed, every price left as the placeholder: %s", e)
        entries = {}

    notes_norm = _normalise(f"{meeting_notes}\n{additional_info}")
    brain_norm = _normalise(load_brain())
    rows = []
    for item in agreed:
        entry = entries.get(item.lower(), {})
        price = _price_cell(entry, notes_norm, brain_norm)
        logger.info("Price: %s -> %s (%s)", item, price, entry.get("price_source"))
        rows.append(f"{item.replace('|', '/')} | {price}")
    return "TABLE: Item | Price\n" + "\n".join(rows)


def _apply_relabels(decisions: list[dict], relabels: list) -> None:
    """Moves items between agreed / open / SPD action. The reviewer can never delete
    an item — removal only happens in build_scope_decisions, backed by evidence."""
    by_item = {d["item"].lower(): d for d in decisions}
    for r in relabels if isinstance(relabels, list) else []:
        if not isinstance(r, dict):
            continue
        target = by_item.get(str(r.get("item", "")).strip().rstrip(".").strip().lower())
        new_status = str(r.get("status", "")).strip()
        if target is None or new_status == target["status"] or new_status not in _KEPT_STATUSES:
            continue
        if new_status == AGREED and target.get("kind") != "deliverable":
            continue  # a pre-signature follow-up can never become a Scope deliverable
        logger.info("Review: relabelled %r from %s to %s", target["item"], target["status"], new_status)
        target["status"] = new_status


_PLACEHOLDER_SENTENCE_RE = re.compile(r"(?:^|[.!?]\s+|\n)" + re.escape(TBD) + r"\s*[.,;:]")


def _lint(written: dict[str, str], client_name: str) -> list[dict]:
    """Mechanical checks done in code after every draft/fix, fed back as issues."""
    issues = [
        {"section": key, "claim": phrase, "source": "banned phrase", "fix": f'remove "{phrase}": {fix}'}
        for key, body in written.items()
        for phrase, fix in BANNED_PHRASES.items()
        if phrase in body.lower()
    ]
    issues += [
        {"section": key, "claim": TBD, "source": "the placeholder stands in for a whole sentence",
         "fix": "rewrite that sentence from what the notes or brain say, keeping the placeholder "
                "only in place of the one specific fact that is missing"}
        for key, body in written.items()
        if _PLACEHOLDER_SENTENCE_RE.search(body)
    ]
    offices_re = _offices_attribution_re(client_name)
    issues += [
        {"section": key, "claim": m.group(0), "source": "ownership not verified",
         "fix": f"re-check whose offices/locations the notes actually attribute this to — if it's a "
                f"parent/affiliate group mentioned in the notes rather than {client_name} itself, "
                f"attribute it to that group instead, exactly as the notes do"}
        for key, body in written.items()
        for m in offices_re.finditer(body)
    ]
    issues += [
        {"section": key, "claim": m.group(0), "source": "contradicts a placeholder in the same section",
         "fix": 'say "to be provided" / "available on request" instead — this section still lists '
                "that material as a placeholder, so it can't be described as already attached/included"}
        for key, body in written.items()
        for m in _FALSE_ATTACHMENT_RE.finditer(body)
        if TBD in body
    ]
    return issues


# A price or percentage that isn't already followed by the marker. The first
# lookahead stops a match ending mid-number (so "$11,999" is never split).
_UNMARKED_FIGURE_RE = re.compile(
    r"(\$\s?\d+(?:,\d{3})*(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%)(?![\d,]*\d)(?!" + re.escape(CONFIRM) + ")"
)


def _enforce_confirm_markers(written: dict[str, str], meeting_notes: str, additional_info: str) -> dict[str, str]:
    """Every price or percentage that isn't stated in the notes/additional info came
    from a brain default (anything else would be invented), so it must carry the
    (to be confirmed) marker. Applied in code so neither the writer nor the reviewer
    can drop it."""
    source = re.sub(r"(?<=\d),(?=\d)", "", f"{meeting_notes} {additional_info}")
    source_numbers = set(re.findall(r"\d+(?:\.\d+)?", source))

    def mark(match: re.Match) -> str:
        figure = match.group(1)
        number = re.sub(r"[^\d.]", "", figure)
        return figure if number in source_numbers else figure + CONFIRM

    return {key: _UNMARKED_FIGURE_RE.sub(mark, body) for key, body in written.items()}


# ---------------------------------------------------------------------------
# Step 3: write the draft, then review -> fix
# ---------------------------------------------------------------------------

# Shared by the first draft and every fix pass, so a fix is held to exactly the same
# rules as the draft it corrects. Deliberately written as principles with
# placeholders, not sample sentences: a concrete example phrase in an instruction
# tends to get copied into proposals where it doesn't fit.
_WRITING_RULES = f"""Sources, in priority order: the meeting notes and additional \
information first; the SPD company brain only for points the notes don't cover. You \
never use outside/general knowledge and never invent a fact, name, client, figure or \
date that isn't in what you were given.

SCOPE DECISIONS (given in the next message) are final for what this engagement \
includes. The Scope, Investment, Open items and Next-steps-from-SPD sections are built \
from them automatically — you never write those, and never repeat their prices elsewhere. \
In every section you do write:
- Only "{AGREED}" items may be described as included, delivered, part of the \
solution, or priced.
- "{OPEN}" items may only be mentioned as possibilities still to be confirmed — never \
as included or committed.
- "{SPD_ACTION}" items are SPD's own tasks — never a deliverable, never a decision or \
action placed on the client.
- Anything not in the scope decisions must not be presented as part of this \
engagement at all.

Pricing rule, for every price, percentage or duration a section needs:
1. If the meeting notes or additional information state it for that specific item, \
use it exactly, with no marker — it is a confirmed deal fact.
2. Otherwise, if the brain gives a default for that exact item (a list price, a \
payment-milestone pattern, a duration), you MUST use that brain figure — do not \
write {TBD} just because the notes are silent. Put the exact phrase "{CONFIRM}" \
immediately after every such figure (format: "$<amount>{CONFIRM}", \
"<number>%{CONFIRM}"). A brain default is a standard starting point, not something \
this client has agreed to, so it must read as pending confirmation — but it is still \
a real number, not a gap.
3. Only if neither the notes nor the brain give any figure for that item, write \
exactly the phrase {TBD} in its place. Never estimate, average or guess a figure, \
and never use {TBD} in place of a brain figure that exists.
- The brain's payment-milestone stage names are generic templates, not required \
wording. If a stage name describes work the notes say isn't happening, rename that \
stage to describe what the notes say will happen instead. The percentage and its \
marker stay the same.

Any other concrete fact a section needs (a date, a duration, a named person, a \
figure, a reference client) that isn't in the notes, additional information or brain \
must be written as exactly the phrase {TBD}, at the point it belongs — never silently \
omitted and never paraphrased around. {TBD} replaces only that one missing fact, \
never a whole sentence or clause; the sentence around it must still read naturally.

Match the strength of every statement to its source:
- Never state something more strongly than the notes do. A verb describing what \
happened in the meeting (demonstrated, described, discussed, mentioned, agreed, \
confirmed, investigated) must match the verb the notes use for that thing.
- Conditional or hedged statements stay conditional — if the notes say something \
should hold because of a stated condition, keep both the hedge and the condition.
- Do not add implementation or mechanism detail (how something technically works, \
what it is built on, what access-control model it uses) beyond what the notes or \
brain explicitly state, even if it sounds standard for that kind of product.
- The brain lists each product/service under its own heading. A fact under one \
product's heading (e.g. Sangha) describes only that product — never use it to \
describe a different product (e.g. DocVault) just because both appear in the same \
brain file. Use only the heading(s) for the product(s) actually in this engagement's \
scope decisions.
- Never combine two different capabilities' effects into one broader claim (e.g. if \
one control restricts downloading/printing and a separate one stops an outside \
recipient opening a forwarded file, describe them as the two separate things the \
source says, not as one general guarantee).
- Never use these words or phrases: {"; ".join(f'"{p}" ({fix})' for p, fix in BANNED_PHRASES.items())}.
- When the notes involve more than one organisation (e.g. the client and a parent or \
affiliate group), keep every fact — offices, needs, plans — attributed to the \
organisation the notes attribute it to.
- No section may contradict another (e.g. something called included in one section \
and excluded in another).

For a section marked CUSTOM (one the user added themselves): write it only if the \
notes or additional information contain information clearly relevant to its title; \
otherwise its entire body must be exactly {TBD}.

Writing style: professional, concise, specific to this client — refer to the client \
by the name given to you, and reference actual names/figures/dates from what you were \
given rather than speaking generally. No \
filler, no marketing fluff beyond what the brain itself states. Keep each section to \
roughly 2-6 sentences or up to about 6 bullet points of surrounding text (a table's \
own rows don't count against this); this is a working draft for a human to review, \
not a finished brochure.

Formatting, exactly as it will be parsed by code — do not use markdown (no \
**bold**, no numbered lists):
- A blank line starts a new paragraph.
- A line starting with "- " is a bullet point.
- A short standalone line (60 characters or fewer) ending with ":" becomes a \
sub-heading.
- Where the content is naturally tabular — a price breakdown, payment milestones, a \
delivery timeline or phase plan, a short reference grid — put it in its own block \
(separated from surrounding text by a blank line), written as:
TABLE: <Column 1> | <Column 2> | <Column 3>
<cell> | <cell> | <cell>
  Every row must have the same number of "|"-separated cells as the header. Use a \
table only where it is clearly the clearest way to present the content. Executive \
summary, What we heard, Solution overview, Why SharePoint Designs, Assumptions and \
dependencies, Exclusions, and What we need from the client should normally stay \
prose/bullets.
- The payment_schedule section must ALWAYS be a TABLE block with columns \
Milestone | Amount | Due — one row per payment milestone. If a milestone's amount or \
due point isn't stated, write {TBD} in that cell rather than dropping the row."""

GENERATE_SYSTEM_PROMPT = f"""You write the body text of the sections of a \
SharePoint Designs (SPD) sales proposal, using only the SPD company brain, the scope \
decisions, the meeting notes and any additional information given to you in the \
next message.

{_WRITING_RULES}

Respond with strict JSON only, no markdown code fences, no commentary, in exactly \
this shape: {{"sections": {{"<key>": "<body text for that section>", ...}}, \
"project_team_rows": [{{"name": "...", "role": "...", "responsibility": "..."}}]}}. \
Include exactly one "sections" entry per key listed under SECTIONS TO WRITE, using \
those exact keys, and nothing else; see the note below SECTIONS TO WRITE for what \
belongs in "project_team_rows"."""

REVIEW_SYSTEM_PROMPT = f"""You are an independent reviewer auditing a just-drafted \
SharePoint Designs (SPD) proposal before it reaches a human. You did not write it — \
treat every sentence with suspicion until you can point to its source. You only \
report problems; you never rewrite the proposal yourself.

For every factual claim in every section — a capability, an architecture detail, a \
scope item, a number, a date, a name, a degree of certainty, an attribution to an \
organisation — find its source, in this order:
1. Meeting notes / additional information (first priority).
2. The SPD company brain (second priority, only for points the notes don't cover). \
Brain content is a legitimate source, not a problem — including named past clients, \
certifications, compliance positioning, standard terms and standard technical or \
process statements. Check the brain before calling anything unsourced. A number, \
percentage or duration taken from the brain must have the phrase "{CONFIRM}" right \
after it; that marker is ONLY for brain numbers, percentages and durations — never \
ask for it to be added to any other kind of claim.
3. Neither — that is a problem; the fix is to remove the claim or replace it with \
{TBD}, never to keep it with a "{CONFIRM}" marker.

The client's name and contact are given to you below as facts — never question them. \
When the notes refer to the client's organisation without naming it (the contact's \
organisation, "they", "their organisation"), that is the client named below.

What SPD recommends or proposes is the proposal's own position, not a factual claim \
about the meeting — do not flag a recommendation as unsourced, as long as what it \
recommends is backed by the scope decisions or the brain. Only flag statements of \
fact. Prefer a fix that rewords a claim to match its source over one that deletes it; \
ask for {TBD} only when a specific fact has no source at all.

A claim is also a problem when its source exists but the claim is STRONGER than the \
source: a verb upgraded (e.g. something discussed written as demonstrated or agreed), \
a hedged or conditional statement turned into a guarantee, an "{OPEN}" or \
"{SPD_ACTION}" item presented as included scope or as a client decision, a fact moved \
from one organisation to another, or added technical detail the sources don't state. \
Two sections contradicting each other is a problem too.

Any section that prices, or presents as included, something that is not an \
"{AGREED}" item (an open item, an SPD task, or something never discussed at all, such \
as a brain product the notes don't mention) is a problem. Payment-milestone stage \
names must describe work the notes say will actually happen.

Check the scope decisions as well: for each one, does its quoted evidence really \
support its status? If the evidence shows something was only discussed rather than \
agreed, or that it is SPD's own task, give it the correct status under "relabel". \
The Scope, Investment, Open items and Next-steps-from-SPD sections are built in code \
from the scope decisions, so problems with them are fixed only through "relabel", \
never listed under "issues".

Each section was written to its SECTION GUIDANCE (given below) — content the \
guidance asks for is not a problem. Do not report: the {TBD} or {CONFIRM} markers \
(never ask to add or remove them; code manages them), wording or style preferences, \
content correctly taken from the brain, or anything you cannot tie to a specific \
source mismatch. If everything is grounded, return empty lists.

Respond with strict JSON only, no markdown code fences, no commentary: \
{{"issues": [{{"section": "<key>", "claim": "<the exact problem text from the \
section>", "source": "<what the notes or brain actually say about it, quoted, or \
'no source'>", "fix": "<what must change>"}}], "relabel": [{{"item": "<scope decision \
item, exactly as given>", "status": "<{AGREED}|{OPEN}|{SPD_ACTION}>"}}]}}"""

FIX_SYSTEM_PROMPT = f"""You revise sections of a SharePoint Designs (SPD) proposal \
draft to resolve the reviewer's issues listed in the next message, and to bring it in \
line with the current scope decisions (which may have changed since the draft). \
Change only what each issue, or the scope decisions, require; leave all other text \
exactly as it is. The reviewer can be wrong: before acting on an issue, check it \
yourself against the notes, the brain and the section guidance. If the claim is \
actually supported, or the requested change would break a rule below or the section \
guidance, leave that text unchanged. The same rules as for the original draft apply \
in full:

{_WRITING_RULES}

Respond with strict JSON only, no markdown code fences, no commentary: \
{{"sections": {{"<key>": "<full revised body text for that section>", ...}}}}. \
Include only the sections you changed, using their exact keys, each with its full \
revised text."""


def _sections_text(written: dict[str, str]) -> str:
    return "\n\n".join(f"### {key}\n{body}" for key, body in written.items())


def _draft(
    client_name: str, client_contact: str, meeting_notes: str, additional_info: str,
    sections: list[dict], decisions: list[dict], team_requested: bool,
) -> tuple[dict[str, str], list[dict]]:
    guidance_by_key = {s["key"]: s["guidance"] for s in load_sections()}
    lines = []
    for s in sections:
        guidance = guidance_by_key.get(s["key"], f"A section the user added themselves, titled '{s['title']}'.")
        tag = " (CUSTOM)" if s.get("custom") else ""
        lines.append(f"- {s['key']} | {s['title']} | {guidance}{tag}")
    sections_listing = "\n".join(lines) if lines else "(none — only the project team table was requested)"

    team_note = (
        'ALSO list, in "project_team_rows", every SharePoint Designs (SPD) person '
        'named with a role in the meeting notes or additional information (fields: '
        'name, role, responsibility — role and responsibility only if stated, else an '
        f'empty string). This is SPD\'s own delivery team ONLY — never include {client_name}, '
        'its contact, or any other client-side or third-party person, even if they '
        'are named with a role. Return an empty array if no SPD person is named. '
        'Never invent a person.'
        if team_requested else
        'project_team_rows was not requested this time — always return it as an empty array.'
    )

    question = (
        f"SECTIONS TO WRITE:\n{sections_listing}\n\n{team_note}\n\n"
        f"SCOPE DECISIONS:\n{_decisions_listing(decisions)}\n\n"
        f"SPD COMPANY BRAIN:\n{load_brain()}\n\n"
        f"Client: {client_name} (contact: {client_contact})\n\n"
        f"{_notes_block(meeting_notes, additional_info)}\n\n"
        "Write the JSON now."
    )
    data = _parse_json(ask_friday(GENERATE_SYSTEM_PROMPT, question))
    written_raw = data.get("sections", {})
    if not isinstance(written_raw, dict):
        written_raw = {}
    written = {s["key"]: str(written_raw.get(s["key"]) or TBD) for s in sections}
    written = _enforce_confirm_markers(written, meeting_notes, additional_info)

    team_rows_raw = data.get("project_team_rows", [])
    team_rows = (
        [r for r in team_rows_raw if isinstance(r, dict) and r.get("name")]
        if isinstance(team_rows_raw, list) else []
    )
    return written, team_rows


def _review(
    client_name: str, client_contact: str, meeting_notes: str, additional_info: str,
    written: dict[str, str], decisions: list[dict],
) -> tuple[list[dict], list]:
    guidance = "\n".join(
        f"- {s['key']} | {s['title']} | {s['guidance']}"
        for s in load_sections() if s["key"] in written or s["key"] in _CODE_BUILT_KEYS
    )
    question = (
        f"PROPOSAL SECTIONS TO REVIEW:\n{_sections_text({**written, **_code_built_sections(decisions)})}\n\n"
        f"SECTION GUIDANCE:\n{guidance}\n\n"
        f"SCOPE DECISIONS:\n{_decisions_listing(decisions)}\n\n"
        f"SPD COMPANY BRAIN:\n{load_brain()}\n\n"
        f"Client: {client_name} (contact: {client_contact})\n\n"
        f"{_notes_block(meeting_notes, additional_info)}\n\n"
        "Review everything and return the JSON now."
    )
    data = _parse_json(ask_friday(REVIEW_SYSTEM_PROMPT, question))
    issues = data.get("issues", [])
    issues = [i for i in issues if isinstance(i, dict) and i.get("section") in written] if isinstance(issues, list) else []
    relabels = data.get("relabel", [])
    return issues, relabels if isinstance(relabels, list) else []


def _fix(
    meeting_notes: str, additional_info: str, written: dict[str, str],
    decisions: list[dict], issues: list[dict],
) -> dict[str, str]:
    issue_lines = "\n".join(
        f'- [{i.get("section")}] problem: "{i.get("claim", "")}" | source: {i.get("source", "")} | fix: {i.get("fix", "")}'
        for i in issues
    ) or "(no section issues — only re-check every section against the current scope decisions)"
    guidance = "\n".join(f"- {s['key']} | {s['title']} | {s['guidance']}" for s in load_sections() if s["key"] in written)
    question = (
        f"REVIEWER ISSUES:\n{issue_lines}\n\n"
        f"CURRENT DRAFT SECTIONS:\n{_sections_text(written)}\n\n"
        f"SECTION GUIDANCE:\n{guidance}\n\n"
        f"SCOPE DECISIONS (current):\n{_decisions_listing(decisions)}\n\n"
        f"SPD COMPANY BRAIN:\n{load_brain()}\n\n"
        f"{_notes_block(meeting_notes, additional_info)}\n\n"
        "Return the revised sections JSON now."
    )
    data = _parse_json(ask_friday(FIX_SYSTEM_PROMPT, question))
    revised = data.get("sections", {})
    if not isinstance(revised, dict):
        return written
    result = {}
    for key, body in written.items():
        new = revised.get(key)
        if not isinstance(new, str) or not new.strip():
            result[key] = body
        elif new.strip() == TBD and body.strip() != TBD:
            # A fix resolves specific problems; it never wipes out a whole section.
            logger.warning("Fix tried to replace all of [%s] with the placeholder; kept the previous text", key)
            result[key] = body
        else:
            result[key] = new
    return _enforce_confirm_markers(result, meeting_notes, additional_info)


def generate_sections(
    client_name: str, client_contact: str, meeting_notes: str, additional_info: str, sections: list[dict]
) -> tuple[dict[str, str], list[dict]]:
    """sections: [{"key": str, "title": str, "custom": bool}].
    Returns ({key: body_text} for every non-team key, [{"name","role","responsibility"}, ...]).
    The project team comes back as structured rows (it renders as a real table)."""
    team_requested = any(s["key"] == TEAM_KEY for s in sections)
    built_requested = [s["key"] for s in sections if s["key"] in _CODE_BUILT_KEYS and not s.get("custom")]
    ai_sections = [
        s for s in sections
        if s["key"] != TEAM_KEY and not (s["key"] in _CODE_BUILT_KEYS and not s.get("custom"))
    ]

    decisions = build_scope_decisions(meeting_notes, additional_info)
    logger.info("Scope decisions: %s", [(d["status"], d["item"]) for d in decisions])

    written, team_rows = _draft(
        client_name, client_contact, meeting_notes, additional_info, ai_sections, decisions, team_requested
    )

    for round_no in range(1, REVIEW_ROUNDS + 1):
        try:
            issues, relabels = _review(
                client_name, client_contact, meeting_notes, additional_info, written, decisions
            )
        except Exception as e:
            logger.warning("Proposal review round %d failed: %s", round_no, e)
            issues, relabels = [], []
        before = [d["status"] for d in decisions]
        _apply_relabels(decisions, relabels)
        scope_changed = before != [d["status"] for d in decisions]
        issues += _lint(written, client_name)
        logger.info("Review round %d: %d issue(s), scope changed: %s", round_no, len(issues), scope_changed)
        for i in issues:
            logger.info("  [%s] %s -> %s", i.get("section"), i.get("claim"), i.get("fix"))
        if not issues and not scope_changed:
            break
        try:
            written = _fix(meeting_notes, additional_info, written, decisions, issues)
        except Exception as e:
            logger.warning("Proposal fix round %d failed, keeping the current draft: %s", round_no, e)
            break

    leftover = _lint(written, client_name)
    if leftover:
        try:
            written = _fix(meeting_notes, additional_info, written, decisions, leftover)
        except Exception as e:
            logger.warning("Final lint fix failed: %s", e)
        for i in _lint(written, client_name):
            logger.warning("Lint issue still present after final fix: [%s] %s", i["section"], i["claim"])

    built = _code_built_sections(decisions)
    if INVESTMENT_KEY in built_requested:
        built[INVESTMENT_KEY] = build_investment(decisions, meeting_notes, additional_info)
    for key in built_requested:
        written[key] = built[key]
    return written, team_rows
