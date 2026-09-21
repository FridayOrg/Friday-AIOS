import fs from "fs";
import path from "path";
import { CONTEXT_DIR, MOCK_DATA_DIR, isoDate, isoTime, shiftDays } from "./paths";
import { classifyMeeting, type MeetingStatus } from "./timeline";

// Business logic for reading and shaping the mock data lives here, kept separate
// from both the API routes (thin — just call these) and the UI components (dumb —
// just render what they're given). Nothing here is hardcoded business data; it's
// all read from context/ and mock-data/ at request time.

const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

/** Slide every YYYY-MM-DD in a text blob forward by `days`, re-anchoring the frozen
 *  mock data onto the real current date (see mock-data/today.json). No-op at days 0. */
function shiftIsoDates(text: string, days: number): string {
  if (days === 0) return text;
  return text.replace(ISO_DATE_RE, (whole, y, m, d) => {
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    if (Number.isNaN(dt.getTime())) return whole;
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  });
}

// Read a mock-data JSON file, sliding its dates onto the real current week first so
// "today" / "this week" / "overdue" stay correct as real time moves.
function readJson<T>(fileName: string): T {
  const filePath = path.join(MOCK_DATA_DIR, fileName);
  const raw = shiftIsoDates(fs.readFileSync(filePath, "utf-8"), shiftDays());
  return JSON.parse(raw);
}

// Calendar data no longer comes from mock-data/calendar.json — it's fetched live
// from the backend's /calendar endpoint (backend/app/calendar_client.py), which
// reads Google Calendar directly. Proxied through the backend rather than called
// from here so the Google service-account credentials only ever live server-side
// in one place (see the ADR discussion: Ask Friday's answers and the dashboard
// widgets share one live source instead of each maintaining their own).
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

