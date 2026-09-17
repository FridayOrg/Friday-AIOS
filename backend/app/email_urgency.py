"""Urgency classification for Gmail messages — ONE Gemini call for the whole
batch (not one call per email) judging which genuinely need an IMMEDIATE
reply (a direct question, a deadline, explicit time-sensitivity) versus
something that can wait (newsletters, notifications, FYI threads). Batched
deliberately: classifying up to 20 emails one-at-a-time blows straight
through the free-tier rate limit (15 requests/minute) in a single refresh —
observed directly while testing this feature. Reuses the existing classifier
client from llm_client.py rather than adding a third Gemini key for this.

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

_PROMPT_TEMPLATE = """You are triaging a list of emails to decide which ones genuinely
need an IMMEDIATE reply from the recipient today — not just "nice to eventually read."

For each email, answer "yes" only if it does at least one of these:
- Asks a direct question the recipient must personally answer
- States or implies a deadline that is soon or already passed
- Is clearly time-sensitive (e.g. "need this today", "urgent", a same-day request)
- Explicitly asks for a decision, approval, or confirmation from the recipient

Answer "no" for: newsletters, marketing, automated notifications, FYI-only
threads, receipts, social notifications, or anything that can wait days
without consequence.

{email_blocks}

Respond with EXACTLY one line per email above, in the same order, in this
exact format and nothing else:
<number>: yes|<reason under 12 words>
<number>: no|<reason under 12 words>
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


_RESULT_LINE_RE = re.compile(r"^\s*(\d+)\s*:\s*(yes|no)\s*\|\s*(.*)$", re.IGNORECASE)


def classify_emails(emails: list[dict]) -> list[dict]:
    """Filters `emails` down to only those judged as needing an immediate
    reply, each annotated with a `reason` field explaining why. One Gemini
    call for the whole list; any failure (rate limit, bad response, parsing
    mismatch) returns an empty list rather than guessing."""
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

    results_by_index: dict[int, tuple[bool, str]] = {}
    for line in (response.text or "").strip().splitlines():
        m = _RESULT_LINE_RE.match(line)
        if not m:
            continue
        index, verdict, reason = int(m.group(1)), m.group(2).lower(), m.group(3).strip()
        results_by_index[index] = (verdict == "yes", reason)

    urgent = []
    for i, email in enumerate(emails, start=1):
        needs_reply, reason = results_by_index.get(i, (False, ""))
        if needs_reply:
            urgent.append({**email, "reason": reason})
    return urgent
