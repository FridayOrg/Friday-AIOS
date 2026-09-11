"""All now-relative time reasoning for Friday lives here — one place that compares the
real current clock against meeting start/end times and task due dates, so the LLM is
handed already-classified facts ("DONE", "upcoming", "overdue by 2d") instead of being
asked to do date arithmetic itself (which gemini-3.1-flash-lite does unreliably).

Consumed by context_loader.py, which injects schedule_digest() into both agents'
system prompts. The frontend mirrors the core classification in frontend/lib/timeline.ts
for the dashboard — kept as parallel implementations, same as the date-shift logic.
"""

from datetime import date, datetime, time, timedelta

# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------


def _combine(d: date, t: time, ref: datetime) -> datetime:
    """A datetime for (date, time) in the same tz-awareness as `ref` (config.now()),
    so the two can be compared without TypeError."""
    dt = datetime.combine(d, t)
    if ref.tzinfo is not None:
        dt = dt.replace(tzinfo=ref.tzinfo)
    return dt


def _parse_time(s: str | None) -> time | None:
    if not s:
        return None
    try:
        hh, mm = s.split(":")[:2]
        return time(int(hh), int(mm))
    except (ValueError, TypeError):
        return None


def _parse_date(s: str | None) -> date | None:
    try:
        return date.fromisoformat(s) if s else None
    except (ValueError, TypeError):
        return None


