"""Tab 31 (Playbook) as code — the small, fixed rule set (R-001 to R-006) that looks
at Opportunities (tab 21) and Events (tab 22) and decides what needs attention,
producing Actions (tab 40). Plain rule-based logic, same spirit as stage_map.py — no
LLM, nothing probabilistic. Each rule is deliberately small and independently
testable per CLAUDE.md's "small, testable rules" principle.

One opportunity produces at most one action from rules R-001/R-002/R-003/R-004/R-005
(the first one that applies, in priority order below, matching the one-action-per-
deal pattern in the handoff doc's worked examples) plus, independently, R-006 for
any opportunity missing core fields regardless of the above.

Uses the real current date (config.now()), not a date frozen at authoring time, so
"expected close date has passed" stays correct as real time moves forward — unlike
the raw mock dates themselves, which are NOT auto-shifted the way the rest of the
app's mock-data/today.json mechanism shifts other mock files. This means the exact
actions produced today may drift from the handoff doc's worked examples (e.g. a
deal whose close date was "due today" when the doc was written will show as
"overdue" a day later) — expected, not a bug; flagged here rather than silently
hidden.
"""

import concurrent.futures
import logging
from datetime import date, timedelta

from . import calendar_client, db, gmail_client, hubspot_client
from .config import now

logger = logging.getLogger(__name__)

_HIGH_VALUE_THRESHOLD = 10000
_LATE_STAGES = {"Proposal", "Decision"}

# Source / Time Horizon per rule, matching tab 40's columns of the same name.
_RULE_META = {
    "R-001": ("CRM deal", "Today"),
    "R-002": ("CRM deal", "Today"),
    "R-003": ("CRM activity / note", "This Week"),
    "R-004": ("CRM activity / note", "Today"),
    "R-005": ("CRM deal", "Today"),
    "R-006": ("Internal data quality", "Today"),
}


_PRIORITY_ORDER = ["Low", "Medium", "High", "Critical"]


def _escalate_priority(priority: str, due: str | None, today: date) -> str:
    """A rule's own priority is a floor, not a ceiling — due date tomorrow or
    sooner escalates to at least High regardless of which rule produced the
    action, since something imminent is urgent no matter how low-stakes the
    rule that flagged it normally is (e.g. R-003's "Low" base priority for a
    wait-and-see action still needs to surface as High once the check-back
    date is right around the corner). Never downgrades an already-higher
    priority (e.g. R-002's Critical stays Critical even if due is weeks out)."""
    due_date = _parse_date(due)
    if not due_date or priority not in _PRIORITY_ORDER:
        return priority
    days_until = (due_date - today).days
    if days_until <= 1 and _PRIORITY_ORDER.index(priority) < _PRIORITY_ORDER.index("High"):
        return "High"
    return priority


def _action(rule: str, opp: dict, today: date, **fields) -> dict:
    source, time_horizon = _RULE_META[rule]
    if "priority" in fields and "due" in fields:
        fields["priority"] = _escalate_priority(fields["priority"], fields["due"], today)
    # action_override (opportunities.json, optional): replaces the row's
    # headline action text, same mechanism as suggestion_override for the
    # why_now text — without this, a deal with a hand-written, specific
    # recommendation (e.g. Atlas Logistics: "send references and an exit
    # clause to procurement") could still show a generic rule-template
    # headline ("Create a dated next action or requalify the deal") that
    # doesn't match what the detailed recommendation actually says to do.
    if "action" in fields and opp.get("action_override"):
        fields["action"] = opp["action_override"]
    return {
        "owner": opp.get("owner"),
        "status": "Open",
        "opportunity_id": opp["opportunity_id"],
        "deal": opp.get("deal"),
        "account": opp.get("account"),
        "value": opp.get("value"),
        # The CRM's own expected close date (not this action's own due date,
        # which is when Friday wants a follow-up — two independent dates
        # that happen to coincide sometimes). Live for Northstar/OakBridge/
        # Stonegate, mock-data/opportunities.json for every other deal.
        "expected_close": opp.get("expected_close"),
        "rule": rule,
        "source": source,
        "time_horizon": time_horizon,
        "user_decision": "Pending",
        "notes": "",
        **fields,
    }


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _next_business_day(d: date) -> date:
    nxt = d + timedelta(days=1)
    while nxt.weekday() >= 5:  # Saturday=5, Sunday=6
        nxt += timedelta(days=1)
    return nxt


