"""Shared paths and settings for Friday's backend. Single source of truth so the CLI
prototype and the FastAPI app never disagree about where context lives or which model
to call."""

import json
import os
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]  # c:\AIOS
CONTEXT_DIR = ROOT_DIR / "context"
MOCK_DATA_DIR = ROOT_DIR / "mock-data"

load_dotenv(ROOT_DIR / ".env")

# Real current date & time. The app runs on the real system clock now — no pinned
# "today" file. Optional FRIDAY_TZ (e.g. "Asia/Kolkata") pins the timezone so the
# backend and frontend agree regardless of where the server runs; unset = server
# local time. The frontend derives the same values in frontend/lib/paths.ts.
_TZ_NAME = os.environ.get("FRIDAY_TZ")
_TZ = None
if _TZ_NAME:
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo(_TZ_NAME)

# The mock-data files were authored around this anchor date. Both sides slide every
# date in the mock data forward by (real today - anchor) days so "this week",
# "overdue" and "upcoming" stay correct as real time moves. See mock-data/today.json.
ANCHOR = json.loads((MOCK_DATA_DIR / "today.json").read_text(encoding="utf-8"))["anchor"]
_ANCHOR_DATE = date.fromisoformat(ANCHOR)


def now() -> datetime:
    """Real current datetime, recomputed on every call so a long-running server never
    serves a stale clock. Honours FRIDAY_TZ when set."""
    return datetime.now(_TZ) if _TZ else datetime.now()


def shift_days() -> int:
    """Days to slide the frozen mock data forward so it lines up with the real today."""
    return (now().date() - _ANCHOR_DATE).days


# Import-time snapshot — convenient for the prototype CLI / test scripts and any
# caller that just wants a value. Request-serving code should call now() / shift_days()
# instead so the clock stays fresh.
NOW = now()
TODAY = NOW.date().isoformat()
SHIFT_DAYS = shift_days()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# Text-to-speech (ElevenLabs). Key lives only here / in .env — the backend proxies
# every TTS call so it never reaches frontend code. Voice + model are overridable
# from .env without touching code: any voice id from the ElevenLabs voice library,
# and e.g. "eleven_flash_v2_5" (fastest/cheapest) or "eleven_multilingual_v2" (richest).
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # "Rachel"
ELEVENLABS_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_turbo_v2_5")

# Separate key (different account) used only for the intent classifier call that
# routes each message to the Daily Update or Analyst/Advisor agent. Isolates the
# classifier's quota from the main answer-generation calls so a burst of chat
# traffic can't make routing compete with actual answers on the same quota bucket.
# Falls back to the main key if a second one isn't provided.
GEMINI_CLASSIFIER_API_KEY = os.environ.get("GEMINI_CLASSIFIER_API_KEY") or GEMINI_API_KEY

# See backend/prototype/friday_cli.py for the history of why this specific model:
# gemini-3.6-flash hits a hard 20 requests/day free-tier wall; gemini-3.1-flash-lite
# handles rapid full-context calls without that daily lockout. Also used for the
# classifier call (via the separate key above) — it's already the "cheap and fast"
# tier, so no need for a different model there.
MODEL = "gemini-3.1-flash-lite"
