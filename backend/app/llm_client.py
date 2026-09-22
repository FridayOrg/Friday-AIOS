"""Thin wrapper around the Gemini API call. Kept separate from context assembly and
from the API routing layer so each piece can be tested/swapped independently
(e.g. swapping providers later shouldn't touch context_loader.py or main.py)."""

import re
import time
from functools import lru_cache

from google import genai
from google.genai.errors import ServerError

from .config import GEMINI_API_KEY, GEMINI_CLASSIFIER_API_KEY, MODEL

# Gemini's free tier occasionally returns a transient 503 "high demand" ServerError
# that clears up within a few seconds on retry (observed repeatedly during testing —
# see backend/prototype/). Retry a couple of times with a short backoff before
# surfacing an error to the user, rather than making every transient blip visible.
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 4

# Gemini keeps reaching for an em dash in "**Title** — description" style headers even
# with an explicit system-prompt rule against it (observed repeatedly in testing) — a
# deterministic cleanup here is the reliable fix rather than relying on instruction-
# following alone. Colon reads naturally for the dominant pattern actually seen.
_EM_DASH_RE = re.compile(r"\s*—\s*")


def _strip_em_dash(text: str) -> str:
    return _EM_DASH_RE.sub(": ", text)


@lru_cache(maxsize=1)
def get_client() -> genai.Client:
    if not GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY not found. Add it to .env as GEMINI_API_KEY=your_key"
        )
    return genai.Client(api_key=GEMINI_API_KEY)


@lru_cache(maxsize=1)
def get_classifier_client() -> genai.Client:
    """Separate client (usually a separate account's key) for the intent-classifier
    call that routes each message to the Daily Update or Analyst/Advisor agent — kept
    off the main client's quota. Falls back to the main key if none was configured."""
    if not GEMINI_CLASSIFIER_API_KEY:
        raise RuntimeError(
            "No API key available for the classifier (GEMINI_CLASSIFIER_API_KEY / GEMINI_API_KEY)"
        )
    return genai.Client(api_key=GEMINI_CLASSIFIER_API_KEY)


# How many prior turns (user + Friday messages combined) to replay back to Gemini as
# conversation history. In-memory only, per the frontend's own chat state — no DB yet
# (per the user's plan to add one later). Capped so a long-running session doesn't
# grow the request without bound; the system prompt with full company context is
# already large, so history is the part worth keeping bounded.
MAX_HISTORY_TURNS = 20


def _build_contents(history: list[dict] | None, question: str) -> list:
    """Turns the frontend's flat [{role, text}, ...] history into the structured
    multi-turn `contents` list the Gemini SDK expects, then appends the new question
    as the final user turn. Gemini's roles are "user"/"model" — the frontend's
    "friday" role maps to "model"."""
    contents = []
    for turn in (history or [])[-MAX_HISTORY_TURNS:]:
        text = (turn.get("text") or "").strip()
        if not text:
            continue
        role = "model" if turn.get("role") == "friday" else "user"
        contents.append(genai.types.Content(role=role, parts=[genai.types.Part(text=text)]))
    contents.append(genai.types.Content(role="user", parts=[genai.types.Part(text=question)]))
    return contents


def ask_friday(system_prompt: str, question: str, history: list[dict] | None = None) -> str:
    client = get_client()
    last_error: Exception | None = None
    contents = _build_contents(history, question)

    for attempt in range(MAX_RETRIES):
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=contents,
                config=genai.types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.3,
                ),
            )
            return _strip_em_dash(response.text)
        except ServerError as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY_SECONDS * (attempt + 1))

    raise last_error  # all retries exhausted


def ask_friday_stream(system_prompt: str, question: str, history: list[dict] | None = None):
    """Same call as ask_friday(), but yields text chunks as they arrive instead of
    waiting for the full response. Used by the /ask/stream endpoint for the live chat
    UI; ask_friday() (non-streaming) is left as-is for /daily-brief.

    Retry-on-503 only applies before any chunk has been yielded — once partial text
    has already reached the client, restarting the call would duplicate content, so a
    mid-stream failure is simply raised instead of retried.
    """
    client = get_client()
    last_error: Exception | None = None
    contents = _build_contents(history, question)

    for attempt in range(MAX_RETRIES):
        yielded_any = False
        try:
            stream = client.models.generate_content_stream(
                model=MODEL,
                contents=contents,
                config=genai.types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.3,
                ),
            )
            for chunk in stream:
                if chunk.text:
                    yielded_any = True
                    yield _strip_em_dash(chunk.text)
            return
        except ServerError as e:
            last_error = e
            if yielded_any or attempt == MAX_RETRIES - 1:
                raise
            time.sleep(RETRY_DELAY_SECONDS * (attempt + 1))

    if last_error:
        raise last_error