def _future_commitment_event(opp_id: str, events: list[dict], today: date) -> dict | None:
    """R-003's trigger: a meaningful event on this deal with an agreed date
    today or later. Today counts, not just strictly future — a decision
    meeting booked for today still means "wait for it," not "treat this like
    any other no-next-action deal" (which is what R-001 would otherwise
    wrongly fall through to once the agreed date arrives)."""
    for e in events:
        if e["opportunity_id"] != opp_id:
            continue
        due = _parse_date(e.get("commitment_due"))
        if due and due >= today:
            return e
    return None


def _has_pending_seller_commitment(opp_id: str, events: list[dict]) -> bool:
    """R-004's trigger: a material event on this deal that still needs follow-up
    (creates_action True or "potentially"), i.e. a commitment nothing has closed out."""
    return any(
        e["opportunity_id"] == opp_id and e.get("material") and e.get("creates_action") in (True, "potentially")
        for e in events
    )


def _synthesize_commitment_events(
    opportunities: list[dict], calendar_events: list[dict], meeting_summaries: list[dict]
) -> list[dict]:
    """Bridges Fathom meeting-summary commitments into the events shape
    _future_commitment_event (R-003's trigger) and _has_pending_seller_
    commitment (R-004's trigger) already know how to read — for opportunities
    flagged `"live_commitments_from_calendar"` (currently Northstar and
    OakBridge, which have NO mock-data/events.json record to read a
    commitment_due from at all).

    Deliberately NOT sourced from live Calendar events anymore (an earlier
    version of this function synthesized a commitment from ANY future
    calendar event, on the theory that a scheduled meeting is itself a
    reason to wait) — that was wrong: a routine follow-up/review call being
    on the books doesn't mean the buyer told us not to chase, it's just a
    scheduled touchpoint. Booking a future call for a deal (e.g. GreenGrid's
    scope review) was incorrectly flipping it to R-003 "do not contact
    before this date" even though the actual next step — sending the scope
    — was still overdue and needed to happen before that call, not be
    blocked by it. A genuine "wait until X" commitment only exists when a
    buyer explicitly said so, which is what a Fathom meeting summary's
    action-item due_date actually represents (captured at the meeting,
    not inferred from the mere existence of a future booking)."""
    synthesized = []
    for opp in opportunities:
        if not opp.get("live_commitments_from_calendar"):
            continue

        for m in _matching_meeting_summaries(opp, meeting_summaries):
            for item in m.get("action_items") or []:
                due = item.get("due_date")
                d = _parse_date(due)
                if not d:
                    continue
                synthesized.append({
                    "event_id": f"LIVE-MEETING-{opp['opportunity_id']}-{m.get('recording_id', '')}",
                    "opportunity_id": opp["opportunity_id"],
                    "event_type": "CRM Note",
                    "date": due,
                    "commitment_due": due,
                    "summary": item.get("text") or "Buyer-agreed decision date",
                    "material": True,
                    "customer_interaction": True,
                    "commitment_or_decision": None,
                    "creates_action": False,
                })
    return synthesized


def _missing_core_fields(opp: dict) -> list[str]:
    """R-006's trigger: core fields the rules above depend on."""
    missing = []
    for field in ("revenueos_stage", "owner", "value"):
        if not opp.get(field):
            missing.append(field)
    return missing


