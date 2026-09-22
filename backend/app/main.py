"""
Friday backend — FastAPI app.

Endpoints:
  GET  /health         — liveness check
  POST /ask            — ask Friday any question; routed to one of two agents below
  POST /ask/stream     — same as /ask, but streams the answer as it's generated (SSE)
  GET  /daily-brief     — fixed "what needs my attention today" briefing
  GET  /calendar        — live meetings for the current week (see calendar_client.py),
                           in the same shape mock-data/calendar.json used to provide;
                           the frontend calls this instead of reading that file directly
  POST /webhooks/fathom  — Fathom's "new-meeting-content-ready" event; verifies the
                           signature, stores the meeting summary (see db.py)
  GET  /meeting-summaries — stored Fathom meeting summaries, most recent first
  POST /meeting-summaries/refresh — backfill/refresh via Fathom's REST API directly
                           (see fathom_client.py), separate from the webhook path
  GET  /gmail/urgent    — cached list of inbox emails judged to need an immediate
                           reply (see gmail_client.py / email_urgency.py)
  POST /gmail/refresh    — forces a fresh Gmail fetch + urgency-classification pass
  GET  /industry-updates — today's stored, LLM-filtered industry news (see
                           industry_client.py / industry_relevance.py)
  POST /industry-updates/refresh — fetches from Tavily + classifies + stores;
                           guarded by INDUSTRY_UPDATES_REFRESH_SECRET since a
                           scheduled GitHub Actions cron calls this, not a user
  GET  /crm/overview    — CEO CRM dashboard data sourced live from Pipedrive
                           (deals, pipeline, activities, contacts, risks, charts);
                           see pipedrive_client.py / crm_metrics.py
  POST /calendar/events — creates a real Google Calendar event. Only ever called
                           after a human explicitly confirms a proposal the Analyst
                           agent drafted in Ask Friday (see calendar_client.py's
                           create_event / CalendarWriteError) — the only write/
                           action endpoint in this API, per CLAUDE.md's Action/
                           Autonomy Model (explicit approval required)

Two agents behind the one chat interface, picked automatically per message by a
cheap intent-classifier call (llm_client.classify_intent) — the user never has to
choose:
  - Daily Update: schedule/task/pipeline/revenue status lookups. Smaller prompt
    (mock-data only), always crisp bullets.
  - Analyst/Advisor: reasoning, recommendations, "why"/"should I" questions. Full
    context (company docs + mock data), allowed to go deeper when asked.
This is prompt-routing, not autonomous tool-calling agents — both still just read
the same context-stuffed prompt and respond; see backend/app/context_loader.py for
why (and when moving to real tool-calling will make sense: once mock-data files are
replaced by live connectors).

Every endpoint except one only reads, analyzes, and recommends, per CLAUDE.md's Action/
Autonomy Model. The sole exception, POST /calendar/events, is a real external write
(creates a Google Calendar event) — but it is never invoked automatically; it only ever
fires after a human explicitly confirms a proposal the Analyst agent drafted, matching
that same model's "Send / update ... requires explicit user approval" rule.
"""

import json
import logging
from datetime import datetime, timedelta

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import calendar_client, crm_metrics, db, fathom_client, gmail_client, industry_client
from .config import GOOGLE_CALENDAR_ID, INDUSTRY_UPDATES_REFRESH_SECRET, now
from .industry_relevance import classify_updates
from .context_loader import (
    DAILY_BRIEF_PROMPT,
    build_analyst_system_prompt,
    build_daily_system_prompt,
    build_system_prompt,
)
from .llm_client import ask_friday, ask_friday_stream, classify_intent
from .voice import synthesize_stream

logger = logging.getLogger(__name__)


class ChatTurn(BaseModel):
    role: str  # "user" or "friday"
    text: str

app = FastAPI(title="Friday API", version="0.1.0")

# Permissive CORS for local MVP development only (frontend runs on a different port).
# Tighten this before any real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AskRequest(BaseModel):
    question: str
    # Prior turns of the conversation, sent by the frontend's own in-memory chat
    # state (no DB yet). Optional so /ask keeps working for one-off callers that
    # don't send any.
    history: list[ChatTurn] | None = None


class AskResponse(BaseModel):
    answer: str
    agent: str


def _route(question: str, history: list[dict] | None) -> tuple[str, str]:
    """Returns (agent_name, system_prompt) for a question."""
    agent = classify_intent(question, history)
    system_prompt = build_daily_system_prompt() if agent == "daily" else build_analyst_system_prompt()
    return agent, system_prompt


