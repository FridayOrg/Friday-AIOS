"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  X,
  ChevronDown,
  DollarSign,
  Target,
  AlertCircle,
  CalendarClock,
  TrendingUp,
  TrendingDown,
  LayoutGrid,
  CalendarDays,
  FileText,
  ExternalLink,
} from "lucide-react";
import type { DashboardData } from "@/lib/data";
import { classifyMeeting } from "@/lib/timeline";
import { useHighlight } from "@/lib/highlight-context";
import UrgentEmails from "./UrgentEmails";
import IndustryUpdates from "./IndustryUpdates";

// ---------------------------------------------------------------------------
// TOKENS  (unchanged from the ceo-dashboard reference design)
// ---------------------------------------------------------------------------

const C = {
  ink: "#101828",
  muted: "#667085",
  faint: "#98A2B3",
  border: "rgba(16,24,40,0.07)",
  teal: "#0F9E8E",
  up: "#12B76A",
  down: "#F04438",
};

const TILE = {
  revenue: { from: "#D7F6EA", to: "#EEFBF4", icon: "#0E9F6E", iconBg: "#C9F3E0" },
  deals: { from: "#E7E4FC", to: "#F3F1FE", icon: "#6E5AE0", iconBg: "#DCD7FA" },
  retention: { from: "#FBE3F0", to: "#FDF0F8", icon: "#D6428E", iconBg: "#F7CFE6" },
  burn: { from: "#FCE6DA", to: "#FEF1E9", icon: "#DD7A33", iconBg: "#FAD9BE" },
  calendar: { from: "#DCEEFB", to: "#EEF6FD", icon: "#2D9CDB", iconBg: "#C7E4F7" },
};

const STATUS: Record<string, { color: string; label: string }> = {
  guarantee_met: { color: "#0E9F6E", label: "Guarantee met" },
  on_track: { color: "#2D9CDB", label: "On track" },
  ramping: { color: "#DD9A2E", label: "Ramping" },
};
const statusOf = (k: string) => STATUS[k] ?? { color: C.muted, label: k };

const RISK: Record<string, { color: string; label: string }> = {
  none: { color: "#0E9F6E", label: "No risk" },
  low: { color: "#667085", label: "Low risk" },
  medium: { color: "#DD9A2E", label: "Medium risk" },
  high: { color: "#F04438", label: "High risk" },
};
const riskOf = (k: string) => RISK[k] ?? { color: C.muted, label: k };

const PRIORITY: Record<string, { color: string; label: string }> = {
  critical: { color: "#F04438", label: "Critical" },
  high: { color: "#DD9A2E", label: "High" },
  medium: { color: "#98A2B3", label: "Medium" },
  low: { color: "#98A2B3", label: "Low" },
};
const priorityOf = (k: string) => PRIORITY[k] ?? { color: C.faint, label: k };

const TYPE_LABEL: Record<string, string> = {
  approval_needed: "Approval needed",
  escalation: "Escalation",
  decision_needed: "Decision needed",
  personal_commitment: "Personal commitment",
};

// ---------------------------------------------------------------------------
// CHAT-DRIVEN HIGHLIGHT — a question in Ask Friday ("what tasks are due today?")
// expands + glows the matching card here. `statusKey` is the raw risk/status/priority
// value from the matched entity; the glow color reuses the same maps the card itself
// renders with (green/amber/red), so "highlighted" always matches what the card
// already means by that color.
// ---------------------------------------------------------------------------

interface Glow {
  section: string;
  itemIds?: string[]; // specific entities the answer named or matched a filter for
  ts: number;
}

function glowColorFor(section: string, statusKey?: string): string {
  if (!statusKey) return C.teal;
  switch (section) {
    case "financial":
      return riskOf(statusKey).color;
    case "pipeline":
      return statusOf(statusKey).color;
    case "tasks":
      return statusKey === "overdue" ? C.down : priorityOf(statusKey).color;
    case "calendar":
      return priorityOf(statusKey).color;
    default:
      return C.teal;
  }
}

/** Glow className + CSS-var color for one element; pass a per-render key suffix so
 * the animation restarts even when the same card is highlighted twice in a row.
 * Two layers: `glow-pulse` is a one-shot entrance flash (plays once regardless of how
 * long the class stays applied), `glow-active` is a plain static ring that holds for
 * as long as this item is the active highlight — cleared only by the next question or
 * a manual collapse (see the effect and toggleSection/toggleAll below), not a timer. */
