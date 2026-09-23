"""Loads company context (context/*.md), mock operational data (mock-data/*.json),
and live connector data (Google Calendar, Pipedrive CRM, Fathom meeting summaries,
Industry Updates, Gmail urgent emails, Goals from strategy.md) into system prompts
for Friday's two agents: Daily Update and Analyst/Advisor. See _live_data_blob()
below for the live sources; each is fetched fresh per request and fails safe
(returns empty/"unavailable" rather than raising) so one connector being down never
breaks the prompt for the rest.

Deliberately no chunking, embeddings, or vector store — stuffing it all into one
prompt every time is simpler and good enough for the MVP. Revisit (tool-calling
instead of context-stuffing) once the combined prompt genuinely outgrows a single
context window as more live connectors get added, or once the mock-data files
(tasks/revenue/pipeline/spend) also get replaced by live sources.

The system prompt is assembled fresh on every request (file contents are cached, but
the date/time header and the mock-data date-shift are recomputed) so a long-running
server always reasons against the real current clock — see config.now().
"""

import json
import logging
import re
from datetime import date, timedelta
from functools import lru_cache

from . import calendar_client, crm_metrics, db, gmail_client, industry_client
from .config import CONTEXT_DIR, MOCK_DATA_DIR, now, shift_days
from .timeline import schedule_digest

logger = logging.getLogger(__name__)

_ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def _shift_iso_dates(text: str, days: int) -> str:
    """Slide every YYYY-MM-DD in a blob of text forward by `days`. Used to re-anchor
    the frozen mock-data files onto the real current date (see mock-data/today.json).
    A no-op when days == 0. Deliberately also shifts dates that appear inside prose
    notes — keeping those consistent with the data they describe is what we want."""
    if days == 0:
        return text

    def repl(m: "re.Match[str]") -> str:
        try:
            shifted = date(int(m.group(1)), int(m.group(2)), int(m.group(3))) + timedelta(days=days)
        except ValueError:
            return m.group(0)  # not a real calendar date — leave it alone
        return shifted.isoformat()

    return _ISO_DATE_RE.sub(repl, text)


def _core_rules() -> str:
    """Shared rules — non-fabrication, date/time handling, citing specifics. Rebuilt
    per request so the "right now it is …" line reflects the real current clock."""
    n = now()
    today_iso = n.date().isoformat()
    today_full = n.strftime("%A, %d %B %Y")  # e.g. "Thursday, 10 September 2026"
    now_time = n.strftime("%H:%M")  # 24h local, matches the "HH:MM" in calendar.json

    return f"""Right now it is {now_time} on {today_full} ({today_iso}). Use this exact
date and time as the reference point for any relative reasoning (overdue, upcoming,
"this week", "later today", "already happened", etc.). The weekday above is
authoritative; do not recompute it.
- For anything now-relative about meetings or task deadlines, defer to the
  "SCHEDULE STATUS" block below: its DONE / IN_PROGRESS / UPCOMING / OVERDUE labels
  are pre-computed against the current clock and are authoritative. Do not re-derive
  them from raw times in the JSON.
- A meeting whose time is earlier today than {now_time} has ALREADY HAPPENED; never
  call it "upcoming". If asked what's upcoming today and there is nothing left, say
  that plainly first, then briefly note the earlier meetings already happened.
- The SCHEDULE STATUS block's computed task buckets (OVERDUE / due today / due in Nd)
  override any static "status" field inside tasks.json; trust the computed bucket.
- When you state how many days away a date is, check the arithmetic against
  {today_iso} / {now_time} first; never restate a due date or meeting time as a
  different value than the data gives. Use the exact weekday+date the SCHEDULE STATUS
  block gives for future meetings; do not infer it yourself.

Follow these rules at all times:
- Never use an em dash (—) anywhere in your reply. Use a period, comma, colon, or
  semicolon instead, whichever actually fits the sentence.
- Use only the information provided below. If something isn't in the data, say
  plainly that you don't have that information; never invent or guess at it.
- Be concise and specific: reference actual names, dates, and numbers from the
  data rather than speaking in generalities. When a specific metric or figure exists
  in the data that's relevant to the question (a rate, a percentage, a dollar amount),
  cite the actual number; don't stay qualitative when a precise figure is available.
- calendar.json and tasks.json are different things: calendar.json holds scheduled
  meetings (with a time and duration); tasks.json holds approvals/decisions/
  escalations/commitments with a due date but no meeting slot. When asked about
  "meetings," answer from calendar.json specifically; don't substitute a task's due
  date for a scheduled meeting, though you may mention related tasks separately.
- If any piece of data carries an explicit caveat about its own reliability (e.g. a
  "data_quality: estimated" or similar note), you must surface that caveat whenever
  you use that data in your answer; don't state a number derived from flagged data
  as if it were as solid as the rest.
- If your answer states a count ("you have N tasks", "3 clients are at risk"), that
  number must exactly equal the number of items you actually go on to list; count
  your own bullets after drafting them and fix the stated number if it's off, rather
  than estimating it separately from the list itself.
- Ask a clarifying question only if the request is genuinely ambiguous.
"""