# Maps each event_type onto which evidence bucket it belongs in, for the "Why?"
# panel's per-source breakdown (CRM / Meeting / Email / Calendar) — exactly one
# line per source, matching the brief's "CRM signal / Meeting signal / Email
# signal / Calendar signal" structure. CRM Note and Task are intentionally left
# unmapped: their content (an internal note on the deal, a pending CRM task) is
# already folded into _crm_signal()'s single synthesized CRM line via the
# opportunity's own stage/next_action fields, so mapping them here would create
# a second, redundant CRM entry. Meeting and Calendar are deliberately NOT
# derived from mock-data/events.json — they come from the real Meeting Summary
# (Fathom, via db.py) and real Calendar (Google Calendar, via calendar_client.py)
# features instead, see _matching_meeting_summaries()/_matching_calendar_events()
# below, so the "Why?" panel reflects what those two features actually show.
_EVIDENCE_BUCKET = {
    "Email": "Email",
}


def _opportunity_events(opp_id: str, events: list[dict]) -> list[dict]:
    return [e for e in events if e["opportunity_id"] == opp_id]


def _crm_signal(opp: dict) -> str:
    """The deal's own CRM-record state, synthesized into one sentence — always
    present, since the Opportunity record itself is always a source of
    evidence regardless of what activity has or hasn't happened on it."""
    stage = opp.get("revenueos_stage") or "an unknown stage"
    close = opp.get("expected_close")
    owner = opp.get("owner") or "no owner set"
    next_action = opp.get("next_action")
    value = opp.get("value")
    value_str = f"£{value:,.0f}" if isinstance(value, (int, float)) else "an unknown value"
    base = f"{value_str} deal in {stage}, owned by {owner}, expected to close {close or 'unknown'}."
    if next_action:
        base += f" Next action on file: {next_action}."
    else:
        base += " No next action on file."
    return base


def _find_hubspot_deal(account: str) -> tuple[dict, dict] | None:
    """The live HubSpot deal whose company name (deal.org_name) matches
    `account`, plus a {stage_id: stage_name} lookup — shared by
    _hubspot_crm_signal (evidence text) and build_live_opportunity (the
    opportunity record itself). Returns None on no match or any failure."""
    account = (account or "").strip().lower()
    if not account:
        return None
    try:
        deals = hubspot_client.get_deals()
        stage_names = {s["id"]: s["name"] for s in hubspot_client.get_stages()}
    except Exception as e:
        logger.warning("Could not read HubSpot: %s", e)
        return None
    match = next((d for d in deals if account in (d.get("org_name") or "").lower()), None)
    return (match, stage_names) if match else None


def _hubspot_crm_signal(opp: dict) -> str | None:
    """Live CRM signal sourced from the real, connected HubSpot pipeline
    instead of this opportunity's mock-data/opportunities.json record — used
    only for opportunities flagged `"crm_source": "hubspot"` (currently just
    Northstar, as a proof that the CRM evidence line can come from the actual
    system of record rather than the demo CRM snapshot). Matched by company
    name (HubSpot's deal.org_name) against the opportunity's `account` field —
    returns None (caller falls back to _crm_signal) if no matching deal is
    found or HubSpot is unreachable, so a live-data gap never breaks the
    Why? panel."""
    found = _find_hubspot_deal(opp.get("account"))
    if not found:
        return None
    match, stage_names = found

    value = match.get("value")
    value_str = f"£{value:,.0f}" if isinstance(value, (int, float)) else "an unknown value"
    stage = stage_names.get(match.get("stage_id"), match.get("stage_id") or "an unknown stage")
    owner = match.get("owner_name") or "no owner set"
    close = (match.get("expected_close_date") or "")[:10] or "unknown"
    base = f"{value_str} deal in {stage}, owned by {owner}, expected to close {close}. (Live from HubSpot.)"
    next_action = match.get("next_step")
    if next_action:
        base += f" Next action on file: {next_action}."
    else:
        base += " No next action on file."
    return base