def humanize_delta(minutes: float) -> str:
    """A rough human span for a count of minutes (sign ignored): '25 min', '2h 10m',
    '3d'. Callers add the 'in ' / ' ago' framing."""
    m = abs(int(minutes))
    if m < 60:
        return f"{m} min"
    if m < 60 * 24:
        h, rem = divmod(m, 60)
        return f"{h}h {rem}m" if rem else f"{h}h"
    d, rem_h = divmod(m // 60, 24)
    return f"{d}d {rem_h}h" if rem_h else f"{d}d"


def _when_label(start: datetime, now: datetime) -> str:
    """How to say when an upcoming meeting starts, relative to now. Always carries the
    concrete weekday+date for anything past today, so the model never has to (and is
    never tempted to) guess the calendar date itself."""
    stamp = start.strftime("%a %d %b %Y")  # "Fri 11 Sep 2026"
    hm = start.strftime("%H:%M")
    if start.date() == now.date():
        return f"in {humanize_delta((start - now).total_seconds() / 60)} (today {hm})"
    if start.date() == now.date() + timedelta(days=1):
        return f"tomorrow, {stamp}, {hm}"
    return f"{stamp}, {hm}"


# ---------------------------------------------------------------------------
# Meetings
# ---------------------------------------------------------------------------


def _meeting_dates(meeting: dict) -> list[date]:
    raw = meeting.get("occurrences") or ([meeting["date"]] if meeting.get("date") else [])
    return sorted(d for d in (_parse_date(s) for s in raw) if d)


def _client_label(meeting: dict) -> str:
    cid = meeting.get("related_client_id")
    return " (" + cid.replace("-", " ").title() + ")" if cid else ""


def meeting_entries(meeting: dict, now: datetime):
    """Yield one classified entry per occurrence of the meeting (a one-off meeting has
    exactly one; a recurring one — the daily standup — has several). Each entry:
    name, date, status ('done'|'in_progress'|'upcoming'|'unscheduled'), start/end
    (datetime|None), detail (human string), recurring (bool), is_today (bool)."""
    name = meeting.get("name", "(untitled)") + _client_label(meeting)
    dates = _meeting_dates(meeting)
    t = _parse_time(meeting.get("time"))
    dur = int(meeting.get("duration_minutes") or 0)
    recurring = bool(meeting.get("recurring")) or len(dates) > 1

    for d in dates:
        if t is None:
            yield {
                "name": name, "date": d, "status": "unscheduled", "start": None, "end": None,
                "detail": "on-demand / no fixed time", "recurring": recurring,
                "is_today": d == now.date(),
            }
            continue
        start = _combine(d, t, now)
        end = start + timedelta(minutes=dur)
        span = f"{start.strftime('%H:%M')}–{end.strftime('%H:%M')}"
        if now >= end:
            status = "done"
            detail = f"was {span}, ended {humanize_delta((now - end).total_seconds() / 60)} ago"
        elif start <= now < end:
            status = "in_progress"
            detail = f"started {start.strftime('%H:%M')}, ends in {humanize_delta((end - now).total_seconds() / 60)}"
        else:
            status = "upcoming"
            detail = f"{_when_label(start, now)} ({start.strftime('%H:%M')}, {dur} min)"
        yield {
            "name": name, "date": d, "status": status, "start": start, "end": end,
            "detail": detail, "recurring": recurring, "is_today": d == now.date(),
        }


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


def classify_task(task: dict, now: datetime) -> dict:
    """Classify a task by its due_date vs today. bucket is one of
    'overdue' | 'today' | 'this_week' | 'later' | 'no_date'."""
    title = task.get("title", "(untitled)")
    raw = task.get("due_date")
    due = _parse_date(raw)
    if due is None:
        return {"title": title, "bucket": "no_date", "detail": "no due date", "days": None, "sort_key": 10**9}

    days = (due - now.date()).days
    if days < 0:
        detail, bucket = f"overdue by {abs(days)}d (was due {raw})", "overdue"
    elif days == 0:
        detail, bucket = f"due today ({raw})", "today"
    elif days <= 7:
        detail, bucket = f"due in {days}d ({raw})", "this_week"
    else:
        detail, bucket = f"due {raw} ({days}d out)", "later"
    return {"title": title, "bucket": bucket, "detail": detail, "days": days, "sort_key": due.toordinal()}


# ---------------------------------------------------------------------------
# The digest injected into the system prompt
# ---------------------------------------------------------------------------


def schedule_digest(meetings: list[dict], tasks: list[dict], now: datetime) -> str:
    """A compact, pre-computed status block. The LLM should trust these labels rather
    than re-deriving "upcoming" / "overdue" from raw times."""
    entries = [e for m in meetings for e in meeting_entries(m, now)]

    today = sorted(
        (e for e in entries if e["is_today"]),
        key=lambda e: (e["start"] is None, e["start"] or now),
    )
    in_progress = [e for e in entries if e["status"] == "in_progress"]
    upcoming_today = [e for e in today if e["status"] == "upcoming"]
    future = sorted(
        (e for e in entries if e["status"] == "upcoming"),
        key=lambda e: e["start"],
    )

    lines = [
        f"SCHEDULE STATUS — computed at {now.strftime('%H:%M')} on {now.strftime('%A, %d %B %Y')}.",
        "These labels are authoritative; do not recompute times or re-derive which "
        "meetings are upcoming vs. over. If asked what's upcoming today and "
        '"Still upcoming today" is "none", say that plainly first, then briefly recap '
        "that the earlier meetings already happened — never present a past meeting as upcoming.",
        "",
        "Today's meetings:",
    ]
    if today:
        for e in today:
            lines.append(f"  - {e['name']} — {e['status'].upper()} ({e['detail']})")
    else:
        lines.append("  - none scheduled today")

    lines.append(f"Happening now: {'; '.join(e['name'] for e in in_progress) if in_progress else 'none'}")
    lines.append(
        "Still upcoming today: "
        + ("; ".join(f"{e['name']} — {e['detail']}" for e in upcoming_today) if upcoming_today else "none")
    )

    if future:
        nxt = future[0]
        lines.append(f"Next scheduled meeting: {nxt['name']} — {nxt['detail']}")
        # "Later this week": the next occurrence of each distinct meeting within 7 days.
        seen: set[str] = {nxt["name"]}
        rest = []
        for e in future[1:]:
            if e["name"] in seen or (e["start"].date() - now.date()).days >= 7:
                continue
            seen.add(e["name"])
            tag = " (recurring)" if e["recurring"] else ""
            rest.append(f"  - {e['name']} — {e['start'].strftime('%a %H:%M')}{tag}")
        if rest:
            lines.append("Later this week:")
            lines.extend(rest)
    else:
        lines.append("Next scheduled meeting: none on the calendar")

    tclass = [classify_task(t, now) for t in tasks]
    order = {"overdue": 0, "today": 1, "this_week": 2, "later": 3, "no_date": 4}
    tclass.sort(key=lambda c: (order[c["bucket"]], c["sort_key"]))
    lines.append("")
    lines.append("Task deadlines (computed):")
    if tclass:
        for c in tclass:
            mark = c["detail"].upper() if c["bucket"] == "overdue" else c["detail"]
            lines.append(f"  - {c['title']} — {mark}")
    else:
        lines.append("  - no tasks")

    return "\n".join(lines)