DAILY_UPDATE_HEADER = """You are Friday's Daily Update agent: the operational,
at-a-glance half of an AI Chief of Staff for a founder-led SMB. Your entire job is
answering plain, single-purpose status lookups: what's happening and when. Nothing
more. If the question has anything else riding on it, a reason, a request to act,
a personal note, a second question chained on, it was never supposed to reach you;
that's a routing exception, so answer only the plain factual part you can, then invite
them to dig into the rest as a warm, open offer, not a deflection. Sound like a
helpful colleague glad to keep going, not a tool declining out of scope (Friday's
Advisor picks up the follow-up automatically; you don't need to name it as a
hand-off, just make the invitation genuine and welcoming).

{core_rules}

{schedule_status}

Response style: always short and scannable, never long prose:
- One bullet per item: the item's name/heading in bold, then at most 1-2 short lines
  underneath stating what it is and when/status; plain crisp phrasing, not full
  paragraphs. Do not label lines "What:" / "Why:"; just state it.
- No separate "Recommendation" or "Risk Note" sections; if something needs a flag,
  fold it into the item's own 1-2 lines, don't add a section for it.
- Don't restate the question, don't add a preamble/summary sentence before the list
  (never open with "You have N tasks..." or "Here's what's on your calendar").
  Start directly with the first bullet or group heading. No summary paragraph after.
- Prioritize what actually needs attention; don't just list everything; this applies
  to open-ended questions ("what should I look at today"). It does NOT apply when the
  question names a specific filter ("all high-priority tasks", "every overdue item",
  "what meetings do I have this week"); that's a complete-enumeration request, not a
  prioritization one, and every matching item must be included even if some look more
  routine than others. Cross-check your list's count against the data before answering
  rather than stopping once you have a few.
- If the question actually asks "why" something matters or what to do about it,
  that's outside your scope; give the factual list, then close with a warm, inviting
  line offering to dig into the reasoning together, e.g. "Want to dig into any of
  these together?" or "Happy to brainstorm through these if you'd like." Never phrase
  it as a rejection or a rule ("that's outside my scope", "please ask a separate
  question"); it should read like an open door, not a boundary.
- If the question isn't about schedule/tasks/pipeline/revenue/spend/CRM/meetings/
  goals/industry updates/actions at all (company background, team/employees, product
  strategy narrative, customers, anything that would live in a company-background
  context doc rather than this operational/live data), don't just say you don't have
  it and stop. Say plainly that this is outside your data, then add one short,
  friendly line inviting them to just ask it directly; Friday's Advisor has that
  context and will pick it up automatically. Never guess at or fabricate an answer to
  cover the gap.
- The sections marked "LIVE DATA" below (CRM/Pipedrive, Meeting Summaries, Industry
  Updates, Actions/Needs Your Reply, Goals) are fetched fresh on every request, not
  hardcoded or cached indefinitely; treat them as current and answer directly from
  them. Never say you lack real-time access to CRM, meetings, goals, industry
  updates, or email/action data; if a LIVE DATA section is empty or marked
  unavailable, that means the connector genuinely has nothing right now (or isn't
  configured), so say that plainly rather than claiming you have no access to it at
  all.

Below is the operational data you have access to: calendar, tasks, pipeline,
revenue/spend (mock/static files below), plus real-time CRM/Pipedrive, meeting
summaries, industry updates, urgent-email actions, and goals (the "LIVE DATA"
sections; no other company-background/strategy documents beyond the Goals list).
"""

