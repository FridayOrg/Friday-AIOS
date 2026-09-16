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
  Wallet,
  TrendingUp,
  TrendingDown,
  LayoutGrid,
  CalendarDays,
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";
import type { DashboardData } from "@/lib/data";
import { classifyMeeting } from "@/lib/timeline";
import { useHighlight } from "@/lib/highlight-context";

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

const SECTIONS = [
  { key: "financial", title: "Financial Performance", icon: DollarSign, iconBg: "#D7F6EA", iconColor: "#0E9F6E" },
  { key: "pipeline", title: "Sales & Guarantee Pipeline", icon: Target, iconBg: "#E7E4FC", iconColor: "#6E5AE0" },
  { key: "tasks", title: "Priorities & Decisions", icon: AlertCircle, iconBg: "#FBE3F0", iconColor: "#D6428E" },
  { key: "calendar", title: "This Week's Calendar", icon: CalendarClock, iconBg: "#DCEEFB", iconColor: "#2D9CDB" },
  { key: "spend", title: "Spend & Notifications", icon: Wallet, iconBg: "#FCE6DA", iconColor: "#DD7A33" },
] as const;

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

export default function CeoDashboard({ data }: { data: DashboardData }) {
  const { revenue, pipeline, tasks, calendar, spend } = data;

  const firstOverdue = tasks.find((t) => t.status === "overdue")?.id ?? null;
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [expandedTask, setExpandedTask] = useState<string | null>(firstOverdue);

  // --- Chat-driven highlight (see lib/highlight-context.tsx) --------------
  const { target } = useHighlight();
  const [glow, setGlow] = useState<Glow | null>(null);

  useEffect(() => {
    if (!target) return;
    setOpenSections((prev) => ({ ...prev, [target.section]: true }));
    // Only auto-open a task's description when exactly one task matched — with several
    // (e.g. "high priority tasks") which one to expand is ambiguous, so just glow the rows.
    if (target.section === "tasks" && target.itemIds?.length === 1) setExpandedTask(target.itemIds[0]);

    const scrollTimer = setTimeout(() => {
      document.getElementById(`section-${target.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);

    // No auto-clear timer: the glow stays until either the next question overwrites
    // it (a new `target` re-runs this effect and replaces `glow`) or the user closes
    // the section it's on (see toggleSection/toggleAll below) — not on a fixed clock.
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
    revenue.byClient.forEach((c) => {
      if (c.name.toLowerCase().includes(q))
        out.push({ section: "financial", label: c.name, sub: `${fmtUsd(c.fee)}/mo` });
    });
    pipeline.clients.forEach((c) => {
      if (c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q))
        out.push({ section: "pipeline", label: c.name, sub: c.industry });
    });
    calendar.forEach((m) => {
      if (m.name.toLowerCase().includes(q))
        out.push({ section: "calendar", label: m.name, sub: fmtDay(m.date) });
    });
    return out.slice(0, 8);
  }, [q, tasks, revenue, pipeline, calendar]);

  const jumpToSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: true }));
    setQuery("");
    setTimeout(() => {
      document
        .getElementById(`section-${key}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const daysOfWeek = useMemo(() => {
    const start = new Date(data.weekStart + "T00:00:00");
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      return {
        iso,
        meetings: calendar
          .filter((m) => m.date === iso)
          .sort((a, b) => a.time.localeCompare(b.time)),
      };
    });
  }, [data.weekStart, calendar]);

  const overdueCount = tasks.filter((t) => t.status === "overdue").length;
  const anyOpen = Object.values(openSections).some(Boolean);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => {
      const wasOpen = prev[key];
      if (wasOpen && glow?.section === key) setGlow(null); // closing the glowing section turns its glow off
      return { ...prev, [key]: !wasOpen };
    });
  };

  const toggleAll = () => {
    if (anyOpen) {
      setOpenSections({});
      setGlow(null); // collapsing everything clears any active glow too
    } else {
      setOpenSections(Object.fromEntries(SECTIONS.map((s) => [s.key, true])));
    }
  };

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
                          {SECTIONS.find((s) => s.key === r.section)?.title ?? r.section}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <button
              onClick={toggleAll}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium"
              style={{ background: "rgba(255,255,255,0.85)", border: `1px solid ${C.border}`, color: C.ink }}
            >
              {anyOpen ? "Collapse all" : "Expand all"}
              <span
                className="w-8 h-4 rounded-full relative transition-colors"
                style={{ background: anyOpen ? "#D7F6EA" : "rgba(16,24,40,0.1)" }}
              >
                <span
                  className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
                  style={{ background: anyOpen ? C.teal : C.faint, left: anyOpen ? "18px" : "2px" }}
                />
              </span>
            </button>
          </div>
        </div>

        {/* ---------------- OVERVIEW ---------------- */}
        <div
          className="rounded-2xl p-5 mb-4"
          style={{ background: "rgba(255,255,255,0.85)", border: `1px solid ${C.border}` }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#E9F9F5" }}>
              <LayoutGrid size={14} style={{ color: C.teal }} />
            </span>
            <h2 className="text-sm font-semibold">Overview</h2>
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

        {/* ---------------- COLLAPSIBLE SECTIONS ---------------- */}
        <div className="space-y-3">
          {SECTIONS.map((s) => (
            <div
              key={glow?.section === s.key ? `${s.key}-${glow.ts}` : s.key}
              id={`section-${s.key}`}
              className={`rounded-xl overflow-hidden scroll-mt-6${glow?.section === s.key ? " glow-pulse" : ""}`}
              style={{
                background: "rgba(255,255,255,0.85)",
                border: `1px solid ${C.border}`,
                ...(glow?.section === s.key ? glowProps(true, C.teal).style : {}),
              }}
            >
              <button
                onClick={() => toggleSection(s.key)}
                className="w-full flex items-center justify-between px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: s.iconBg }}>
                    <s.icon size={15} style={{ color: s.iconColor }} />
                  </span>
                  <span className="text-sm font-semibold">{s.title}</span>
                  {s.key === "tasks" && overdueCount > 0 && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: "#FDE7ED", color: C.down }}>
                      {overdueCount} overdue
                    </span>
                  )}
                  {s.key === "calendar" && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: "#E9F9F5", color: C.teal }}>
                      today
                    </span>
                  )}
                </div>
                <ChevronDown
                  size={16}
                  style={{
                    color: C.faint,
                    transform: openSections[s.key] ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                  }}
                />
              </button>

              {openSections[s.key] && (
                <div className="expand-panel px-5 pb-5 pt-1" style={{ borderTop: `1px solid ${C.border}` }}>
                  {s.key === "financial" && <FinancialContent revenue={revenue} glow={glow} />}
                  {s.key === "pipeline" && <PipelineContent clients={pipeline.clients} glow={glow} />}
                  {s.key === "tasks" && (
                    <TasksContent tasks={tasks} expandedTask={expandedTask} setExpandedTask={setExpandedTask} glow={glow} />
                  )}
                  {s.key === "calendar" && (
                    <CalendarContent daysOfWeek={daysOfWeek} today={data.today} now={data.now} glow={glow} />
                  )}
                  {s.key === "spend" && <SpendContent spend={spend} />}
                </div>
              )}
            </div>
          ))}
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