def build_live_opportunity(opportunity_id: str, account: str, contact_person: str | None = None) -> dict | None:
    """Builds a full opportunity record (same shape as mock-data/
    opportunities.json's entries) entirely from the live HubSpot deal
    matching `account` — for opportunities with NO mock-data record at all
    (currently just Northstar), so the whole rule engine (R-001..R-006) runs
    against live CRM data, not a demo snapshot. `crm_source`/`email_source`
    are set so _build_evidence also sources those lines live (HubSpot/Gmail);
    `live_commitments_from_calendar` tells build_actions() to synthesize an
    R-003 trigger event from the live Calendar match (see
    _synthesize_commitment_events) since there's no mock-data/events.json
    commitment_due to read for this opportunity. Returns None if no matching
    HubSpot deal exists or HubSpot is unreachable — caller decides how to
    handle a live opportunity that's gone missing from its source system."""
    found = _find_hubspot_deal(account)
    if not found:
        return None
    match, stage_names = found
    return {
        "opportunity_id": opportunity_id,
        "source_system": "HubSpot",
        "source_record_id": match["id"],
        "deal": match.get("title") or account,
        "account": account,
        "contact_person": contact_person,
        "owner": match.get("owner_name"),
        "revenueos_stage": stage_names.get(match.get("stage_id"), match.get("stage_id")),
        "status": "Open" if match.get("status") == "open" else "Closed",
        "value": match.get("value"),
        "currency": "GBP",
        "expected_close": (match.get("expected_close_date") or "")[:10] or None,
        # HubSpot's native "Next step" deal property (hs_next_step) — reads as
        # the opportunity's next_action here so R-004 (a pending commitment
        # still needs following up on) can fire for live deals, same as it
        # does for mock ones, instead of always falling through to R-001's
        # generic "no next action on file" for lack of this one field.
        "next_action": match.get("next_step"),
        "next_action_due": None,
        "crm_source": "hubspot",
        "email_source": "gmail",
        "live_commitments_from_calendar": True,
    }


def _matching_gmail_emails(opp: dict, limit: int = 5) -> list[dict]:
    """Live inbox messages whose SUBJECT names this opportunity's account —
    via Gmail search — used only for opportunities flagged `"email_source":
    "gmail"` (currently just Northstar), so the Email evidence line comes
    from a real email rather than mock-data/events.json.

    Matches on `subject:` specifically rather than a full-text/body search:
    a deliberate subject line naming the account (e.g. "Northstar Legal:
    next steps after pricing discussion") is a precise, intentional signal
    about that deal, whoever sent it — including the account owner's own
    sent mail, which is legitimate evidence of what was communicated, not
    noise. A body that merely mentions the name in passing (an unrelated
    internal chat thread) wouldn't match, since subject-only is a much
    narrower net than searching every word of every email.

    Scoped to `newer_than:14d` (Gmail search operator) — two weeks back, same
    window as the live Calendar lookup — so a stale thread from months ago
    never gets read as current evidence, while a genuinely recent exchange
    still counts. Returns [] on no match or any failure, same convention as
    the other live-data matchers here."""
    account = (opp.get("account") or "").strip()
    if not account:
        return []
    try:
        results = gmail_client.search_emails(f'subject:"{account}" newer_than:14d', limit=limit)
    except Exception as e:
        logger.warning("Could not search Gmail for CRM evidence: %s", e)
        return []
    # Auto-replies/bounces (no-reply@…) aren't real correspondence about the
    # deal — drop them so the most-recent-first pick below lands on an
    # actual message, not a system-generated one.
    return [m for m in results if "no-reply" not in (m.get("sender") or "").lower()]


def _prefetch_gmail_evidence(opportunities: list[dict]) -> dict[str, list[dict]]:
    """Runs _matching_gmail_emails for every email_source=="gmail" opportunity
    concurrently instead of one search at a time — each Gmail search takes a
    couple of seconds, and awaiting them sequentially inside the per-
    opportunity loop (up to 10 on this demo) made /actions take 20-30s.
    Keyed by account name, the same key _matching_gmail_emails itself uses,
    so build_actions() can hand each opportunity its own pre-fetched result
    instead of searching again."""
    targets = {opp["account"] for opp in opportunities if opp.get("email_source") == "gmail" and opp.get("account")}
    if not targets:
        return {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(targets)) as pool:
        futures = {pool.submit(_matching_gmail_emails, {"account": account}): account for account in targets}
        return {futures[f]: f.result() for f in concurrent.futures.as_completed(futures)}


