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

from datetime import date, timedelta

from .config import now

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


def _action(rule: str, opp: dict, **fields) -> dict:
    source, time_horizon = _RULE_META[rule]
    return {
        "owner": opp.get("owner"),
        "status": "Open",
        "opportunity_id": opp["opportunity_id"],
        "deal": opp.get("deal"),
        "value": opp.get("value"),
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
    """R-003's trigger: a meaningful event on this deal with an agreed FUTURE date."""
    for e in events:
        if e["opportunity_id"] != opp_id:
            continue
        due = _parse_date(e.get("commitment_due"))
        if due and due > today:
            return e
    return None


def _has_pending_seller_commitment(opp_id: str, events: list[dict]) -> bool:
    """R-004's trigger: a material event on this deal that still needs follow-up
    (creates_action True or "potentially"), i.e. a commitment nothing has closed out."""
    return any(
        e["opportunity_id"] == opp_id and e.get("material") and e.get("creates_action") in (True, "potentially")
        for e in events
    )


def _missing_core_fields(opp: dict) -> list[str]:
    """R-006's trigger: core fields the rules above depend on."""
    missing = []
    for field in ("revenueos_stage", "owner", "value"):
        if not opp.get(field):
            missing.append(field)
    return missing


def evaluate_opportunity(opp: dict, events: list[dict], today: date) -> list[dict]:
    """Returns the Actions this one opportunity produces (0, 1, or 2 — at most one
    from R-001/002/003/004/005, plus independently R-006)."""
    actions = []
    value = opp.get("value")

    if opp.get("status") == "Open":
        future_event = _future_commitment_event(opp["opportunity_id"], events, today)
        expected_close = _parse_date(opp.get("expected_close"))
        has_next_action = bool(opp.get("next_action"))

        if future_event:
            # R-003 — buyer gave a future decision date; do not chase early.
            actions.append(
                _action(
                    "R-003",
                    opp,
                    priority="Low",
                    action=f"Do not contact buyer before agreed decision date ({future_event['commitment_due']})",
                    due=future_event["commitment_due"],
                    status="Scheduled",
                    why_now=f"Buyer confirmed {future_event.get('summary', 'a decision')} for {future_event['commitment_due']}",
                )
            )
        elif expected_close and expected_close < today:
            # R-002 — expected close date has passed.
            actions.append(
                _action(
                    "R-002",
                    opp,
                    priority="Critical",
                    action="Requalify proposal and set a new dated next step",
                    due=today.isoformat(),
                    why_now="Expected close date has passed and there is no confirmed next step",
                    notes="If inactive, move to nurture/lost rather than keep chasing.",
                )
            )
        elif opp.get("revenueos_stage") in _LATE_STAGES and isinstance(value, (int, float)) and value >= _HIGH_VALUE_THRESHOLD and not has_next_action:
            # R-005 — late-stage, high-value, no decision path.
            actions.append(
                _action(
                    "R-005",
                    opp,
                    priority="High",
                    action="Review deal strategy — late-stage high-value deal has no dated next step",
                    due=_next_business_day(today).isoformat(),
                    why_now="Late-stage, high-value proposal has no dated next action",
                )
            )
        elif not has_next_action:
            # R-001 — open deal, no next action at all.
            actions.append(
                _action(
                    "R-001",
                    opp,
                    priority="High",
                    action="Create a dated next action or requalify the deal",
                    due=_next_business_day(today).isoformat(),
                    why_now="Open deal has no next action on file",
                )
            )
        elif _has_pending_seller_commitment(opp["opportunity_id"], events):
            # R-004 — a meeting/note commitment still needs following up on.
            actions.append(
                _action(
                    "R-004",
                    opp,
                    priority="High",
                    action=opp["next_action"],
                    due=_next_business_day(today).isoformat(),
                    why_now="A recent meeting or note created a commitment that still needs action",
                )
            )

    missing_fields = _missing_core_fields(opp)
    if missing_fields:
        # R-006 — important data missing; internal data-quality fix, not a customer chase.
        actions.append(
            _action(
                "R-006",
                opp,
                priority="Medium",
                action=f"Fill in missing {', '.join(missing_fields)} for this deal",
                due=_next_business_day(_next_business_day(today)).isoformat(),
                why_now=f"Missing core field(s): {', '.join(missing_fields)}",
            )
        )

    return actions


def build_actions(opportunities: list[dict], events: list[dict], today: date | None = None) -> list[dict]:
    today = today or now().date()
    actions = []
    for opp in opportunities:
        actions.extend(evaluate_opportunity(opp, events, today))
    for i, action in enumerate(actions, start=1):
        action["action_id"] = f"ACT-{i:03d}"
    return actions
