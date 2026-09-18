"""Relevance filtering for Industry Updates — ONE Gemini call for the whole
batch (not one call per item) judging which fetched news items are genuinely
significant vs. noise/duplicate coverage of the same story. Batched
deliberately: classifying items one-at-a-time blows through the free-tier
rate limit (15 requests/minute) — observed directly while building the Gmail
urgency feature, same lesson applies here. Reuses the existing classifier
client from llm_client.py rather than adding a third Gemini key for this.

A parsing/classifier failure for the whole batch just returns no relevant
items (fails safe) rather than raising.
"""

import logging
import re

from google import genai

from .config import MODEL
from .llm_client import get_classifier_client

logger = logging.getLogger(__name__)

_PROMPT_TEMPLATE = """You are triaging a list of tech-industry news items to decide
which ones are genuinely significant enough for a founder/CEO to see on their
dashboard — not routine PR, minor product tweaks, or duplicate coverage of the
same story repeated across sources.

For each item, answer "yes" only if it is a substantive development: a major
product launch, an acquisition, a significant policy/leadership change, a
notable AI capability release, or something with real competitive/strategic
relevance. Answer "no" for: minor blog posts, routine marketing, opinion
pieces, or a story that's just re-reporting something already well-known.

{item_blocks}

Respond with EXACTLY one line per item above, in the same order, in this
exact format and nothing else:
<number>: yes|<reason under 12 words>
<number>: no|<reason under 12 words>
"""


def _build_item_blocks(items: list[dict]) -> str:
    blocks = []
    for i, item in enumerate(items, start=1):
        blocks.append(
            f"ITEM {i}\n"
            f"Title: {item.get('title', '')}\n"
            f"Topic: {item.get('topic', '')}\n"
            f"Content: {item.get('content', '')[:300]}"
        )
    return "\n\n".join(blocks)


_RESULT_LINE_RE = re.compile(r"^\s*(\d+)\s*:\s*(yes|no)\s*\|\s*(.*)$", re.IGNORECASE)


def classify_updates(items: list[dict]) -> list[dict]:
    """Filters `items` down to only those judged genuinely significant, each
    annotated with a `relevance_reason` field. One Gemini call for the whole
    list; any failure (rate limit, bad response, parsing mismatch) returns an
    empty list rather than guessing."""
    if not items:
        return []

    prompt = _PROMPT_TEMPLATE.format(item_blocks=_build_item_blocks(items))

    try:
        client = get_classifier_client()
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0, max_output_tokens=60 * len(items)
            ),
        )
    except Exception as e:  # noqa: BLE001 - a classifier hiccup fails the whole batch safely
        logger.warning("Industry-update relevance classification failed for this batch: %s", e)
        return []

    results_by_index: dict[int, tuple[bool, str]] = {}
    for line in (response.text or "").strip().splitlines():
        m = _RESULT_LINE_RE.match(line)
        if not m:
            continue
        index, verdict, reason = int(m.group(1)), m.group(2).lower(), m.group(3).strip()
        results_by_index[index] = (verdict == "yes", reason)

    relevant = []
    for i, item in enumerate(items, start=1):
        is_relevant, reason = results_by_index.get(i, (False, ""))
        if is_relevant:
            relevant.append({**item, "relevance_reason": reason})
    return relevant