def _mentions(opp: dict, *texts: str | None) -> bool:
    """True if this opportunity's account or contact name appears in any of the
    given free-text fields (case-insensitive substring) — the only join key
    available against live Calendar/Fathom data, neither of which carries an
    opportunity_id (see _matching_meeting_summaries/_matching_calendar_events)."""
    account = (opp.get("account") or "").strip().lower()
    contact = (opp.get("contact_person") or "").strip().lower()
    haystack = " ".join(t for t in texts if t).lower()
    return (bool(account) and account in haystack) or (bool(contact) and contact in haystack)


def _matching_meeting_summaries(opp: dict, summaries: list[dict]) -> list[dict]:
    """Real Fathom meeting summaries (db.list_meeting_summaries()) that belong
    to this opportunity, matched by account/contact name against the title or
    participant list — oldest first, matching events.json's ordering elsewhere."""
    matched = [
        m for m in summaries
        if _mentions(opp, m.get("title")) or any(_mentions(opp, p) for p in (m.get("participants") or []))
    ]
    matched.sort(key=lambda m: m.get("started_at") or "")
    return matched


def _matching_calendar_events(opp: dict, calendar_events: list[dict]) -> list[dict]:
    """Real Google Calendar events (calendar_client.fetch_meetings()) that
    belong to this opportunity, matched by account/contact name against the
    event name/agenda or attendee list."""
    return [
        e for e in calendar_events
        if _mentions(opp, e.get("name"), e.get("agenda")) or any(_mentions(opp, a) for a in (e.get("attendees") or []))
    ]


def _calendar_signal(opp: dict, calendar_events: list[dict], today: date) -> str:
    """Derived from the real Calendar feature, not mock-data/events.json: is
    there a customer meeting already on the books for this opportunity? Looks
    both directions — a same-day meeting is reported distinctly ("scheduled
    for today") rather than folded into "no future meeting", and if nothing
    is upcoming, a meeting within the past 2 weeks is reported instead (e.g.
    "technical review completed") rather than just saying nothing's booked,
    since a recently-completed meeting is still meaningful calendar evidence.
    calendar_events itself is already scoped to a past-2-weeks/future-2-weeks
    window by build_actions() (fetch_meetings_window)."""
    matches = _matching_calendar_events(opp, calendar_events)
    upcoming = [e for e in matches if (d := _parse_date(e.get("date"))) and d >= today]
    if upcoming:
        upcoming.sort(key=lambda e: e["date"])
        nxt = upcoming[0]
        d = _parse_date(nxt["date"])
        when = "today" if d == today else f"for {nxt['date']}"
        return f"Meeting scheduled {when}: \"{nxt.get('name', '')}\"."

    past = [e for e in matches if (d := _parse_date(e.get("date"))) and d < today]
    if past:
        past.sort(key=lambda e: e["date"], reverse=True)
        last = past[0]
        return f"Last meeting was on {last['date']}: \"{last.get('name', '')}\". No future meeting booked."

    return "No future customer meeting booked."


