"""Fathom (fathom.video) meeting-notes integration: verifies + parses incoming
webhooks ("new-meeting-content-ready") and can call Fathom's REST API directly
for backfilling past meetings or a manual refresh — separate from the webhook
path. See https://developers.fathom.ai/webhooks and .../api-reference.

Signature verification follows Fathom's documented Svix-style scheme: headers
webhook-id / webhook-timestamp / webhook-signature; secret shown in Fathom's
dashboard as "whsec_<base64>"; HMAC-SHA256 over "{id}.{timestamp}.{raw_body}",
compared (constant-time) against each space-separated "v1,<base64 sig>" entry
in webhook-signature, with a 5-minute replay tolerance.

Fathom's exact webhook JSON body wasn't independently verifiable while building
this (their docs page rendered an empty example) — _extract_meeting() maps from
their documented `Meeting` schema field names, checked against a real payload
via Fathom's "Send Test Payload" button before this goes live.
"""

import base64
import hashlib
import hmac
import logging
import time

import httpx

from .config import FATHOM_API_KEY, FATHOM_WEBHOOK_SECRET

logger = logging.getLogger(__name__)

_API_BASE = "https://api.fathom.ai/external/v1"
_REPLAY_TOLERANCE_SECONDS = 5 * 60
_TIMEOUT_SECONDS = 15


def verify_webhook_signature(webhook_id: str, timestamp: str, raw_body: bytes, signature_header: str) -> bool:
    """True iff the webhook's signature checks out against FATHOM_WEBHOOK_SECRET.
    Never raises — any malformed input (bad timestamp, bad secret encoding, a
    missing header) just fails verification rather than crashing the endpoint."""
    if not FATHOM_WEBHOOK_SECRET:
        logger.warning("FATHOM_WEBHOOK_SECRET not set; rejecting webhook (cannot verify).")
        return False
    if not (webhook_id and timestamp and signature_header):
        logger.warning("Fathom webhook missing required signature headers; rejecting.")
        return False

    try:
        if abs(time.time() - int(timestamp)) > _REPLAY_TOLERANCE_SECONDS:
            logger.warning("Fathom webhook timestamp outside the replay-tolerance window; rejecting.")
            return False

        secret = FATHOM_WEBHOOK_SECRET
        if secret.startswith("whsec_"):
            secret = secret[len("whsec_"):]
        secret_bytes = base64.b64decode(secret)

        signed_content = f"{webhook_id}.{timestamp}.".encode() + raw_body
        expected = base64.b64encode(
            hmac.new(secret_bytes, signed_content, hashlib.sha256).digest()
        ).decode()

        for entry in signature_header.split():
            _, _, candidate = entry.partition(",")  # each entry: "v1,<base64signature>"
            if candidate and hmac.compare_digest(candidate, expected):
                return True
        return False
    except Exception as e:  # noqa: BLE001 - any parsing failure just fails verification
        logger.warning("Fathom webhook signature check failed: %s", e)
        return False


def _extract_meeting(raw: dict) -> dict | None:
    """Maps a Fathom Meeting object (from a webhook payload or the REST API's
    /meetings response) to the shape db.py stores. Returns None if there's no
    usable recording_id — nothing to key storage on, so the caller should skip
    it rather than store a row it can never de-duplicate or update later."""
    recording_id = raw.get("recording_id") or raw.get("id")
    if not recording_id:
        return None

    title = raw.get("title") or raw.get("meeting_title") or "(untitled meeting)"
    # Prefer Fathom's own recording page (share_url/url) over meeting_url, which is
    # just the original Zoom/Meet call link — not the recording, and often dead
    # once the live call has ended. "Watch full meeting" should open the recording.
    meeting_url = raw.get("share_url") or raw.get("url") or raw.get("meeting_url")
    started_at = raw.get("recording_start_time") or raw.get("scheduled_start_time")

    invitees = raw.get("calendar_invitees") or []
    participants = [
        name_or_email
        for i in invitees
        if isinstance(i, dict) and (name_or_email := (i.get("name") or i.get("email")))
    ]

    summary = raw.get("default_summary")
    summary_markdown = summary.get("markdown_formatted") if isinstance(summary, dict) else None

    # Fathom's ActionItem schema (per developers.fathom.ai's OpenAPI spec):
    # description, user_generated, completed, recording_timestamp,
    # recording_playback_url, and an assignee {name, email, team} — there is
    # NO due-date/deadline field at all. owner/owner_email below are real,
    # sourced data; due_date is deliberately never set here — it's the CEO's
    # own manually-tracked field (see db.py's update_action_item_due_date),
    # never fabricated from anything Fathom provides.
    action_items = []
    for a in raw.get("action_items") or []:
        if not a:
            continue
        if isinstance(a, dict):
            text = a.get("description") or a.get("text")
            if not text:
                continue
            assignee = a.get("assignee") if isinstance(a.get("assignee"), dict) else {}
            action_items.append({
                "text": text,
                "owner": assignee.get("name"),
                "owner_email": assignee.get("email"),
            })
        else:
            action_items.append({"text": str(a), "owner": None, "owner_email": None})

    return {
        "recording_id": str(recording_id),
        "title": title,
        "meeting_url": meeting_url,
        "started_at": started_at,
        "participants": participants,
        "summary_markdown": summary_markdown,
        "action_items": action_items,
    }


def parse_webhook_payload(payload: dict) -> dict | None:
    """Same mapping as the REST API path — Fathom's webhook payload uses the
    same Meeting schema as /meetings. Returns None for a malformed/empty
    payload or one with no usable recording_id; the caller treats that as
    "nothing to store," not an error."""
    if not isinstance(payload, dict):
        return None
    return _extract_meeting(payload)


def list_meetings(limit: int = 20, **params) -> list[dict]:
    """Calls Fathom's GET /meetings directly — for backfilling past meetings or
    a manual refresh, separate from the webhook path. Empty list (never an
    exception) on any failure: missing key, unreachable, or a bad response."""
    if not FATHOM_API_KEY:
        logger.warning("FATHOM_API_KEY not set; cannot list meetings from Fathom.")
        return []

    try:
        response = httpx.get(
            f"{_API_BASE}/meetings",
            headers={"X-Api-Key": FATHOM_API_KEY},
            params={
                "include_summary": "true",
                "include_action_items": "true",
                **params,
            },
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.warning(
            "Fathom API error %s: %s", e.response.status_code, e.response.text[:200]
        )
        return []
    except httpx.HTTPError as e:
        logger.warning("Fathom API unreachable: %s", e)
        return []

    items = response.json().get("items", [])
    meetings = [m for m in (_extract_meeting(item) for item in items) if m is not None]
    return meetings[:limit]