@app.on_event("startup")
def _init_db():
    """Creates the meeting_summaries table if needed. DATABASE_URL missing/bad
    just logs a warning — Fathom integration degrades to "no summaries stored"
    rather than blocking the rest of the app (calendar, chat, etc.) from starting."""
    try:
        db.init_db()
    except Exception as e:
        logger.warning("Could not initialize the database: %s", e)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/calendar")
def calendar():
    return calendar_client.fetch_calendar_document(now())


class ScheduleEventRequest(BaseModel):
    title: str
    date: str  # "YYYY-MM-DD"
    time: str  # "HH:MM", 24h
    duration_minutes: int = 30
    attendees: list[str] | None = None
    notes: str | None = None


@app.post("/calendar/events")
def create_calendar_event(req: ScheduleEventRequest):
    """Creates a real Google Calendar event. Only ever meant to be called after
    a human explicitly confirms a proposal Ask Friday drafted (see
    ANALYST_HEADER in context_loader.py and the frontend's schedule-proposal
    card) — nothing upstream of this endpoint invokes it automatically. Per
    CLAUDE.md's Action/Autonomy Model, an externally-visible write like this
    always requires that explicit approval step before it happens."""
    if not GOOGLE_CALENDAR_ID:
        raise HTTPException(status_code=503, detail="GOOGLE_CALENDAR_ID not configured; cannot create events.")

    try:
        start = datetime.strptime(f"{req.date} {req.time}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date/time.")
    start = start.astimezone() if now().tzinfo is None else start.replace(tzinfo=now().tzinfo)
    end = start + timedelta(minutes=req.duration_minutes)

    try:
        result = calendar_client.create_event(
            calendar_id=GOOGLE_CALENDAR_ID,
            title=req.title,
            start_iso=start.isoformat(),
            end_iso=end.isoformat(),
            attendees=req.attendees,
            description=req.notes,
        )
    except calendar_client.CalendarWriteError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return {"status": "ok", **result}


@app.post("/webhooks/fathom")
async def fathom_webhook(request: Request):
    """Fathom's "new-meeting-content-ready" event. Verifies the Svix-style
    signature before trusting anything in the payload; a malformed body, an
    unusable payload (no recording_id), or a storage failure all return a
    response Fathom won't endlessly retry, rather than a 5xx it retries."""
    raw_body = await request.body()
    webhook_id = request.headers.get("webhook-id", "")
    timestamp = request.headers.get("webhook-timestamp", "")
    signature = request.headers.get("webhook-signature", "")

    if not fathom_client.verify_webhook_signature(webhook_id, timestamp, raw_body, signature):
        raise HTTPException(status_code=401, detail="invalid webhook signature")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="malformed JSON payload")

    meeting = fathom_client.parse_webhook_payload(payload)
    if meeting is None:
        logger.warning("Fathom webhook payload had no usable meeting data.")
        return {"status": "ignored"}

    try:
        db.upsert_meeting_summary(meeting)
    except Exception as e:
        logger.warning("Failed to store Fathom meeting summary: %s", e)
        raise HTTPException(status_code=502, detail="failed to store meeting summary")

    # recording_id is the de-dup key (see db.upsert_meeting_summary's ON CONFLICT),
    # so Fathom retrying the same event just re-applies the same row harmlessly.
    return {"status": "ok"}


@app.get("/meeting-summaries")
def meeting_summaries():
    try:
        return {"meetings": db.list_meeting_summaries()}
    except Exception as e:
        logger.warning("Could not read meeting summaries: %s", e)
        return {"meetings": []}


@app.post("/meeting-summaries/refresh")
def refresh_meeting_summaries():
    """Backfill/manual refresh via Fathom's REST API directly — separate from
    the webhook path. Always 200s with a count; per-meeting storage failures
    are logged and skipped rather than failing the whole refresh."""
    meetings = fathom_client.list_meetings(limit=50)
    stored = 0
    for m in meetings:
        try:
            db.upsert_meeting_summary(m)
            stored += 1
        except Exception as e:
            logger.warning("Failed to store meeting %s: %s", m.get("recording_id"), e)
    return {"status": "ok", "fetched": len(meetings), "stored": stored}