def _build_evidence(
    opp: dict,
    events: list[dict],
    today: date,
    meeting_summaries: list[dict],
    calendar_events: list[dict],
    gmail_cache: dict[str, list[dict]] | None = None,
) -> list[dict]:
    """The full per-source evidence list backing one opportunity's action, for
    the "Why?" panel — CRM, Meeting, Email and Calendar signals, each labeled
    by source so the UI can show the combination that produced the
    recommendation rather than one flattened sentence. Meeting and Calendar
    come from the real Meeting Summary / Calendar features, not mock events.

    `evidence_exclude` (opportunities.json, optional) drops listed sources from
    the panel entirely. `crm_source: "hubspot"` (opportunities.json, optional)
    sources the CRM line from the real, connected HubSpot pipeline instead of
    this mock opportunity record (falls back to the mock record if no matching
    HubSpot deal is found). Either way, this only changes the evidence LINE;
    the rule engine itself still reads the opportunity's own CRM fields
    (stage, close date, etc.) as normal, so which rule fires is unaffected."""
    excluded = set(opp.get("evidence_exclude") or [])
    evidence = []
    if "CRM" not in excluded:
        signal = _hubspot_crm_signal(opp) if opp.get("crm_source") == "hubspot" else None
        evidence.append({"source": "CRM", "signal": signal or _crm_signal(opp)})

    if "Meeting" not in excluded:
        for m in _matching_meeting_summaries(opp, meeting_summaries):
            text = m.get("summary_markdown") or m.get("title") or ""
            if text:
                evidence.append({"source": "Meeting", "signal": text})

    if opp.get("email_source") == "gmail":
        if "Email" not in excluded:
            account = (opp.get("account") or "").strip()
            matches = gmail_cache[account] if gmail_cache is not None and account in gmail_cache else _matching_gmail_emails(opp)
            # Most recent only — one Email line per source, same as every
            # other evidence bucket, not a dump of every matching thread.
            mail = matches[0] if matches else None
            if mail:
                text = mail.get("summary") or mail.get("snippet") or mail.get("subject") or ""
                if text:
                    evidence.append({"source": "Email", "signal": f"{text} (Live from Gmail: \"{mail.get('subject', '')}\")"})
    else:
        for e in sorted(_opportunity_events(opp["opportunity_id"], events), key=lambda e: e.get("date", "")):
            bucket = _EVIDENCE_BUCKET.get(e.get("event_type"))
            if not bucket or bucket in excluded:
                continue
            decision = e.get("commitment_or_decision")
            # "Pending" is a status placeholder, not narrative evidence — fall back
            # to the summary so the Why? panel shows something a reader can act on.
            text = decision if decision and decision.strip().lower() != "pending" else e.get("summary") or ""
            if text:
                evidence.append({"source": bucket, "signal": text})

    if "Calendar" not in excluded:
        evidence.append({"source": "Calendar", "signal": _calendar_signal(opp, calendar_events, today)})
    return evidence