# Fast keyword routing. Most messages are unambiguous, and a blocking LLM classifier
# call adds ~2s of pure latency before the answer can even start — so decide the
# obvious cases here for free and only fall back to the LLM (None) when unsure.
#
# The routing is asymmetric ON PURPOSE, and this is the one rule that governs every
# change to this file: "daily" is ONLY for a plain, single-purpose status lookup —
# "what's the important meeting today", "list overdue tasks". The instant a question
# is trickier than that — reasoning attached ("...and why"), an action requested
# ("help me draft an email about it"), or anything that isn't a pure lookup — it goes
# to Analyst, no second-guessing. This is safe by construction: Analyst is the
# founder's full personal assistant (brainstorming, drafting, task/decision help,
# revenue & pipeline analysis — see ANALYST_HEADER) and its prompt already contains
# every one of Daily's data files plus full company context, so routing there never
# loses information — it only costs a slightly longer prompt. Daily, in contrast,
# hard-refuses anything outside its narrow lane. So when genuinely unsure, analyst is
# always the safe default and daily is never worth risking. If Daily Update gets an
# analyst-shaped request it hard-refuses ("not my role"), whereas Analyst handling a
# status question is just slightly wordier — that asymmetry is why `_NOT_DAILY_RE`
# exists as a guard: anything that even smells like reasoning, advice, or an action
# request must NOT be forced to "daily". It also has to survive voice-transcription
# noise ("draft" heard as "draught").
_ANALYST_RE = re.compile(
    r"\b(why|how (?:should|do|would|can|might)|should i|shall i|what if|"
    r"explain|walk me through|help me (?:think|decide|plan|figure|write|draft|draught|compose|word|phrase|reply|respond)|"
    r"recommend|suggest|advice|advise|opinion|think about|thoughts on|"
    r"plan|prioriti[sz]\w*|priority|trade[- ]?off|compare|versus|\bvs\b|"
    r"decide|decision|assign|allocat\w*|strateg\w*|brainstorm|approach|"
    r"risk|worried|concern|implication|worth it|make sense|"
    # "personal assistant" style asks — managing/organizing/catching up, not looking up
    r"forgot|forgotten|remind me|what am i (?:missing|forgetting)|catch me up|"
    r"help me (?:manage|organize|handle|sort out|keep track|catch up|stay on top)|"
    r"manage my|organize my|keep track of|on top of|"
    # company/org background — never in Daily's data (mock-data only, no context/*.md),
    # so these must go to Analyst regardless of how factual-sounding the phrasing is
    r"employees?|staff\b|headcount|team roster|org chart|who works|who's on the team|"
    r"job title|reports? to|team structure|department|hiring|"
    # drafting / composing / rescheduling / scheduling a NEW meeting (Observe →
    # Recommend → Draft ladder — creating a meeting is a draft-then-confirm action,
    # same as drafting an email, not a status lookup even though "schedule" also
    # appears as a plain noun in genuine lookups like "what's my schedule today")
    r"draft|draught|compose|rephrase|re-?word|re-?write|word this|phrase this|"
    r"reschedul\w*|re-?schedul\w*|rearrang\w*|postpon\w*|"
    r"(?:schedule|book|set up|arrange)(?:\s+\w+){0,3}\s+(?:meeting|meetings|call|calls|"
    r"catch[- ]?up|sync|appointment|demo|discussion|review)|"
    r"(?:write|prepare|send|put together) (?:me |up |out |an? |the |some )*(?:e-?mail|message|msg|note|memo|reply|response|blurb|apolog)|"
    r"(?:an?|the|my|this|your) (?:e-?mail|message|memo) (?:to|for|about|regarding|saying|back)|"
    r"e-?mail (?:to|for) (?:them|him|her|the |a )|"
    r"reply to|respond to|get back to|follow[- ]?up (?:e-?mail|message|note|with))\b",
    re.IGNORECASE,
)
_DAILY_RE = re.compile(
    r"\b(meeting|meetings|calendar|schedule|standup|stand-up|agenda|appointment|"
    r"task|tasks|to-?do|deadline|deadlines|due|overdue|"
    r"today|tonight|tomorrow|this week|next week|this afternoon|this morning|"
    r"upcoming|coming up|next up|what's on|what do i have|am i free|free (?:today|tomorrow|this)|"
    r"mrr|arr|revenue|pipeline|spend|burn|how many|how much|when is|when's|what time)\b",
    re.IGNORECASE,
)
# If any of these appear, the message is not a plain status lookup even when it also
# mentions a meeting or a date — so don't let `_DAILY_RE` claim it.
_NOT_DAILY_RE = re.compile(
    r"\b(draft|draught|compose|rephrase|re-?word|re-?write|"
    r"write|prepare|put together|send|reply|respond|apolog|"
    r"e-?mail|message|memo|"
    r"reschedul\w*|re-?schedul\w*|rearrang\w*|postpon\w*|move (?:the|my|our|it|that)|cancel|"
    r"(?:schedule|book|set up|arrange)(?:\s+\w+){0,3}\s+(?:meeting|meetings|call|calls|"
    r"catch[- ]?up|sync|appointment|demo|discussion|review)|"
    r"help me|help us|"
    r"why|should i|shall i|how (?:do|should|would|can) i|what if|"
    r"recommend|suggest|advice|advise|opinion|brainstorm|strateg\w*)\b",
    re.IGNORECASE,
)