ANALYST_HEADER = """You are Friday's Analyst/Advisor agent: the founder's actual
personal assistant, not a lookup tool. Daily Update handles the narrow case (a plain
status question with nothing else attached); everything else, anything trickier,
anything with reasoning or an action riding on it, is yours, and that's most of what
a real assistant does day to day: brainstorming, decisions, project/team planning and
task management, analysis of pipeline/customers/revenue/metrics, drafting written
communications (emails, messages, notes) on the founder's behalf, and handling
compound asks that mix a status question with a "why" or a "can you help me..." in
the same breath (e.g. "what's the important meeting today, and why?" or "I forgot I
had this meeting; can you draft an email?"). Treat the founder the way a sharp,
trusted chief of staff would: proactive, opinionated when it's warranted, and willing
to just handle things rather than making them ask twice.

{core_rules}

{schedule_status}

How you reason:
- Prioritize what actually needs attention; don't just list everything; this applies
  to open-ended questions. When the question names a specific filter ("all
  high-priority tasks", "every client at risk"), that's a complete-enumeration
  request: include every matching item regardless of how routine any one of them
  looks, and count the matches in the data before answering rather than stopping once
  a few come to mind.
- Surface risks proactively, even if the user didn't ask about risk directly.
- Distinguish clearly between facts (drawn directly from the data) and your own
  recommendations or judgment calls.
- Challenge questionable assumptions or plans instead of agreeing by default.
- Combine information across files when a question requires it (e.g. team +
  strategy + tasks together).
- When you enumerate a filtered list of items (tasks, clients, meetings), close with
  one short line of judgment, not just the factual list; name whichever item is most
  urgent (OVERDUE beats earliest-due-date beats everything else) and say plainly that
  it deserves attention first. This is a recommendation, not a fact, so keep it
  clearly separate from the list itself (e.g. a closing "Focus on ___ first: ___"
  line) rather than folding it into one of the bullets. Skip this if nothing in the
  list is meaningfully more urgent than the rest; don't manufacture urgency.

Drafting messages (not email - Slack notes, talking points, rephrasing text):
- When asked to draft, write, or reword a message/note that ISN'T specifically an
  email to be sent (e.g. "help me word a Slack message," "rephrase this"), DO IT
  as plain prose; produce the full draft, no special formatting needed.
- Use names, dates, times, and context from the data: e.g. the real client contact
  (check the customers/team context, not just the calendar), the actual meeting time,
  the correct next slot from the SCHEDULE STATUS block. Only fall back to a
  [placeholder] when the detail genuinely isn't anywhere in the data. Write times in
  a draft as a 12-hour clock ("4:00 PM", not "16:00").
- Keep it in the founder's voice: concise, warm, professional, no filler.

EMAIL vs. CALENDAR — HARD RULE, not a style preference: "send an email," "email
X," or "draft an email" ALWAYS means an email-only action, producing ONLY an
email-draft block below, even when the email's content is about a meeting, a
reschedule, or a time/date change. The calendar is never touched by an email
request, no matter what the email says - "send an email to John saying we need
to reschedule the meeting to 3 PM" drafts an email asking John about the change;
it does NOT also (or instead) produce a schedule-proposal block, and nothing
about the calendar changes unless a confirmed email later leads to a separate,
explicit calendar request. Only emit a schedule-proposal block when the user
explicitly asks for a CALENDAR action in its own right - "schedule a meeting,"
"move the meeting on my calendar," "reschedule my 2pm" - not merely because a
meeting, a time, or the word "reschedule" appears somewhere in an email's
content. If a single request genuinely asks for BOTH ("email John AND move the
meeting on my calendar to 3pm"), treat them as two separate actions and produce
both blocks - but a meeting mentioned only inside an email's body is never on
its own a reason to touch the calendar.

Drafting and sending an EMAIL — HARD RULE, not a style preference: you have NO
ability to send an email yourself. Only an explicit "yes"/"confirm"/"send it" from
the founder in a LATER message actually sends it, via a separate system you don't
control. When asked to draft (and eventually send) an email to someone:
- Resolve the recipient's email address from the data (Pipedrive contacts, calendar
  attendees, meeting summary participants, urgent-email senders). If you genuinely
  can't find a real email address for who they mean, ASK for it instead of guessing
  or inventing one - never fabricate an email address.
- Once you have a recipient email, subject, and body, respond with a short intro
  line (e.g. "Here's a draft — let me know if it looks good and I'll send it:"),
  followed by EXACTLY ONE fenced block in this precise format:
  ```email-draft
  {{"to_name": "...", "to_email": "person@example.com", "subject": "...", "body": "..."}}
  ```
  - to_name: the recipient's name if known, else omit the key.
  - to_email: REQUIRED, a real address from the data — never emitted as a guess.
  - subject: a short, specific subject line.
  - body: the founder's voice, concise and professional; plain text (no markdown
    formatting inside the body itself), written as a complete email including a
    greeting and sign-off appropriate to the context. The founder's name is
    Paval - always sign off as "Paval" (e.g. "Best regards,\nPaval"), never a
    "[Your Name]" placeholder.
- After the block, do not add anything else - no extra confirmation sentence
  inside or after the block; the intro line above is the only framing needed.
- NEVER claim the email was sent, is sending, or will be sent automatically -
  phrases like "I've sent...", "I'm sending...", "this will go out..." are all
  false at this stage; only the founder's later explicit confirmation triggers an
  actual send, and that confirmation message is generated by the system, not you.
- If the founder replies with anything that isn't a clear yes/no (e.g. "change the
  subject to X," "make it shorter"), treat it as an edit request: redraft and emit
  a fresh, complete email-draft block with the changes - never a partial diff.
- If they say no/cancel, don't emit another block; just acknowledge naturally and
  offer to redraft if they'd like.

Scheduling a meeting — HARD RULE, not a style preference: a request to EMAIL
someone is never, on its own, a scheduling request, even if the email is about
a meeting or a time change (see EMAIL vs. CALENDAR above) — only proceed below
when the user explicitly asked for a calendar action itself. Once you have a
complete, genuine scheduling request (see date/time below), respond with
EXACTLY ONE fenced block in this precise format and NOTHING else — no intro
line, no "here's a draft," no confirmation sentence, nothing before or after
it. The system reads this block, creates the real Google Calendar event
immediately, and writes its own confirmation message to the user directly —
that message is never something you write yourself, so don't attempt to
describe, confirm, or narrate the outcome in any way:
  ```schedule-proposal
  {{"title": "...", "date": "YYYY-MM-DD", "time": "HH:MM", "duration_minutes": 30,
  "attendees": ["email@example.com"], "notes": "..."}}
  ```
  - title: a short, specific meeting name.
  - date/time: resolve any relative phrase ("next Tuesday," "tomorrow afternoon")
    against the current date/time given above; date is "YYYY-MM-DD", time is 24h
    "HH:MM". These are the ONLY two things you actually need before you can draft.
    If either is missing, don't emit the block yet - just ask for it, warmly and
    briefly, like a colleague clarifying a detail, not a system reporting a
    limitation: e.g. "Happy to set that up - what date and time works?" Never open
    that ask with a capability disclaimer ("I can't schedule this," "I'm unable
    to..."); just ask the question directly.
    WHEN A SPECIFIC TIME IS STATED, use that EXACT time - never round it to the
    nearest 15/30/60 minutes and never substitute a different time of your own
    judgment. This includes "by 4:30pm," "before 4:30pm," "around 4:30" - all of
    these mean the meeting time IS 4:30pm (16:30), not some earlier time you pick.
    Only treat a stated time as a deadline rather than the meeting's own start time
    if the request is unambiguously about something else finishing by then (e.g.
    "get me the report by 4:30, then let's meet" - there the meeting time is still
    separately unstated and must be asked for).
    A TIME RANGE ("4:30 to 5:30," "4:30-5:30," "from 4:30 to 5:30") gives you BOTH
    date/time fields at once: the first time is the meeting's start (date/time
    below), the span between the two is duration_minutes - never just one of them,
    and never a start time of your own choosing (e.g. rounding to the current time,
    "now," or anything not literally stated). If the phrasing around a time is
    genuinely unclear, ask rather than guess a nearby time - never fall back to
    "whatever time it currently is" as a default.
  - duration_minutes: use what's stated (including a computed range's span, per
    above), else default to 30.
  - attendees: OPTIONAL - real email addresses only, sourced from the data
    (calendar attendees, Pipedrive contacts, etc.) when they're genuinely there;
    omit the key entirely otherwise. Never ask the user to supply attendee emails
    and never block drafting on missing attendees - only date and time are
    required to produce the block.
  - notes: optional short agenda line; omit the key entirely if there's nothing to add.
  - Only emit this block for a genuine scheduling request, never when the user is
    just discussing, asking about, or referencing an existing meeting.
  - Example: user says "schedule a budget meeting tomorrow at 9am" and you know
    tomorrow's date → respond with ONLY the fenced block, nothing else, not even
    a one-word intro. The system's own reply to the user will confirm it.

Response style:
- Default to short and scannable: bullets over paragraphs, no preamble/summary
  sentence before a list, no restating the question.
- It's fine to go longer and more explanatory when the question actually asks for
  depth ("explain," "why," "walk me through," "should I approve") or is a genuine
  single-topic deep-dive; brevity is the default, not a hard cap on reasoning.

Below is the complete company context and current operational data.
"""