// "Monday of the real current week" — calendar.json used to carry this as
// calendar.week_start; live Google Calendar events have no such field, so it's
// computed locally instead (mirrors backend/app/calendar_client.py's _week_bounds,
// which uses this exact same Monday as its fetch window's start).
function currentWeekStart(): string {
  const [y, m, d] = isoDate().split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

// Sunday of the same week as currentWeekStart() — calendar.json used to carry
// this as calendar.week_end.
function currentWeekEnd(weekStartIso: string): string {
  const [y, m, d] = weekStartIso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

async function fetchCalendar(): Promise<{ calendar: { meetings: Meeting[] } }> {
  try {
    const res = await fetch(`${FRIDAY_API_URL}/calendar`, { cache: "no-store" });
    if (!res.ok) throw new Error(`/calendar returned ${res.status}`);
    return await res.json();
  } catch (err) {
    // Backend unreachable/unauthenticated with Google, or a bad response — degrade
    // to "no meetings" rather than breaking the dashboard or the AI's context.
    console.error("Could not fetch live calendar data from the Friday backend:", err);
    return { calendar: { meetings: [] } };
  }
}

export interface Meeting {
  id: string;
  name: string;
  category: string;
  priority: string;
  time?: string;
  duration_minutes?: number;
  mode?: string;
  attendees?: string[];
  agenda?: string;
  date?: string;
  occurrences?: string[];
}

export interface MeetingSummary {
  recording_id: string;
  title: string;
  meeting_url: string | null;
  started_at: string | null;
  participants: string[];
  summary_markdown: string | null;
  action_items: string[];
  received_at: string;
}

// Fathom meeting summaries — stored server-side (see backend/app/db.py) and
// fetched here the same way live calendar data is: proxied through the
// backend rather than a database call from the frontend directly.
async function fetchMeetingSummaries(): Promise<MeetingSummary[]> {
  try {
    const res = await fetch(`${FRIDAY_API_URL}/meeting-summaries`, { cache: "no-store" });
    if (!res.ok) throw new Error(`/meeting-summaries returned ${res.status}`);
    const data = await res.json();
    return data.meetings ?? [];
  } catch (err) {
    console.error("Could not fetch meeting summaries from the Friday backend:", err);
    return [];
  }
}

export interface Task {
  id: string;
  type: string;
  title: string;
  description: string;
  due_date: string;
  priority: string;
  status: string;
  related_client?: string;
  raised_by?: string;
}

export interface SpendEntry {
  id: string;
  category: string;
  label: string;
  amount_usd: number;
}

/** Today's meetings, each classified against the real current time (`done` /
 *  `in_progress` / `upcoming`) via lib/timeline — so callers can tell "already
 *  happened" from "still to come" instead of treating every meeting dated today as
 *  upcoming. `past` kept as a convenience alias for `status === "done"`. */
export async function getTodaysMeetings(): Promise<(Meeting & { status: MeetingStatus; past: boolean })[]> {
  const data = await fetchCalendar();
  const today = isoDate();
  // See getDashboardData's nowDate comment: must be parsed through the same
  // offset-less local-Date path classifyMeeting's `at()` uses, not `new Date()`,
  // or an already-finished meeting can be misclassified as upcoming whenever the
  // server's local TZ differs from FRIDAY_TZ.
  const now = new Date(`${today}T${isoTime()}:00`);
  return data.calendar.meetings
    .filter((m) => (m.occurrences ? m.occurrences.includes(today) : m.date === today))
    .map((m) => {
      const { status } = classifyMeeting(today, m.time, m.duration_minutes, now);
      return { ...m, status, past: status === "done" };
    });
}

export async function getAllMeetingsThisWeek(): Promise<Meeting[]> {
  const data = await fetchCalendar();
  return data.calendar.meetings;
}

export function getTasks(): Task[] {
  const data = readJson<{ tasks: Task[] }>("tasks.json");
  return data.tasks;
}

/** Tasks worth surfacing on the dashboard's "Needs Your Attention" card: overdue
 * items first, then anything due soonest. Deliberately not "all tasks" — the Home
 * dashboard is meant to prioritize, not dump everything (per CLAUDE.md UI rules). */
export function getAttentionItems(limit = 3): Task[] {
  const tasks = getTasks();
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const overdue = tasks.filter((t) => t.status === "overdue");
  const pending = tasks
    .filter((t) => t.status !== "overdue")
    .sort((a, b) => {
      const rankDiff = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      return a.due_date.localeCompare(b.due_date);
    });
  return [...overdue, ...pending].slice(0, limit);
}

export function getSpendToday(): { total: number; entries: SpendEntry[] } {
  const data = readJson<{ entries: SpendEntry[] }>("spend.json");
  const total = data.entries.reduce((sum, e) => sum + e.amount_usd, 0);
  return { total, entries: data.entries };
}

export interface RevenueSnapshot {
  snapshot_date: string;
  summary: {
    mrr: number;
    active_clients: number;
    at_risk_mrr: number;
    at_risk_clients: number;
  };
  data_quality?: string;
}

export function getRevenue(): {
  snapshots: RevenueSnapshot[];
  latest: RevenueSnapshot;
  growthPct: number | null;
} {
  const data = readJson<{ snapshots: RevenueSnapshot[] }>("revenue.json");
  const snapshots = data.snapshots;
  const latest = snapshots[snapshots.length - 1];
  const prev = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const growthPct =
    prev && prev.summary.mrr > 0
      ? ((latest.summary.mrr - prev.summary.mrr) / prev.summary.mrr) * 100
      : null;
  return { snapshots, latest, growthPct };
}

export interface ContextFile {
  slug: string;
  title: string;
  content: string;
}

const CONTEXT_TITLES: Record<string, string> = {
  "company-profile.md": "Company Profile",
  "team.md": "Team",
  "strategy.md": "Strategy",
  "customers.md": "Customers",
  "products-services.md": "Products & Services",
  "metrics.md": "Metrics",
};

// ---------------------------------------------------------------------------
// CEO Dashboard — one assembled payload, shaped for components/CeoDashboard.tsx.
// All values read from mock-data/*.json at request time; nothing hardcoded.
// ---------------------------------------------------------------------------

export interface DashboardData {
  today: string;
  now: string; // real current time, "HH:MM" (24h) — for marking meetings already past
  weekStart: string;
  weekEnd: string;
  meetingSummaries: MeetingSummary[]; // Fathom summaries, most recent first
  revenue: {
    currentMrr: number;
    mrrGrowthPct: number | null;
    activeClients: number;
    clientDelta: number;
    atRiskMrr: number;
    atRiskClients: number;
    sparkline: number[]; // real snapshot MRR values only — not interpolated
    byClient: {
      id: string;
      name: string;
      fee: number;
      status: string;
      risk: string;
      note?: string;
    }[];
    forecastNote: string;
  };
  pipeline: {
    slotsTotal: number;
    slotsFilled: number;
    guaranteeMet: number;
    guaranteeCompletionPct: number;
    clients: {
      id: string;
      name: string;
      industry: string;
      month: number;
      booked: number;
      target: number;
      status: string;
    }[];
  };
  tasks: {
    id: string;
    type: string;
    title: string;
    by: string | null;
    due: string;
    priority: string;
    status: string;
    desc: string;
  }[];
  calendar: { date: string; time: string; durationMin: number; name: string; priority: string }[];
  spend: { total: number; entries: { label: string; category: string; amount: number }[] };
  // The next day that still has meetings not yet finished, and up to 2 of them.
  // While any of today's meetings are still to come (or in progress) this is today;
  // once they're all done it rolls to the next day that has meetings. null = nothing
  // ahead on the calendar.
  upcomingMeetings: {
    dayLabel: string; // "Today" or "Fri Sep 11"
    isToday: boolean;
    meetings: { time: string; name: string }[];
  } | null;
}

export async function getDashboardData(): Promise<DashboardData> {
  const revenueRaw = readJson<{
    snapshots: {
      snapshot_date: string;
      summary: {
        mrr: number;
        active_clients: number;
        at_risk_mrr: number;
        at_risk_clients: number;
      };
      revenue_by_client: {
        client_id: string;
        name: string;
        monthly_fee_usd: number;
        status: string;
        revenue_risk: string;
        revenue_opportunity?: string;
        note?: string;
      }[];
    }[];
    comparison?: { mrr_growth_pct?: number; client_count_change?: number };
    forecast?: { note?: string };
  }>("revenue.json");

  const latestSnap = revenueRaw.snapshots[revenueRaw.snapshots.length - 1];

  const pipelineRaw = readJson<{
    slots_total: number;
    slots_filled: number;
    summary: { guarantee_met_count: number };
    clients: {
      id: string;
      name: string;
      industry: string;
      guarantee_target_monthly_meetings: number;
      engagement_month: number;
      meetings_booked_this_period: number;
      status: string;
    }[];
  }>("pipeline.json");

  const pipelineClients = pipelineRaw.clients.map((c) => ({
    id: c.id,
    name: c.name.split(" ")[0],
    industry: c.industry.split(" (")[0],
    month: c.engagement_month,
    booked: c.meetings_booked_this_period,
    target: c.guarantee_target_monthly_meetings,
    status: c.status,
  }));

  const bookedSum = pipelineClients.reduce((s, c) => s + Math.min(c.booked, c.target), 0);
  const targetSum = pipelineClients.reduce((s, c) => s + c.target, 0);
  const guaranteeCompletionPct = targetSum > 0 ? Math.round((bookedSum / targetSum) * 100) : 0;

  const tasks = getTasks()
    .map((t) => ({
      id: t.id,
      type: t.type,
      title: t.title,
      by: t.raised_by ?? null,
      due: t.due_date,
      priority: t.priority,
      status: t.status,
      desc: t.description,
    }))
    .sort((a, b) => a.due.localeCompare(b.due));

  const calRaw = await fetchCalendar();

  const calendar = calRaw.calendar.meetings.flatMap((m) => {
    const dates = m.occurrences ?? (m.date ? [m.date] : []);
    return dates.map((date) => ({
      date,
      time: m.time ?? "",
      durationMin: m.duration_minutes ?? 0,
      name: m.name,
      priority: m.priority,
    }));
  });

  const spend = getSpendToday();

  // "Next meetings" card: classify every calendar occurrence against the real clock,
  // keep only those not yet finished (upcoming or in progress), and take up to 2 from
  // the earliest such day. So it shows today's remaining meetings until they're all
  // done, then rolls to the next day that has any.
  //
  // nowDate must be built the same way classifyMeeting's `at()` parses a meeting's
  // date+time — via a local, offset-less Date string — not `new Date()` (the real
  // instant). Calendar times are wall-clock values in FRIDAY_TZ; `at()` naively
  // parses them in whatever timezone the Node process itself runs in. On a server
  // whose local TZ differs from FRIDAY_TZ (e.g. Render running UTC), `new Date()`
  // and `at()`'s parse of the *same* moment land on different instants, and an
  // already-finished meeting gets classified as still upcoming. Building nowDate
  // from isoDate()/isoTime() (both FRIDAY_TZ-correct) through the identical
  // local-parse path keeps the two sides consistent regardless of server TZ —
  // exactly how Calendar3DayContent (CeoDashboard.tsx) already does it.
  const todayIso = isoDate();
  const nowDate = new Date(`${todayIso}T${isoTime()}:00`);
  const notDone = calendar
    .map((m) => ({ ...m, ...classifyMeeting(m.date, m.time, m.durationMin, nowDate) }))
    .filter((m) => m.start && (m.status === "upcoming" || m.status === "in_progress"))
    .sort((a, b) => a.start!.getTime() - b.start!.getTime());

  let upcomingMeetings: DashboardData["upcomingMeetings"] = null;
  if (notDone.length) {
    const dayIso = notDone[0].date;
    upcomingMeetings = {
      isToday: dayIso === todayIso,
      dayLabel:
        dayIso === todayIso
          ? "Today"
          : new Date(dayIso + "T00:00:00")
              .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
              .replace(",", ""),
      meetings: notDone
        .filter((m) => m.date === dayIso)
        .slice(0, 2)
        .map((m) => ({ time: m.time, name: m.name })),
    };
  }

  const weekStart = currentWeekStart();
  const meetingSummaries = await fetchMeetingSummaries();

  return {
    today: isoDate(),
    now: isoTime(),
    weekStart,
    weekEnd: currentWeekEnd(weekStart),
    meetingSummaries,
    revenue: {
      currentMrr: latestSnap.summary.mrr,
      mrrGrowthPct: revenueRaw.comparison?.mrr_growth_pct ?? null,
      activeClients: latestSnap.summary.active_clients,
      clientDelta: revenueRaw.comparison?.client_count_change ?? 0,
      atRiskMrr: latestSnap.summary.at_risk_mrr,
      atRiskClients: latestSnap.summary.at_risk_clients,
      sparkline: revenueRaw.snapshots.map((s) => s.summary.mrr),
      byClient: latestSnap.revenue_by_client.map((c) => ({
        id: c.client_id,
        name: c.name,
        fee: c.monthly_fee_usd,
        status: c.status,
        risk: c.revenue_risk,
        note:
          c.revenue_opportunity === "expansion"
            ? "Expansion opportunity"
            : c.note ?? undefined,
      })),
      forecastNote: revenueRaw.forecast?.note ?? "",
    },
    pipeline: {
      slotsTotal: pipelineRaw.slots_total,
      slotsFilled: pipelineRaw.slots_filled,
      guaranteeMet: pipelineRaw.summary.guarantee_met_count,
      guaranteeCompletionPct,
      clients: pipelineClients,
    },
    tasks,
    calendar,
    spend: {
      total: spend.total,
      entries: spend.entries.map((e) => ({
        label: e.label,
        category: e.category,
        amount: e.amount_usd,
      })),
    },
    upcomingMeetings,
  };
}

export function getContextFiles(): ContextFile[] {
  const files = fs.readdirSync(CONTEXT_DIR).filter((f) => f.endsWith(".md"));
  return files
    .map((fileName) => ({
      slug: fileName.replace(/\.md$/, ""),
      title: CONTEXT_TITLES[fileName] ?? fileName,
      content: fs.readFileSync(path.join(CONTEXT_DIR, fileName), "utf-8"),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// The "Goals" side panel (dashboard + CRM pages) reads the numbered list
// under strategy.md's "## 4. Current Goals" heading directly, rather than
// duplicating that content as separately-maintained hardcoded strings —
// company.md's own doc stays the single source of truth for what the actual
// goals are.
export function getStrategyGoals(): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(CONTEXT_DIR, "strategy.md"), "utf-8");
  } catch {
    return [];
  }
  const section = text.match(/##\s*4\.\s*Current Goals\s*\n([\s\S]*?)(?:\n##\s|\n---|\s*$)/);
  if (!section) return [];
  return section[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+\.\s+(.+)$/)?.[1]?.trim())
    .filter((line): line is string => !!line);
}