function FinancialContent({ revenue, glow }: { revenue: DashboardData["revenue"]; glow: Glow | null }) {
  const sparkData = revenue.sparkline.map((v) => ({ v }));
  return (
    <div>
      <div className="h-16 -mx-1 mb-3 mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0E9F6E" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#0E9F6E" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["dataMin - 500", "dataMax + 500"]} />
            <Area type="monotone" dataKey="v" stroke="#0E9F6E" strokeWidth={2} fill="url(#mrrFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] mb-3" style={{ color: C.faint }}>
        {revenue.sparkline.length} recorded MRR snapshot{revenue.sparkline.length === 1 ? "" : "s"}, trend fills in as more accrue.
      </p>
      <div className="space-y-2.5">
        {revenue.byClient.map((c) => {
          const isGlow = glow?.section === "financial" && !!glow.itemIds?.includes(c.id);
          const g = glowProps(isGlow, isGlow ? glowColorFor("financial", c.risk) : "");
          return (
          <div
            key={isGlow ? `${c.id}-${glow?.ts}` : c.id}
            className={`flex items-center justify-between py-1.5${g.className}`}
            style={{ borderBottom: `1px solid ${C.border}`, ...g.style }}
          >
            <div>
              <p className="text-sm font-medium">{c.name}</p>
              {c.note && <p className="text-xs" style={{ color: "#0E9F6E" }}>{c.note}</p>}
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs" style={{ color: riskOf(c.risk).color }}>{riskOf(c.risk).label}</span>
              <span
                className="text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5"
                style={{ background: `${statusOf(c.status).color}1A`, color: statusOf(c.status).color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusOf(c.status).color }} />
                {statusOf(c.status).label}
              </span>
              <span className="text-sm w-20 text-right" style={{ color: C.muted }}>{fmtUsd(c.fee)}/mo</span>
            </div>
          </div>
          );
        })}
      </div>
      {revenue.forecastNote && (
        <p className="text-xs mt-3 leading-relaxed" style={{ color: C.faint }}>{revenue.forecastNote}</p>
      )}
    </div>
  );
}