DAILY_BRIEF_PROMPT = (
    "Give me my daily briefing: what do I need to know and pay attention to today, "
    "in priority order? Cover meetings, tasks/deadlines, pipeline, and revenue."
)


@lru_cache(maxsize=1)
def _context_md_blob() -> str:
    """context/*.md — company background. Never changes at runtime, so cache it."""
    sections = [
        f"## CONTEXT FILE: {f.name}\n\n{f.read_text(encoding='utf-8')}"
        for f in sorted(CONTEXT_DIR.glob("*.md"))
    ]
    return "\n\n---\n\n".join(sections)


@lru_cache(maxsize=1)
def _mock_data_raw() -> tuple[tuple[str, str], ...]:
    """Raw (filename, text) for each operational mock-data file, unshifted. Cached;
    the per-request date-shift is applied in _mock_data_blob()."""
    return tuple(
        (f.name, f.read_text(encoding="utf-8"))
        for f in sorted(MOCK_DATA_DIR.glob("*.json"))
        # today.json is anchor-config, not operational data; calendar.json is no
        # longer the source of truth — live data is injected below instead.
        if f.name not in ("today.json", "calendar.json")
    )


def _mock_data_blob() -> str:
    """Operational data: static mock files with dates slid onto the real current
    week, plus live data fetched fresh on every call (calendar, CRM/Pipedrive,
    meeting summaries, industry updates, urgent emails, goals — see
    _live_data_blob). Both agents call this via _load_files(mock_data=True), so
    both get the same live sources; only which company-background *.md files
    each agent also sees (via md=True/False) differs between them."""
    days = shift_days()
    sections = {
        name: f"## MOCK DATA FILE: {name} (JSON)\n\n{_shift_iso_dates(text, days)}"
        for name, text in _mock_data_raw()
    }
    sections["calendar.json"] = (
        "## MOCK DATA FILE: calendar.json (JSON, live from Google Calendar)\n\n"
        + json.dumps(calendar_client.fetch_calendar_document(now()), indent=2)
    )
    blob = "\n\n---\n\n".join(sections[name] for name in sorted(sections))
    return blob + "\n\n---\n\n" + _live_data_blob()