def heuristic_route(question: str) -> str | None:
    """"daily" / "analyst" when the message is clearly one or the other, else None
    (let the LLM classifier decide)."""
    if _ANALYST_RE.search(question):
        return "analyst"
    if _DAILY_RE.search(question) and not _NOT_DAILY_RE.search(question):
        return "daily"
    return None


CLASSIFY_PROMPT_TEMPLATE = """Classify the NEW MESSAGE below into exactly one category:

HARD RULE — apply this before anything else below: if the message mentions employees,
staff, team members, headcount, org structure, or anyone's role/title, the answer is
always "analyst". Never "daily", no matter how the question is phrased.

"daily" = ONLY a realtime/operational lookup: is there a meeting today, what's
upcoming (meetings or tasks), what's overdue or due, or a current revenue/pipeline/
spend number. That is the entire category — nothing else qualifies, even if it sounds
like a simple factual lookup. "daily" has no access to company background, team/
employee info, strategy, customer details, or product info.

"analyst" = the founder's full personal assistant: reasoning, recommendations,
explanations, risk analysis, brainstorming, planning, drafting emails/messages,
scheduling/booking a NEW meeting (drafting a proposal for the founder to confirm,
never just answering what's already on the calendar), task/project management help,
team/project decisions, "why"/"should I" questions, AND any factual question about
the company itself (employees/team/org structure, strategy, customers,
products/services, metrics definitions) even when it isn't asking for advice.

THE DECIDING RULE: if the question is trickier than a plain single-purpose lookup —
even slightly — it's "analyst", full stop, no second-guessing. A daily-shaped
question stops being "daily" the moment ANYTHING else is attached to it: a reason
("...and why"), a request to act on it ("...help me draft an email about it"), an
emotional/personal note ("I forgot about this"), or a second question chained on. If
genuinely unsure, answer "analyst" — it already contains every one of "daily"'s data
files plus full company context, so it is never the wrong choice, just occasionally
more thorough than strictly necessary. "daily" is the narrow exception, not the default.

Examples:
- "What's the important meeting today?" -> daily (plain lookup, nothing else attached)
- "Order all the overdue tasks." -> daily (plain lookup)
- "What's the important meeting today, and why?" -> analyst (reasoning attached)
- "I forgot I had this meeting today — can you help me draft an email?" -> analyst
  (personal note + a drafting request, not a lookup at all)
- "Schedule a call with Northgate tomorrow at 3pm." -> analyst (creating a new
  meeting is a draft-then-confirm action, not a lookup)
- "What's on my schedule today?" -> daily (plain lookup of the existing calendar)

Recent conversation (oldest first, may be empty):
{history_text}

NEW MESSAGE: "{question}"

Respond with exactly one word — daily or analyst — nothing else."""


def classify_intent(question: str, history: list[dict] | None = None) -> str:
    """Routes a message to the Daily Update or Analyst/Advisor agent. Uses a separate,
    cheap call (not the full context) on its own API key/quota (see
    get_classifier_client). Defaults to "analyst" — the fuller, safer agent — on any
    ambiguous response or failure, rather than risk under-serving a real question."""
    fast = heuristic_route(question)
    if fast is not None:
        return fast

    history_lines = [
        f"{'User' if t.get('role') != 'friday' else 'Friday'}: {t.get('text', '')}"
        for t in (history or [])[-4:]
        if (t.get("text") or "").strip()
    ]
    history_text = "\n".join(history_lines) if history_lines else "(none)"
    prompt = CLASSIFY_PROMPT_TEMPLATE.format(history_text=history_text, question=question)

    try:
        client = get_classifier_client()
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=genai.types.GenerateContentConfig(temperature=0, max_output_tokens=5),
        )
        answer = (response.text or "").strip().lower()
        return "daily" if answer.startswith("daily") else "analyst"
    except Exception:
        return "analyst"  # classifier hiccup shouldn't block the whole request