function glowProps(active: boolean, color: string): { className: string; style: React.CSSProperties } {
  if (!active) return { className: "", style: {} };
  return {
    className: " glow-pulse glow-active",
    style: { ["--glow" as unknown as string]: `${color}80` } as React.CSSProperties,
  };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US")}`;
const fmtDay = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const fmtFullDay = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
const to12h = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${m.toString().padStart(2, "0")} ${period}`;
};

// The 2x2 grid below "Daily Brief". Financial Performance / Sales & Guarantee
// Pipeline / Spend & Notifications live on their own /crm page (see
// CrmDashboard.tsx) instead of a collapsible accordion here.
const GRID_CARDS = [
  { key: "tasks", title: "Actions", icon: AlertCircle, iconBg: "#FBE3F0", iconColor: "#D6428E" },
  { key: "calendar", title: "Calendar", icon: CalendarClock, iconBg: "#DCEEFB", iconColor: "#2D9CDB" },
  { key: "industry", title: "Industry Updates", icon: FileText, iconBg: "#DCEEFB", iconColor: "#2D9CDB" },
  { key: "meetings", title: "Meeting Summary", icon: FileText, iconBg: "#EAE9FE", iconColor: "#6D5BD0" },
] as const;

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

export default function CeoDashboard({ data }: { data: DashboardData }) {
  const { revenue, pipeline, tasks, calendar, meetingSummaries } = data;

  const firstOverdue = tasks.find((t) => t.status === "overdue")?.id ?? null;
  const [expandedTask, setExpandedTask] = useState<string | null>(firstOverdue);
  // Collapsed by default — click a grid card's header to reveal its content.
  const [gridOpen, setGridOpen] = useState<Record<string, boolean>>({});
  const toggleGridCard = (key: string) => setGridOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  // --- Chat-driven highlight (see lib/highlight-context.tsx) --------------
  const { target } = useHighlight();
  const [glow, setGlow] = useState<Glow | null>(null);

  useEffect(() => {
    if (!target) return;
    setGridOpen((prev) => ({ ...prev, [target.section]: true }));
    // Only auto-open a task's description when exactly one task matched — with several
    // (e.g. "high priority tasks") which one to expand is ambiguous, so just glow the rows.
    if (target.section === "tasks" && target.itemIds?.length === 1) setExpandedTask(target.itemIds[0]);

    const scrollTimer = setTimeout(() => {
      document.getElementById(`section-${target.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);

    // No auto-clear timer: the glow stays until the next question overwrites it (a
    // new `target` re-runs this effect and replaces `glow`), not on a fixed clock.
    setGlow({ section: target.section, itemIds: target.itemIds, ts: target.ts });

    return () => clearTimeout(scrollTimer);
  }, [target]);

  // --- Search (clients, tasks, meetings) -----------------------------------
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!q) return [];
    const out: { section: string; label: string; sub: string }[] = [];
    tasks.forEach((t) => {
      if (
        t.title.toLowerCase().includes(q) ||
        (t.by ?? "").toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q)
      )
        out.push({ section: "tasks", label: t.title, sub: TYPE_LABEL[t.type] ?? t.type });
    });
    calendar.forEach((m) => {
      if (m.name.toLowerCase().includes(q))
        out.push({ section: "calendar", label: m.name, sub: fmtDay(m.date) });
    });
    return out.slice(0, 8);
  }, [q, tasks, calendar]);

  const jumpToSection = (key: string) => {
    setGridOpen((prev) => ({ ...prev, [key]: true }));
    setQuery("");
    setTimeout(() => {
      document
        .getElementById(`section-${key}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  // Today + the next 2 days (3-day window) for the Calendar grid card. Built
  // via Date.UTC rather than `new Date(iso + "T00:00:00")` — the latter
  // parses as LOCAL midnight, and a later .toISOString() then converts back
  // to UTC, silently shifting the date back a day whenever the server's
  // local timezone is ahead of UTC (e.g. IST) — this exact bug was observed
  // directly when building this feature.
  const daysNext3 = useMemo(() => {
    const [y, m, d] = data.today.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, d));
    return Array.from({ length: 3 }, (_, i) => {
      const dt = new Date(start);
      dt.setUTCDate(start.getUTCDate() + i);
      const iso = dt.toISOString().slice(0, 10);
      return {
        iso,
        meetings: calendar
          .filter((m) => m.date === iso)
          .sort((a, b) => a.time.localeCompare(b.time)),
      };
    });
  }, [data.today, calendar]);

  const overdueCount = tasks.filter((t) => t.status === "overdue").length;

  return (
    <div
      style={{
        minHeight: "100%",
        fontFamily: "'Inter', system-ui, sans-serif",
        color: C.ink,
        background: "linear-gradient(135deg, #EAF7F1 0%, #EEEBFB 45%, #FBF0F6 100%)",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        .expand-panel { animation: expandIn 0.25s ease-out; overflow: hidden; }
        @keyframes expandIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .glow-pulse { animation: glowPulse 1.3s ease-out; border-radius: inherit; }
        @keyframes glowPulse {
          0% { box-shadow: 0 0 0 0 var(--glow); }
          25% { box-shadow: 0 0 22px 4px var(--glow); }
          100% { box-shadow: 0 0 0 2px var(--glow); }
        }
        .glow-active { box-shadow: 0 0 0 2px var(--glow); border-radius: inherit; }
      `}</style>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* ---------------- HEADER ---------------- */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold">CEO Dashboard</h1>
            <p className="text-sm mt-0.5" style={{ color: C.muted }}>
              Strategic overview for BookMySales · {fmtFullDay(data.today)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <div
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm"
                style={{ background: "rgba(255,255,255,0.85)", border: `1px solid ${C.border}` }}
              >
                <Search size={15} style={{ color: C.faint }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search clients, tasks…"
                  className="bg-transparent outline-none w-44"
                  style={{ color: C.ink }}
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="shrink-0"
                    style={{ color: C.faint }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {q && (
                <div
                  className="absolute right-0 mt-2 w-80 rounded-lg z-20 overflow-hidden"
                  style={{
                    background: "#fff",
                    border: `1px solid ${C.border}`,
                    boxShadow: "0 12px 32px -12px rgba(16,24,40,0.25)",
                  }}
                >
                  {searchResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm" style={{ color: C.faint }}>
                      No matches for &ldquo;{query}&rdquo;.
                    </div>
                  ) : (
                    searchResults.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => jumpToSection(r.section)}
                        className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
                        style={{
                          borderBottom:
                            i < searchResults.length - 1 ? `1px solid ${C.border}` : "none",
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm truncate" style={{ color: C.ink }}>
                            {r.label}
                          </span>
                          <span className="block text-[11px]" style={{ color: C.faint }}>
                            {r.sub}
                          </span>
                        </span>
                        <span className="text-[11px] shrink-0" style={{ color: C.teal }}>
                          {GRID_CARDS.find((c) => c.key === r.section)?.title ?? r.section}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---------------- DAILY BRIEF ---------------- */}
        <div
          className="rounded-2xl p-5 mb-4"
          style={{ background: "rgba(255,255,255,0.85)", border: `1px solid ${C.border}` }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#E9F9F5" }}>
              <LayoutGrid size={14} style={{ color: C.teal }} />
            </span>
            <h2 className="text-sm font-semibold">Daily Brief</h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <OverviewTile
              key={glow?.section === "financial" ? `mrr-${glow.ts}` : "mrr"}
              tile={TILE.revenue}
              icon={DollarSign}
              label="Monthly Recurring Revenue"
              value={fmtUsd(revenue.currentMrr)}
              trendPct={revenue.mrrGrowthPct}
              trendLabel="vs last month"
              positive
              glow={glow?.section === "financial" ? C.teal : undefined}
            />
            <OverviewTile
              tile={TILE.deals}
              icon={Target}
              label="Active Clients"
              value={String(revenue.activeClients)}
              trendPct={
                revenue.activeClients - revenue.clientDelta > 0
                  ? (revenue.clientDelta / (revenue.activeClients - revenue.clientDelta)) * 100
                  : null
              }
              trendLabel="this month"
              positive
            />
            <OverviewTile
              key={glow?.section === "pipeline" ? `guarantee-${glow.ts}` : "guarantee"}
              tile={TILE.retention}
              icon={TrendingUp}
              label="Guarantee Completion"
              value={`${pipeline.guaranteeCompletionPct}%`}
              trendPct={null}
              trendLabel={`${pipeline.guaranteeMet} of ${pipeline.slotsTotal} met`}
              positive
              glow={glow?.section === "pipeline" ? C.teal : undefined}
            />
            <NextMeetingsTile
              key={glow?.section === "calendar" ? `next-${glow.ts}` : "next"}
              tile={TILE.calendar}
              upcoming={data.upcomingMeetings}
              glow={glow?.section === "calendar" ? C.teal : undefined}
            />
          </div>

        </div>

        {/* ---------------- QUICK ACCESS: Actions | Calendar / Industry Updates | Meeting Summary ---------------- */}
        <div
          className="rounded-2xl p-5 mb-4"
          style={{ background: "rgba(255,255,255,0.85)", border: `1px solid ${C.border}` }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#E9F9F5" }}>
              <LayoutGrid size={14} style={{ color: C.teal }} />
            </span>
            <h2 className="text-sm font-semibold">Quick Access</h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {GRID_CARDS.map((c) => (
              <div
                key={glow?.section === c.key ? `${c.key}-${glow.ts}` : c.key}
                id={`section-${c.key}`}
                className={`rounded-xl overflow-hidden scroll-mt-6${glow?.section === c.key ? " glow-pulse" : ""}`}
                style={{
                  background: "rgba(255,255,255,0.7)",
                  border: `1px solid ${C.border}`,
                  ...(glow?.section === c.key ? glowProps(true, C.teal).style : {}),
                }}
              >
              <button
                onClick={() => toggleGridCard(c.key)}
                className="w-full flex items-center justify-between px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: c.iconBg }}>
                    <c.icon size={15} style={{ color: c.iconColor }} />
                  </span>
                  <span className="text-sm font-semibold">{c.title}</span>
                  {c.key === "tasks" && overdueCount > 0 && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: "#FDE7ED", color: C.down }}>
                      {overdueCount} overdue
                    </span>
                  )}
                </div>
                <ChevronDown
                  size={16}
                  style={{
                    color: C.faint,
                    transform: gridOpen[c.key] ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                  }}
                />
              </button>
              {gridOpen[c.key] && (
                <div className="expand-panel px-5 pb-5 pt-1" style={{ borderTop: `1px solid ${C.border}` }}>
                  {c.key === "tasks" && (
                    <>
                      <TasksContent tasks={tasks} expandedTask={expandedTask} setExpandedTask={setExpandedTask} glow={glow} />
                      <div className="mt-3">
                        <UrgentEmails />
                      </div>
                    </>
                  )}
                  {c.key === "calendar" && (
                    <Calendar3DayContent daysNext3={daysNext3} today={data.today} now={data.now} glow={glow} />
                  )}
                  {c.key === "industry" && <IndustryUpdates />}
                  {c.key === "meetings" && <MeetingSummariesContent summaries={meetingSummaries} />}
                </div>
              )}
            </div>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OVERVIEW TILE
// ---------------------------------------------------------------------------

function OverviewTile({
  tile,
  icon: Icon,
  label,
  value,
  trendPct,
  trendLabel,
  positive,
  neutral,
  glow,
}: {
  tile: { from: string; to: string; icon: string; iconBg: string };
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  label: string;
  value: string;
  trendPct: number | null;
  trendLabel: string;
  positive: boolean;
  neutral?: boolean;
  glow?: string;
}) {
  const g = glowProps(!!glow, glow ?? "");
  return (
    <div
      className={`rounded-xl p-4${g.className}`}
      style={{ background: `linear-gradient(150deg, ${tile.from}, ${tile.to})`, ...g.style }}
    >
      <div className="flex items-start justify-between mb-5">
        <p className="text-xs font-medium" style={{ color: C.ink, opacity: 0.75 }}>{label}</p>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: tile.iconBg }}>
          <Icon size={13} style={{ color: tile.icon }} />
        </span>
      </div>
      <p className="text-2xl font-bold mb-1.5">{value}</p>
      <div className="flex items-center gap-1 text-xs">
        {!neutral &&
          (positive ? (
            <TrendingUp size={12} style={{ color: C.up }} />
          ) : (
            <TrendingDown size={12} style={{ color: C.down }} />
          ))}
        {trendPct !== null && (
          <span className="font-semibold" style={{ color: neutral ? C.muted : positive ? C.up : C.down }}>
            {trendPct > 0 ? "+" : ""}
            {trendPct.toFixed(1)}%
          </span>
        )}
        <span style={{ color: C.muted }}>{trendLabel}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NEXT MEETINGS TILE — replaces the "Today's Spend" tile in the overview row.
// Shows today's still-to-come meetings; once they're all done, the next day that
// has meetings. Data (real-clock classified) comes from getDashboardData.
// ---------------------------------------------------------------------------

function NextMeetingsTile({
  tile,
  upcoming,
  glow,
}: {
  tile: { from: string; to: string; icon: string; iconBg: string };
  upcoming: DashboardData["upcomingMeetings"];
  glow?: string;
}) {
  const g = glowProps(!!glow, glow ?? "");
  return (
    <div
      className={`rounded-xl p-4${g.className}`}
      style={{ background: `linear-gradient(150deg, ${tile.from}, ${tile.to})`, ...g.style }}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium" style={{ color: C.ink, opacity: 0.75 }}>Next meetings</p>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: tile.iconBg }}>
          <CalendarDays size={13} style={{ color: tile.icon }} />
        </span>
      </div>

      {!upcoming ? (
        <p className="text-sm font-medium" style={{ color: C.muted }}>No upcoming meetings</p>
      ) : (
        <>
          <p className="text-sm font-bold mb-2">{upcoming.dayLabel}</p>
          <div className="space-y-1.5">
            {upcoming.meetings.map((m, i) => (
              <div key={i} className="flex items-baseline gap-2 text-xs">
                <span className="tabular-nums shrink-0 w-16" style={{ color: C.muted }}>
                  {to12h(m.time)}
                </span>
                <span className="truncate font-medium" style={{ color: C.ink }}>{m.name}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SECTION CONTENTS
// ---------------------------------------------------------------------------

function TasksContent({
  tasks,
  expandedTask,
  setExpandedTask,
  glow,
}: {
  tasks: DashboardData["tasks"];
  expandedTask: string | null;
  setExpandedTask: (id: string | null) => void;
  glow: Glow | null;
}) {
  return (
    <div className="pt-1">
      {tasks.map((t) => {
        const isOpen = expandedTask === t.id;
        const style = priorityOf(t.priority);
        const isGlow = glow?.section === "tasks" && !!glow.itemIds?.includes(t.id);
        const g = glowProps(isGlow, isGlow ? glowColorFor("tasks", t.status === "overdue" ? "overdue" : t.priority) : "");
        return (
          <div
            key={isGlow ? `${t.id}-${glow?.ts}` : t.id}
            className={g.className.trim()}
            style={{ borderBottom: `1px solid ${C.border}`, ...g.style }}
          >
            <button
              onClick={() => setExpandedTask(isOpen ? null : t.id)}
              className="w-full flex items-start gap-3 py-2.5 text-left"
            >
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: style.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: style.color }}>
                    {TYPE_LABEL[t.type] ?? t.type}
                  </span>
                  {t.status === "overdue" && (
                    <span className="text-[11px] font-medium" style={{ color: C.down }}>Overdue</span>
                  )}
                </div>
                <p className="text-sm leading-snug">{t.title}</p>
                <p className="text-xs mt-0.5" style={{ color: C.faint }}>
                  Due {fmtDay(t.due)}
                  {t.by ? ` · ${t.by}` : ""}
                </p>
              </div>
              <ChevronDown
                size={14}
                style={{ color: C.faint, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
              />
            </button>
            {isOpen && (
              <p className="text-xs leading-relaxed pb-3 pl-[18px] pr-2" style={{ color: C.muted }}>{t.desc}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Calendar3DayContent({
  daysNext3,
  today,
  now,
  glow,
}: {
  daysNext3: {
    iso: string;
    meetings: { time: string; durationMin: number; name: string; priority: string }[];
  }[];
  today: string;
  now: string; // "HH:MM" real current time
  glow: Glow | null;
}) {
  // Rebuild the real "now" instant from the server-computed date + time so the
  // client classifies meetings against the same clock the rest of the app uses.
  const nowDate = new Date(`${today}T${now}:00`);
  const [ty, tm, td] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(ty, tm - 1, td));
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);

  const dayLabel = (iso: string): { top: string; bottom: string } => {
    const datePart = fmtDay(iso).split(", ")[1]; // e.g. "Sep 18"
    if (iso === today) return { top: "Today", bottom: datePart };
    if (iso === tomorrowIso) return { top: "Tomorrow", bottom: datePart };
    return { top: fmtDay(iso).split(",")[0], bottom: datePart };
  };

  return (
    <div className="space-y-3 pt-2">
      {daysNext3.map((day) => {
        const isToday = day.iso === today;
        const statuses = day.meetings.map(
          (m) => classifyMeeting(day.iso, m.time, m.durationMin, nowDate).status
        );
        // The first still-upcoming meeting today is the "next" one.
        const nextIdx = isToday ? statuses.indexOf("upcoming") : -1;
        return (
          <div key={day.iso} className="flex gap-3">
            <div className="w-14 shrink-0 pt-0.5">
              <div className="text-xs font-medium" style={{ color: isToday ? C.teal : C.faint }}>
                {dayLabel(day.iso).top}
              </div>
              <div className="text-[11px]" style={{ color: C.faint }}>{dayLabel(day.iso).bottom}</div>
            </div>
            <div className="flex-1 space-y-1.5 pb-1">
              {day.meetings.length === 0 && (
                <div className="text-xs" style={{ color: C.faint }}>No meetings</div>
              )}
              {day.meetings.map((m, i) => {
                const pStyle = priorityOf(m.priority);
                const status = day.iso < today ? "done" : statuses[i];
                const done = status === "done";
                const live = status === "in_progress";
                const isNext = i === nextIdx;
                const meetingId = `${day.iso}|${m.time}|${m.name}`;
                const isGlow = glow?.section === "calendar" && !!glow.itemIds?.includes(meetingId);
                const g = glowProps(isGlow, isGlow ? glowColorFor("calendar", m.priority) : "");
                return (
                  <div
                    key={isGlow ? `${i}-${glow?.ts}` : i}
                    className={`flex items-center gap-2 text-xs${g.className}`}
                    style={{ opacity: done ? 0.4 : 1, ...g.style }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: pStyle.color }} />
                    <span className="tabular-nums w-16 shrink-0" style={{ color: C.faint }}>{to12h(m.time)}</span>
                    <span
                      className="truncate"
                      style={{
                        color: m.priority === "critical" ? C.down : C.ink,
                        fontWeight: m.priority === "critical" ? 600 : 400,
                        textDecoration: done ? "line-through" : "none",
                      }}
                    >
                      {m.name}
                    </span>
                    {done && (
                      <span className="shrink-0" style={{ color: C.faint }}>· done</span>
                    )}
                    {live && (
                      <span
                        className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: "#FDECEC", color: C.down }}
                      >
                        now
                      </span>
                    )}
                    {isNext && !live && (
                      <span
                        className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: "#E9F9F5", color: C.teal }}
                      >
                        next
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MEETING SUMMARIES (Fathom)
// ---------------------------------------------------------------------------

// First bullet point in a Fathom markdown summary, stripped of markdown link/
// bold syntax — used as the 1-line "key takeaway" (the "## Key Takeaways"
// section's first bullet is reliably the first bullet in the whole document).
function extractFirstBullet(markdown: string | null): string | null {
  if (!markdown) return null;
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (m) {
      return m[1]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .trim();
    }
  }
  return null;
}

function MeetingSummariesContent({ summaries }: { summaries: DashboardData["meetingSummaries"] }) {
  if (summaries.length === 0) {
    return (
      <p className="text-xs leading-relaxed pt-2" style={{ color: C.faint }}>
        No meeting summaries yet. These appear automatically once Fathom finishes processing a recorded meeting.
      </p>
    );
  }

  return (
    <div className="pt-1">
      {summaries.map((m) => {
        const takeaway = extractFirstBullet(m.summary_markdown);
        const action = m.action_items[0] ?? null;
        return (
          <div key={m.recording_id} className="py-2.5" style={{ borderBottom: `1px solid ${C.border}` }}>
            <p className="text-sm font-medium leading-snug">{m.title}</p>
            <p className="text-xs mt-0.5" style={{ color: C.faint }}>
              {m.started_at ? fmtDay(m.started_at.slice(0, 10)) : fmtDay(m.received_at.slice(0, 10))}
            </p>
            {takeaway && (
              <p className="text-xs mt-1.5 leading-snug" style={{ color: C.muted }}>{takeaway}</p>
            )}
            {action && (
              <p className="text-xs mt-1 leading-snug" style={{ color: C.muted }}>
                <span className="font-medium">Action:</span> {action}
              </p>
            )}
            {m.meeting_url && (
              <a
                href={m.meeting_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs mt-1.5"
                style={{ color: C.teal }}
              >
                Watch recording <ExternalLink size={12} />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