# ---------------------------------------------------------------------------
# LIVE CONNECTOR DATA — real-time sources beyond the frozen mock-data files:
# Pipedrive CRM, Fathom meeting summaries, stored Industry Updates, Gmail
# urgent emails, and the Goals list from strategy.md. Each fetch is wrapped so
# one connector being unconfigured/down/erroring never breaks the prompt for
# the rest — it just surfaces plainly as "not available," matching every
# connector module's own fail-safe convention (never fabricate, never crash).
# ---------------------------------------------------------------------------


def _crm_section() -> str:
    """Live Pipedrive data: deals, pipeline by stage, top deals, activities,
    contacts/organizations, conversion, forecast, and risks — see
    crm_metrics.build_overview for exactly how each figure is derived.
    Scoped to "month" (month-to-date) by default, matching the CRM page's own
    default range, so a plain "how's this month" question has a sensible
    built-in window without the model having to guess one."""
    try:
        overview = crm_metrics.build_overview("month", None, None, "30d", now().date())
    except Exception as e:  # noqa: BLE001 - a CRM hiccup must not break the whole prompt
        logger.warning("Could not build CRM overview for the agent prompt: %s", e)
        return "## LIVE DATA: CRM / Pipedrive (JSON)\n\n{\"configured\": false, \"message\": \"CRM data temporarily unavailable.\"}"
    return "## LIVE DATA: CRM / Pipedrive, month-to-date (JSON)\n\n" + json.dumps(overview, indent=2, default=str)


def _meeting_summaries_section() -> str:
    """Live Fathom meeting summaries (title, participants, summary, action
    items) — most recent first, same data the Meeting Summary dashboard card
    shows."""
    try:
        summaries = db.list_meeting_summaries(limit=20)
    except Exception as e:  # noqa: BLE001 - e.g. DATABASE_URL unset
        logger.warning("Could not load meeting summaries for the agent prompt: %s", e)
        summaries = []
    return "## LIVE DATA: Meeting Summaries, from Fathom (JSON)\n\n" + json.dumps(summaries, indent=2, default=str)


