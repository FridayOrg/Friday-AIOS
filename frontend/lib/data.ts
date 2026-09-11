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
export function getTodaysMeetings(): (Meeting & { status: MeetingStatus; past: boolean })[] {
  const data = readJson<{ calendar: { meetings: Meeting[] } }>("calendar.json");
  const today = isoDate();
  const now = new Date();
  return data.calendar.meetings
    .filter((m) => (m.occurrences ? m.occurrences.includes(today) : m.date === today))
    .map((m) => {
      const { status } = classifyMeeting(today, m.time, m.duration_minutes, now);
      return { ...m, status, past: status === "done" };
    });
}

export function getAllMeetingsThisWeek(): Meeting[] {
  const data = readJson<{ calendar: { meetings: Meeting[] } }>("calendar.json");
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

export function getDashboardData(): DashboardData {
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

  const calRaw = readJson<{
    calendar: {
      week_start: string;
      week_end: string;
      meetings: Meeting[];
    };
  }>("calendar.json");

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
  const nowDate = new Date();
  const todayIso = isoDate();
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

  return {
    today: isoDate(),
    now: isoTime(),
    weekStart: calRaw.calendar.week_start,
    weekEnd: calRaw.calendar.week_end,
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
