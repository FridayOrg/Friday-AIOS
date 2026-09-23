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
  POST /calendar/events — creates a real Google Calendar event directly, given
                           full details (see calendar_client.py's create_event /
                           CalendarWriteError)

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

Scheduling: when the Analyst agent has a complete scheduling request (title, date,
time), it creates the Google Calendar event directly and immediately - no draft/
confirm step. This is an explicit, deliberate exception to CLAUDE.md's default
"externally-visible actions need approval first" rule, made at the founder's own
request after being told the tradeoff (a wrong date/time/attendee goes out as a real
invite with nothing to catch it first). See _execute_schedule_proposal below.
"""

import json
import logging
import re
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


def _schedule_event(req: ScheduleEventRequest) -> dict:
    """Shared by POST /calendar/events and the agent's auto-schedule path
    (see _execute_schedule_proposal below) — the actual Google Calendar
    write, date/time parsing included. Raises ValueError for a bad date/time,
    calendar_client.CalendarWriteError for anything Google-side."""
    if not GOOGLE_CALENDAR_ID:
        raise calendar_client.CalendarWriteError("GOOGLE_CALENDAR_ID not configured; cannot create events.")

    try:
        start = datetime.strptime(f"{req.date} {req.time}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise ValueError("Invalid date/time.")
    start = start.astimezone() if now().tzinfo is None else start.replace(tzinfo=now().tzinfo)
    end = start + timedelta(minutes=req.duration_minutes)

    result = calendar_client.create_event(
        calendar_id=GOOGLE_CALENDAR_ID,
        title=req.title,
        start_iso=start.isoformat(),
        end_iso=end.isoformat(),
        attendees=req.attendees,
        description=req.notes,
    )
    return {"start": start, **result}


@app.post("/calendar/events")
def create_calendar_event(req: ScheduleEventRequest):
    """Creates a real Google Calendar event directly (used by any external
    caller that already has full details - not exercised by Ask Friday's own
    chat flow, which schedules inline via _execute_schedule_proposal)."""
    try:
        result = _schedule_event(req)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date/time.")
    except calendar_client.CalendarWriteError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return {"status": "ok", "id": result["id"], "html_link": result["html_link"]}


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


_SCHEDULE_PROPOSAL_RE = re.compile(r"```schedule-proposal\s*\n(.*?)\n```", re.DOTALL)


def _friendly_when(start: datetime) -> str:
    # %-I isn't portable to Windows' strftime; build it manually instead.
    hour12 = start.hour % 12 or 12
    minute = f"{start.minute:02d}"
    period = "AM" if start.hour < 12 else "PM"
    return f"{start.strftime('%a, %d %b %Y')} at {hour12}:{minute} {period}"


def _execute_schedule_proposal(answer: str) -> str | None:
    """If `answer` contains a complete schedule-proposal block (see
    ANALYST_HEADER in context_loader.py), creates the real Google Calendar
    event right away and returns a deterministic confirmation string to show
    the user in its place. Returns None if there's no block to act on, so
    the caller knows to leave `answer` untouched.

    This is the founder's own explicit choice: schedule immediately, no
    draft/confirm step (see main.py's module docstring). The confirmation
    text is generated here, not by the LLM, so it's always accurate to what
    actually got created rather than whatever the model happened to write."""
    match = _SCHEDULE_PROPOSAL_RE.search(answer)
    if not match:
        return None

    try:
        data = json.loads(match.group(1))
        req = ScheduleEventRequest(**data)
    except Exception as e:
        logger.warning("Could not parse the agent's schedule-proposal block: %s", e)
        return None

    try:
        result = _schedule_event(req)
    except ValueError:
        return f"I couldn't schedule **{req.title}** — the date/time wasn't valid. Could you try again?"
    except calendar_client.CalendarWriteError as e:
        return f"I tried to schedule **{req.title}** but it didn't go through: {e}"

    when = _friendly_when(result["start"])
    attendee_note = f" with {', '.join(req.attendees)}" if req.attendees else ""
    return (
        f"✅ Meeting scheduled: **{req.title}**, {when} ({req.duration_minutes} min){attendee_note}. "
        f"[View on Google Calendar]({result['html_link']})"
    )


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

    auto = _execute_schedule_proposal(answer)
    if auto is not None:
        answer = auto
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
        full = ""
        withheld: list[str] = []
        # A schedule-proposal reply is ONLY a bare fenced block (see
        # ANALYST_HEADER) - nothing else in this app streams a reply that
        # opens with a code fence, so that's a safe signal to stop
        # forwarding chunks live and wait for the whole thing, rather than
        # ever showing the user raw JSON mid-stream.
        withholding = False
        try:
            for chunk in ask_friday_stream(system_prompt, question, history=history):
                full += chunk
                if not withholding and full.lstrip().startswith("```"):
                    withholding = True
                if withholding:
                    withheld.append(chunk)
                else:
                    yield f"data: {json.dumps({'delta': chunk})}\n\n"

            if withholding:
                auto = _execute_schedule_proposal(full)
                if auto is not None:
                    yield f"data: {json.dumps({'delta': auto})}\n\n"
                else:
                    for w in withheld:
                        yield f"data: {json.dumps({'delta': w})}\n\n"
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