function PipelineContent({
  clients,
  glow,
}: {
  clients: DashboardData["pipeline"]["clients"];
  glow: Glow | null;
}) {
  return (
    <div className="flex gap-6 overflow-x-auto pt-3 pb-1">
      {clients.map((c) => {
        const isGlow = glow?.section === "pipeline" && !!glow.itemIds?.includes(c.id);
        return (
          <Ring
            key={isGlow ? `${c.id}-${glow?.ts}` : c.id}
            client={c}
            glow={isGlow ? glowColorFor("pipeline", c.status) : undefined}
          />
        );
      })}
    </div>
  );
}

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

function CalendarContent({
  daysOfWeek,
  today,
  now,
  glow,
}: {
  daysOfWeek: {
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
  return (
    <div className="space-y-3 pt-2">
      {daysOfWeek.map((day) => {
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
                {fmtDay(day.iso).split(",")[0]}
              </div>
              <div className="text-[11px]" style={{ color: C.faint }}>{fmtDay(day.iso).split(", ")[1]}</div>
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

function SpendContent({ spend }: { spend: DashboardData["spend"] }) {
  return (
    <div className="pt-2">
      <p className="text-sm mb-3">
        Today&rsquo;s total: <span className="font-semibold">{fmtUsd(spend.total)}</span>
      </p>
      <div className="flex flex-wrap gap-3 mb-4">
        {spend.entries.map((e, i) => (
          <span key={i} className="text-xs px-3 py-1.5 rounded-full" style={{ background: "rgba(16,24,40,0.04)", color: C.muted }}>
            {e.label} <span style={{ color: C.ink }}>{fmtUsd(e.amount)}</span>
          </span>
        ))}
      </div>
      <p className="text-xs leading-relaxed" style={{ color: C.faint }}>
        Spend tracking is mock data for a future billing connector. Replace with real figures once QuickBooks or a card feed is connected.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RING (pipeline progress)
// ---------------------------------------------------------------------------

function Ring({
  client,
  glow,
}: {
  client: DashboardData["pipeline"]["clients"][number];
  glow?: string;
}) {
  const pct = Math.min(100, Math.round((client.booked / client.target) * 100));
  const color = statusOf(client.status).color;
  const r = 30;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const g = glowProps(!!glow, glow ?? "");
  return (
    <div className={`flex flex-col items-center shrink-0 w-24 rounded-xl${g.className}`} style={g.style}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(16,24,40,0.08)" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
        />
        <text x="36" y="41" textAnchor="middle" fontSize="16" fontWeight="700" fill={C.ink}>
          {pct}%
        </text>
      </svg>
      <p className="text-xs font-medium mt-2 text-center">{client.name}</p>
      <p className="text-[11px] text-center" style={{ color: C.faint }}>
        {client.booked}/{client.target} · M{client.month}
      </p>
    </div>
  );
}