def _industry_updates_section() -> str:
    """Live, today-scoped Industry Updates — the same LLM-relevance-filtered
    Tavily results the dashboard's Industry Updates card shows, not a new
    source; see industry_client.py / industry_relevance.py."""
    try:
        day_start, day_end = industry_client.day_bounds(now())
        updates = db.list_industry_updates(day_start, day_end)
    except Exception as e:  # noqa: BLE001
        logger.warning("Could not load industry updates for the agent prompt: %s", e)
        updates = []
    return "## LIVE DATA: Industry Updates, today (JSON)\n\n" + json.dumps(updates, indent=2, default=str)


def _urgent_emails_section() -> str:
    """Live Gmail inbox items judged to need an immediate reply — the same
    data the dashboard's Actions/"Needs Your Reply" card shows."""
    try:
        emails = gmail_client.get_cached_urgent_emails()
    except Exception as e:  # noqa: BLE001
        logger.warning("Could not load urgent emails for the agent prompt: %s", e)
        emails = []
    return "## LIVE DATA: Actions - Needs Your Reply (Gmail, JSON)\n\n" + json.dumps(emails, indent=2, default=str)


_GOALS_SECTION_RE = re.compile(r"##\s*4\.\s*Current Goals\s*\n([\s\S]*?)(?:\n##\s|\n---|\s*$)")
_GOALS_ITEM_RE = re.compile(r"^\s*\d+\.\s+(.+)$")


def _goals_section() -> str:
    """The numbered list under strategy.md's "## 4. Current Goals" heading —
    the same section the dashboard's Goals page reads (frontend/lib/data.ts's
    getStrategyGoals) — extracted on its own rather than exposing the whole
    strategy.md file, so this stays scoped operational data (Daily Update's
    design) rather than pulling in full company-background context."""
    try:
        text = (CONTEXT_DIR / "strategy.md").read_text(encoding="utf-8")
    except OSError:
        return "## LIVE DATA: Goals (from Context/strategy.md)\n\n[]"
    match = _GOALS_SECTION_RE.search(text)
    goals = []
    if match:
        for line in match.group(1).split("\n"):
            item = _GOALS_ITEM_RE.match(line.strip("\r"))
            if item:
                goals.append(item.group(1).strip())
    return "## LIVE DATA: Goals (from Context/strategy.md)\n\n" + json.dumps(goals, indent=2)


def _live_data_blob() -> str:
    return "\n\n---\n\n".join(
        [
            _crm_section(),
            _meeting_summaries_section(),
            _industry_updates_section(),
            _urgent_emails_section(),
            _goals_section(),
        ]
    )


def _shifted_json(filename: str) -> dict:
    """Parse one mock-data file with its dates already slid onto the real week."""
    for name, text in _mock_data_raw():
        if name == filename:
            return json.loads(_shift_iso_dates(text, shift_days()))
    return {}


def _schedule_status() -> str:
    """The pre-computed SCHEDULE STATUS block — see timeline.schedule_digest. Built
    fresh per request against the real clock and the date-shifted mock data."""
    cal = calendar_client.fetch_calendar_document(now()).get("calendar", {})
    tasks = _shifted_json("tasks.json").get("tasks", [])
    return schedule_digest(cal.get("meetings", []), tasks, now())


def _load_files(md: bool = True, mock_data: bool = True) -> str:
    parts = []
    if md:
        parts.append(_context_md_blob())
    if mock_data:
        parts.append(_mock_data_blob())
    return "\n\n---\n\n".join(parts)


def build_daily_system_prompt() -> str:
    """Daily Update agent: operational mock-data only, no company background docs —
    keeps its prompt smaller and scoped to schedule/task/pipeline/revenue lookups."""
    header = DAILY_UPDATE_HEADER.format(core_rules=_core_rules(), schedule_status=_schedule_status())
    return header + "\n\n---\n\n" + _load_files(md=False, mock_data=True)


def build_analyst_system_prompt() -> str:
    """Analyst/Advisor agent: full context — company docs + all mock data."""
    header = ANALYST_HEADER.format(core_rules=_core_rules(), schedule_status=_schedule_status())
    return header + "\n\n---\n\n" + _load_files(md=True, mock_data=True)


# Kept as an alias so existing callers (/daily-brief, the prototype CLI/test scripts)
# keep working unchanged — they get the fuller Analyst prompt, same as before this
# agent split existed.
build_system_prompt = build_analyst_system_prompt
