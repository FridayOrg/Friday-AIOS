"""Urgency classification for Gmail messages — ONE Gemini call for the whole
batch (not one call per email) judging which genuinely need attention today
(a direct question, a deadline, explicit time-sensitivity) versus something
that can wait (newsletters, notifications, FYI threads), and ranking those
into a priority tier (see PRIORITY_TIERS) so they can sit in the same
overdue/high/important-first list as tasks.json's own tasks (see
UrgentEmails.tsx on the frontend, which merges both into one ranked list).
Batched deliberately: classifying up to 20 emails one-at-a-time blows
straight through the free-tier rate limit (15 requests/minute) in a single
refresh — observed directly while testing this feature. Reuses the existing
classifier client from llm_client.py rather than adding a third Gemini key
for this.

A parsing/classifier failure for the whole batch just returns no urgent
emails (fails safe — worst case nothing shows until the next refresh, never
wrongly shown) rather than raising.
"""

import logging
import re

from google import genai

from .config import MODEL
from .llm_client import get_classifier_client

logger = logging.getLogger(__name__)

# Same three tiers tasks.json's tasks are ranked by (overdue > high priority
# > everything else) — see UrgentEmails.tsx's TIER_RANK, which sorts emails
# and tasks together by this shared ordering. "important" is the catch-all
# for anything that clears the urgency bar but isn't overdue or explicitly
# high-priority.
PRIORITY_TIERS = ("overdue", "high", "important")

_PROMPT_TEMPLATE = """You are triaging a list of emails to decide which ones genuinely
need attention from the recipient today — not just "nice to eventually read" — and how
urgent each one is.

HARD FILTER — apply this before anything else: automated system/account notifications
(sign-in alerts, "new device" notices, password-reset confirmations, CI/CD or workflow
run results, uptime/monitoring alerts, and similar auto-generated messages) are "none"
UNLESS the email itself explicitly asks the recipient to take an action because something
is wrong (e.g. "we detected suspicious activity, please secure your account now" - not
just "here's a routine heads-up, no action needed if this was you"). A CI/workflow failure
notification is "none" too - that's an engineering concern, not something the recipient
(a CEO/founder) needs to personally act on.

For each email that passes the hard filter, pick exactly one tier:
- "overdue": a deadline has clearly already passed, or it's an explicit follow-up/reminder
  about something still outstanding (e.g. "following up again", "still waiting on this",
  "this was due").
- "high": asks a direct question the recipient must personally answer, explicitly asks for
  a decision/approval/confirmation, or states a deadline that is today or very soon.
- "important": doesn't rise to "overdue" or "high", but is still clearly time-sensitive or
  worth a reply today (not just FYI).
- "none": newsletters, marketing, automated notifications, FYI-only threads, receipts,
  social notifications, or anything that can wait days without consequence.

{email_blocks}

Respond with EXACTLY one line per email above, in the same order, in this
exact format and nothing else:
<number>: overdue|<reason under 12 words>
<number>: high|<reason under 12 words>
<number>: important|<reason under 12 words>
<number>: none|<reason under 12 words>
"""


def _build_email_blocks(emails: list[dict]) -> str:
    blocks = []
    for i, email in enumerate(emails, start=1):
        blocks.append(
            f"EMAIL {i}\n"
            f"Subject: {email.get('subject', '')}\n"
            f"From: {email.get('sender', '')}\n"
            f"Preview: {email.get('snippet', '')}"
        )
    return "\n\n".join(blocks)


_RESULT_LINE_RE = re.compile(r"^\s*(\d+)\s*:\s*(overdue|high|important|none)\s*\|\s*(.*)$", re.IGNORECASE)


def classify_emails(emails: list[dict]) -> list[dict]:
    """Filters `emails` down to only those judged as needing attention today,
    each annotated with `priority` (one of PRIORITY_TIERS) and a `reason`
    field explaining why. One Gemini call for the whole list; any failure
    (rate limit, bad response, parsing mismatch) returns an empty list rather
    than guessing."""
    if not emails:
        return []

    prompt = _PROMPT_TEMPLATE.format(email_blocks=_build_email_blocks(emails))

    try:
        client = get_classifier_client()
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0, max_output_tokens=60 * len(emails)
            ),
        )
    except Exception as e:  # noqa: BLE001 - a classifier hiccup fails the whole batch safely
        logger.warning("Urgency classification failed for this batch: %s", e)
        return []

    results_by_index: dict[int, tuple[str | None, str]] = {}
    for line in (response.text or "").strip().splitlines():
        m = _RESULT_LINE_RE.match(line)
        if not m:
            continue
        index, tier, reason = int(m.group(1)), m.group(2).lower(), m.group(3).strip()
        results_by_index[index] = (tier if tier in PRIORITY_TIERS else None, reason)

    urgent = []
    for i, email in enumerate(emails, start=1):
        tier, reason = results_by_index.get(i, (None, ""))
        if tier is not None:
            urgent.append({**email, "priority": tier, "reason": reason})
    return urgent