def evaluate_opportunity(
    opp: dict,
    events: list[dict],
    today: date,
    meeting_summaries: list[dict],
    calendar_events: list[dict],
    gmail_cache: dict[str, list[dict]] | None = None,
) -> list[dict]:
    """Returns the Actions this one opportunity produces (0, 1, or 2 — at most one
    from R-001/002/003/004/005, plus independently R-006). Every action carries
    the same opportunity-level `evidence` (see _build_evidence) — the per-source
    breakdown (CRM/Meeting/Email/Calendar) the "Why?" panel renders, combined
    rather than coming from whichever single event happened to trigger the rule."""
    actions = []
    value = opp.get("value")
    evidence = _build_evidence(opp, events, today, meeting_summaries, calendar_events, gmail_cache)
    calendar_note = next((e["signal"] for e in evidence if e["source"] == "Calendar"), "")
    no_meeting_booked = "No future" in calendar_note

    if opp.get("status") == "Open":
        future_event = _future_commitment_event(opp["opportunity_id"], events, today)
        expected_close = _parse_date(opp.get("expected_close"))
        has_next_action = bool(opp.get("next_action"))
        next_action_overdue = bool(
            opp.get("next_action") and (d := _parse_date(opp.get("next_action_due"))) and d < today
        )

        if future_event:
            # R-003 — buyer gave a decision date today or later; do not chase early.
            agreed_date = future_event["commitment_due"]
            is_today = _parse_date(agreed_date) == today
            follow_up = _next_business_day(_parse_date(agreed_date) or today).isoformat()
            action_text = (
                "Wait for today's scheduled decision; no need to contact the buyer first"
                if is_today
                else f"Do not contact buyer before agreed decision date ({agreed_date})"
            )
            why_now_text = (
                f"Buyer confirmed a decision is expected today; "
                f"no action needed until it happens. Follow up on {follow_up} if no decision is received."
                if is_today
                else (
                    f"Buyer confirmed an agreed decision date of {agreed_date}; "
                    f"no action needed today. Follow up on {follow_up} if no decision is received."
                )
            )
            actions.append(
                _action(
                    "R-003",
                    opp,
                    today,
                    priority="Low",
                    action=action_text,
                    # The follow-up check date, not the decision date itself —
                    # "due" is when Friday/the owner next needs to actually DO
                    # something (check back), not when the buyer's meeting
                    # happens. Pairing "due today" with "Low priority" read as
                    # contradictory when the decision date was today, since
                    # there's genuinely nothing to act on until it's missed.
                    due=follow_up,
                    status="Scheduled",
                    why_now=opp.get("suggestion_override") or why_now_text,
                    evidence=evidence,
                )
            )
        elif expected_close and expected_close < today:
            # R-002 — expected close date has genuinely passed. Strictly <,
            # not <=: a close date of exactly today still gets one more
            # chance to fall through to a more specific rule first (R-005/
            # R-001/R-004) — if there's a concrete next step on file (e.g.
            # OakBridge's "confirm with Alex whether security answers have
            # been sent"), that's more useful than this rule's generic
            # "reassess whether this deal is real" framing. Only once the
            # date has actually passed with nothing resolved does Requalify
            # become the right call.
            close_note = " No next customer meeting is booked either." if no_meeting_booked else ""
            close_phrase = "Expected close date has passed and there is no confirmed next step."
            actions.append(
                _action(
                    "R-002",
                    opp,
                    today,
                    priority="Critical",
                    action="Requalify proposal and set a new dated next step",
                    due=today.isoformat(),
                    why_now=opp.get("suggestion_override") or f"{close_phrase}{close_note} Requalify this deal today, or set a new dated next step if it's still genuinely active.",
                    notes="If inactive, move to nurture/lost rather than keep chasing.",
                    evidence=evidence,
                )
            )
        elif opp.get("revenueos_stage") in _LATE_STAGES and isinstance(value, (int, float)) and value >= _HIGH_VALUE_THRESHOLD and not has_next_action:
            # R-005 — late-stage, high-value, no decision path.
            actions.append(
                _action(
                    "R-005",
                    opp,
                    today,
                    priority="High",
                    action="Review deal strategy for a late-stage, high-value deal with no dated next step",
                    due=_next_business_day(today).isoformat(),
                    why_now=opp.get("suggestion_override") or "Late-stage, high-value proposal has no dated next action. Book a strategy review with the deal owner before this stalls at its most valuable stage.",
                    evidence=evidence,
                )
            )
        elif not has_next_action:
            # R-001 — open deal, no next action at all.
            actions.append(
                _action(
                    "R-001",
                    opp,
                    today,
                    priority="High",
                    action="Create a dated next action or requalify the deal",
                    due=_next_business_day(today).isoformat(),
                    why_now=opp.get("suggestion_override") or "Open deal has no next action on file. Set a dated next step now, or requalify the deal if it's gone cold.",
                    evidence=evidence,
                )
            )
        elif _has_pending_seller_commitment(opp["opportunity_id"], events) or opp.get("crm_source") == "hubspot" or next_action_overdue:
            # R-004 — a meeting/note commitment still needs following up on.
            # For live HubSpot-sourced deals there's no mock-data/events.json
            # row to check creates_action against — but a populated next_action
            # (HubSpot's own hs_next_step field) already means exactly that: a
            # known next step exists and hasn't been marked done. Without this,
            # a live deal with next_action set but no local "commitment event"
            # would match neither R-001 (has a next action) nor this branch
            # (no event to find), and silently produce zero actions.
            #
            # next_action_overdue covers the same gap for MOCK deals: a deal
            # can have a next_action with a next_action_due in the past, but
            # no qualifying events.json row (either no row at all, like
            # QuarryWorks, or one marked material=false because it's an
            # internal task rather than a customer-facing touchpoint, like
            # Lumina Education's workshop-booking task) — without this, an
            # 11-day-overdue commitment would silently produce zero actions
            # just because nobody logged a "material" event for it.
            meeting_note = " and propose a follow-up" if no_meeting_booked else ""
            actions.append(
                _action(
                    "R-004",
                    opp,
                    today,
                    priority="High",
                    action=f"{opp['next_action']}{meeting_note}",
                    due=_next_business_day(today).isoformat(),
                    # suggestion_override (opportunities.json, optional): a
                    # hand-written suggestion for this specific deal, used
                    # verbatim instead of the generic template below — for
                    # cases where the generic phrasing ("do {next_action}")
                    # reads worse than a suggestion written for the exact
                    # situation (e.g. naming who to confirm with first).
                    why_now=opp.get("suggestion_override") or (
                        f"A recent meeting or note created a commitment that still needs action, "
                        f"and the promised follow-up is overdue with no next meeting booked. "
                        f"{opp['next_action'][0].upper() + opp['next_action'][1:]} today and get a follow-up meeting on the calendar."
                        if no_meeting_booked
                        else (
                            f"A recent meeting or note created a commitment that still needs action. "
                            f"{opp['next_action'][0].upper() + opp['next_action'][1:]} as soon as possible."
                        )
                    ),
                    evidence=evidence,
                )
            )

    missing_fields = _missing_core_fields(opp)
    if missing_fields:
        # R-006 — important data missing; internal data-quality fix, not a customer chase.
        actions.append(
            _action(
                "R-006",
                opp,
                today,
                priority="Medium",
                action=f"Fill in missing {', '.join(missing_fields)} for this deal",
                due=_next_business_day(_next_business_day(today)).isoformat(),
                why_now=f"Missing core field(s): {', '.join(missing_fields)}. Fill these in so the Playbook can evaluate this deal correctly, since missing fields can hide a deal that actually needs attention.",
                evidence=evidence,
            )
        )

    return actions


