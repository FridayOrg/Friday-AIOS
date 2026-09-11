// Now-relative meeting classification, mirroring backend/app/timeline.py. Pure date
// math, no node deps — safe to import in client components. Kept as a parallel
// implementation (same as the date-shift logic) so the dashboard and the chat agent
// agree on what "done" / "in progress" / "upcoming" mean.

export type MeetingStatus = "done" | "in_progress" | "upcoming" | "unscheduled";

/** Parse "HH:MM" plus a "YYYY-MM-DD" into a local Date. Returns null if either is
 *  missing/invalid. */
function at(dateISO: string, time: string | undefined | null): Date | null {
  if (!dateISO || !time) return null;
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if ([y, m, d, hh, mm].some(Number.isNaN)) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/** Classify one meeting occurrence (date + time + duration) against `now`. */
export function classifyMeeting(
  dateISO: string,
  time: string | undefined | null,
  durationMin: number | undefined | null,
  now: Date,
): { status: MeetingStatus; start: Date | null; end: Date | null } {
  const start = at(dateISO, time);
  if (!start) return { status: "unscheduled", start: null, end: null };
  const end = new Date(start.getTime() + (durationMin || 0) * 60_000);
  const t = now.getTime();
  if (t >= end.getTime()) return { status: "done", start, end };
  if (t >= start.getTime()) return { status: "in_progress", start, end };
  return { status: "upcoming", start, end };
}