@app.get("/gmail/urgent")
def gmail_urgent():
    try:
        return {"emails": gmail_client.get_cached_urgent_emails()}
    except Exception as e:
        logger.warning("Could not read urgent emails: %s", e)
        return {"emails": []}


@app.post("/gmail/refresh")
def gmail_refresh():
    """Forces a fresh Gmail fetch + urgency-classification pass, bypassing the
    cache (see gmail_client.py)."""
    emails = gmail_client.refresh_urgent_emails()
    return {"status": "ok", "count": len(emails)}


@app.get("/industry-updates")
def industry_updates():
    try:
        day_start, day_end = industry_client.day_bounds(now())
        return {"updates": db.list_industry_updates(day_start, day_end)}
    except Exception as e:
        logger.warning("Could not read industry updates: %s", e)
        return {"updates": []}


@app.post("/industry-updates/refresh")
def refresh_industry_updates(request: Request):
    """Fetches from Tavily, LLM-filters for relevance, and stores the result —
    called by a scheduled GitHub Actions cron rather than a user, hence the
    shared-secret header check (this write endpoint has no other auth)."""
    secret = request.headers.get("x-refresh-secret", "")
    if not INDUSTRY_UPDATES_REFRESH_SECRET or secret != INDUSTRY_UPDATES_REFRESH_SECRET:
        raise HTTPException(status_code=401, detail="invalid or missing refresh secret")

    today = now().date()
    raw_items = industry_client.fetch_todays_updates(today)
    relevant = classify_updates(raw_items)

    stored = 0
    for item in relevant:
        try:
            db.upsert_industry_update(item)
            stored += 1
        except Exception as e:
            logger.warning("Failed to store industry update %s: %s", item.get("url"), e)

    return {"status": "ok", "fetched": len(raw_items), "relevant": len(relevant), "stored": stored}


@app.get("/crm/overview")
def crm_overview(
    range: str = "month",
    start: str | None = None,
    end: str | None = None,
    trend_period: str = "30d",
):
    """range: today|week|month|quarter|year|custom (custom requires start/end
    as YYYY-MM-DD). trend_period (for the revenue trend chart only):
    7d|30d|90d|quarter|year. See crm_metrics.build_overview for exactly how
    each field is derived from Pipedrive."""
    try:
        return crm_metrics.build_overview(range, start, end, trend_period, now().date())
    except Exception as e:
        logger.warning("Could not build CRM overview: %s", e)
        return {"configured": crm_metrics.pd.is_configured(), "message": "Failed to build CRM overview.", "error": str(e)}


@app.post("/ask", response_model=AskResponse)
def ask(payload: AskRequest):
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question must not be empty")

    history = [t.model_dump() for t in payload.history] if payload.history else None
    agent, system_prompt = _route(question, history)
    try:
        answer = ask_friday(system_prompt, question, history=history)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")
    return AskResponse(answer=answer, agent=agent)


@app.post("/ask/stream")
def ask_stream(payload: AskRequest):
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question must not be empty")

    history = [t.model_dump() for t in payload.history] if payload.history else None

    def event_stream():
        agent, system_prompt = _route(question, history)
        yield f"data: {json.dumps({'agent': agent})}\n\n"
        try:
            for chunk in ask_friday_stream(system_prompt, question, history=history):
                yield f"data: {json.dumps({'delta': chunk})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': f'LLM call failed: {e}'})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class SpeakRequest(BaseModel):
    text: str


@app.post("/speak")
async def speak(payload: SpeakRequest):
    """Text -> spoken MP3 (ElevenLabs), streamed. The frontend sends one sentence at a
    time as a reply generates and plays the clips back-to-back, so speech starts a
    sentence or two in rather than after the whole answer. Key stays server-side."""
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text must not be empty")

    chunks = synthesize_stream(text)
    try:
        first = await chunks.__anext__()  # forces auth/quota errors out before streaming
    except RuntimeError as e:  # no key configured
        raise HTTPException(status_code=503, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"TTS provider error: {str(e)[:200]}")
    except StopAsyncIteration:
        first = b""
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}")

    async def body():
        yield first
        async for c in chunks:
            yield c

    return StreamingResponse(body(), media_type="audio/mpeg")


@app.get("/daily-brief", response_model=AskResponse)
def daily_brief():
    system_prompt = build_system_prompt()  # alias for build_analyst_system_prompt
    try:
        answer = ask_friday(system_prompt, DAILY_BRIEF_PROMPT)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")
    return AskResponse(answer=answer, agent="analyst")