def build_actions(opportunities: list[dict], events: list[dict], today: date | None = None) -> list[dict]:
    today = today or now().date()

    def _fetch_meeting_summaries() -> list[dict]:
        try:
            return db.list_meeting_summaries(limit=100)
        except Exception as e:
            logger.warning("Could not read meeting summaries for the playbook: %s", e)
            return []

    def _fetch_calendar_events() -> list[dict]:
        try:
            # Past 2 weeks + future 2 weeks — wide enough to catch a recently
            # completed meeting ("technical review completed") as well as
            # anything upcoming, without pulling in stale history.
            return calendar_client.fetch_meetings_window(now(), days_back=14, days_forward=14)
        except Exception as e:
            logger.warning("Could not read calendar events for the playbook: %s", e)
            return []

    def _fetch_gmail_cache() -> dict[str, list[dict]]:
        try:
            return _prefetch_gmail_evidence(opportunities)
        except Exception as e:
            logger.warning("Could not prefetch Gmail evidence for the playbook: %s", e)
            return {}

    # These three are independent of each other (gmail_cache only needs
    # `opportunities`, not meeting_summaries/calendar_events) — run them
    # concurrently rather than one after another, since each is its own
    # few-second network round trip.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        f_meetings = pool.submit(_fetch_meeting_summaries)
        f_calendar = pool.submit(_fetch_calendar_events)
        f_gmail = pool.submit(_fetch_gmail_cache)
        meeting_summaries = f_meetings.result()
        calendar_events = f_calendar.result()
        gmail_cache = f_gmail.result()

    events = events + _synthesize_commitment_events(opportunities, calendar_events, meeting_summaries)

    actions = []
    for opp in opportunities:
        actions.extend(evaluate_opportunity(opp, events, today, meeting_summaries, calendar_events, gmail_cache))
    for i, action in enumerate(actions, start=1):
        action["action_id"] = f"ACT-{i:03d}"
    return actions
