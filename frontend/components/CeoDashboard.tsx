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
  User,
  CalendarPlus,
} from "lucide-react";
import type { DashboardData } from "@/lib/data";
import type { CrmOverview } from "@/lib/crmTypes";
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

const FOUNDER_NAME = "Paval";

// Time-of-day greeting, computed from the server-clock "now" (data.now,
// already FRIDAY_TZ-correct) rather than the browser's own Date() — keeps it
// consistent with everything else on this page that's driven by the app's
// own timezone instead of wherever the viewer happens to be.
function greetingFor(nowHHMM: string): string {
  const hour = Number(nowHHMM.split(":")[0]);
  if (hour < 12) return `Good morning, ${FOUNDER_NAME}`;
  if (hour < 17) return `Good afternoon, ${FOUNDER_NAME}`;
  return `Good evening, ${FOUNDER_NAME}`;
}

// The 2x2 grid below "Daily Brief". Financial Performance / Sales & Guarantee
// Pipeline / Spend & Notifications live on their own /crm page (see
// CrmDashboard.tsx) instead of a collapsible accordion here.
const GRID_CARDS = [
  { key: "tasks", title: "Actions", subtitle: null, icon: AlertCircle, iconBg: "#FBE3F0", iconColor: "#D6428E" },
  { key: "calendar", title: "Calendar", subtitle: null, icon: CalendarClock, iconBg: "#DCEEFB", iconColor: "#2D9CDB" },
  {
    key: "industry",
    title: "Industry Updates",
    subtitle: "Latest news and trends shaping the industry",
    icon: FileText,
    iconBg: "#DCEEFB",
    iconColor: "#2D9CDB",
  },
  {
    key: "meetings",
    title: "Meeting Summary",
    subtitle: "Key meetings and important takeaways",
    icon: FileText,
    iconBg: "#EAE9FE",
    iconColor: "#6D5BD0",
  },
] as const;

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

export default function CeoDashboard({ data }: { data: DashboardData }) {
  const { tasks, calendar, meetingSummaries } = data;

  // Daily Brief's revenue/pipeline/conversion tiles are real Pipedrive data
  // (see backend/app/crm_metrics.py via GET /api/crm), fetched client-side —
  // same self-contained-widget pattern as IndustryUpdates/UrgentEmails —
  // rather than the mock revenue.json/pipeline.json this used to read.
  const [crm, setCrm] = useState<CrmOverview | null>(null);
  const [crmLoading, setCrmLoading] = useState(true);

  useEffect(() => {
    fetch("/api/crm?range=month", { cache: "no-store" })
      .then((res) => res.json())
      .then(setCrm)
      .catch(() => setCrm({ configured: false, message: "Could not reach the Friday backend." }))
      .finally(() => setCrmLoading(false));
  }, []);

  // Open by default — Quick Access stays expanded; clicking a card's header
  // still toggles it closed if the user wants to collapse it.
  const [gridOpen, setGridOpen] = useState<Record<string, boolean>>({
    tasks: true,
    calendar: true,
    industry: true,
    meetings: true,
  });
  const toggleGridCard = (key: string) => setGridOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  // --- Chat-driven highlight (see lib/highlight-context.tsx) --------------
  const { target } = useHighlight();
  const [glow, setGlow] = useState<Glow | null>(null);

  useEffect(() => {
    if (!target) return;
    setGridOpen((prev) => ({ ...prev, [target.section]: true }));

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
            <h1 className="text-2xl font-bold">{greetingFor(data.now)}</h1>
            <p className="text-sm mt-0.5" style={{ color: C.muted }}>
              CEO Dashboard · Strategic overview for BookMySales · {fmtFullDay(data.today)}
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
              label="Won Revenue (This Month)"
              value={crmLoading ? "—" : crm?.configured ? fmtUsd(crm.kpis!.won_revenue) : "N/A"}
              trendPct={crm?.configured ? crm.kpis!.revenue_growth_pct : null}
              neutral={!crm?.configured || crm.kpis!.revenue_growth_pct === null}
              trendLabel={crm?.configured ? "vs last month" : crm?.message ?? "Pipedrive not connected"}
              positive
              glow={glow?.section === "financial" ? C.teal : undefined}
            />
            <OverviewTile
              tile={TILE.deals}
              icon={Target}
              label="Open Pipeline"
              value={crmLoading ? "—" : crm?.configured ? fmtUsd(crm.kpis!.open_pipeline_value) : "N/A"}
              trendPct={null}
              neutral
              trendLabel={
                crm?.configured
                  ? `${crm.pipeline?.total_open_count ?? 0} open deal${crm.pipeline?.total_open_count === 1 ? "" : "s"}`
                  : crm?.message ?? "Pipedrive not connected"
              }
              positive
            />
            <OverviewTile
              key={glow?.section === "pipeline" ? `guarantee-${glow.ts}` : "guarantee"}
              tile={TILE.retention}
              icon={TrendingUp}
              label="Conversion Rate"
              value={
                crmLoading
                  ? "—"
                  : !crm?.configured
                  ? "N/A"
                  : crm.kpis!.conversion_rate_pct === null
                  ? "N/A"
                  : `${crm.kpis!.conversion_rate_pct}%`
              }
              trendPct={null}
              neutral
              trendLabel={
                crm?.configured ? (
                  crm.conversion ? (
                    <>
                      <span style={{ color: C.up, fontWeight: 600 }}>{crm.conversion.won_count} won</span>
                      {" / "}
                      <span style={{ color: C.down, fontWeight: 600 }}>{crm.conversion.lost_count} lost</span>
                    </>
                  ) : (
                    "no deals won or lost yet this month"
                  )
                ) : (
                  crm?.message ?? "Pipedrive not connected"
                )
              }
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
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.iconBg }}>
                    <c.icon size={15} style={{ color: c.iconColor }} />
                  </span>
                  <div className="flex flex-col items-start">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{c.title}</span>
                    </div>
                    {c.subtitle && (
                      <span className="text-xs" style={{ color: C.faint }}>{c.subtitle}</span>
                    )}
                  </div>
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
                <div
                  className="expand-panel px-5 pb-5 pt-1 overflow-y-auto"
                  style={{ borderTop: `1px solid ${C.border}`, maxHeight: 420 }}
                >
                  {c.key === "tasks" && <UrgentEmails />}
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
  trendLabel: React.ReactNode;
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

  // Only "today" gets the special "Today" label — every other day in the
  // window (including tomorrow) just shows its actual weekday + date.
  const dayLabel = (iso: string): { top: string; bottom: string } => {
    const datePart = fmtDay(iso).split(", ")[1]; // e.g. "Sep 18"
    if (iso === today) return { top: "Today", bottom: datePart };
    return { top: fmtDay(iso).split(",")[0], bottom: datePart };
  };

  return (
    <div className="flex flex-col gap-3 pt-2 max-h-56 overflow-y-auto">
      {daysNext3.map((day) => {
        const isToday = day.iso === today;
        const statuses = day.meetings.map(
          (m) => classifyMeeting(day.iso, m.time, m.durationMin, nowDate).status
        );
        // The first still-upcoming meeting today is the "next" one.
        const nextIdx = isToday ? statuses.indexOf("upcoming") : -1;
        return (
          <div key={day.iso}>
            <div className="flex items-baseline gap-1.5 mb-1.5">
              <span className="text-xs font-semibold" style={{ color: isToday ? C.teal : C.ink }}>
                {dayLabel(day.iso).top}
              </span>
              <span className="text-[11px]" style={{ color: C.faint }}>{dayLabel(day.iso).bottom}</span>
            </div>
            {day.meetings.length === 0 ? (
              <div className="text-xs pb-1" style={{ color: C.faint }}>No meetings</div>
            ) : (
              <div className="flex flex-col gap-2">
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
                      className={`rounded-lg px-3 py-2.5${g.className}`}
                      style={{ background: "#EFF6FD", border: "1px solid #D7E3F7", opacity: done ? 0.55 : 1, ...g.style }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: pStyle.color }} />
                          <span
                            className="text-sm font-medium truncate"
                            style={{
                              color: m.priority === "critical" ? C.down : C.ink,
                              textDecoration: done ? "line-through" : "none",
                            }}
                          >
                            {m.name}
                          </span>
                        </div>
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
                      <p className="text-xs mt-1" style={{ color: C.faint }}>
                        {to12h(m.time)}
                        {done && " · done"}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
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
// Fathom's own bullet text often already starts with its own "Goal:"/
// "Objective:" label (e.g. "- **Goal:** Use AI to..."); that leading label is
// stripped here so the card's own "Goal:" heading isn't duplicated
// ("Goal: Goal: Use AI to...").
const LEADING_LABEL_RE = /^(goal|objective|takeaway|summary)\s*:\s*/i;

function extractFirstBullet(markdown: string | null): string | null {
  if (!markdown) return null;
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (m) {
      return m[1]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(LEADING_LABEL_RE, "")
        .trim();
    }
  }
  return null;
}

function MeetingSummariesContent({ summaries }: { summaries: DashboardData["meetingSummaries"] }) {
  // Optimistic local overlay for due dates set via the PATCH below, keyed by
  // "recordingId:index" — avoids re-fetching all meeting summaries just to
  // reflect one saved date.
  const [dueDateOverrides, setDueDateOverrides] = useState<Record<string, string | null>>({});

  if (summaries.length === 0) {
    return (
      <p className="text-xs leading-relaxed" style={{ color: C.faint }}>
        No meeting summaries yet. These appear automatically once Fathom finishes processing a recorded meeting.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
      {summaries.map((m) => {
        const takeaway = extractFirstBullet(m.summary_markdown);
        const action = m.action_items[0] ?? null;
        const overrideKey = `${m.recording_id}:0`;
        const dueDate = overrideKey in dueDateOverrides ? dueDateOverrides[overrideKey] : action?.due_date ?? null;
        return (
          <div
            key={m.recording_id}
            className="rounded-lg px-3 py-2.5"
            style={{ background: "#F5F3FE", border: "1px solid #E7E2FB" }}
          >
            <p className="text-sm font-medium leading-snug">{m.title}</p>
            <p className="text-xs mt-0.5" style={{ color: C.faint }}>
              {m.started_at ? fmtDay(m.started_at.slice(0, 10)) : fmtDay(m.received_at.slice(0, 10))}
            </p>
            {takeaway && (
              <p className="text-xs mt-1.5 leading-snug" style={{ color: C.muted }}>
                <span className="font-medium" style={{ color: C.ink }}>Goal:</span> {takeaway}
              </p>
            )}
            {action && (
              <div className="text-xs mt-1 leading-snug" style={{ color: C.muted }}>
                <p>
                  <span className="font-medium" style={{ color: C.ink }}>Action:</span> {action.text}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                  {action.owner && (
                    <span className="inline-flex items-center gap-1" style={{ color: C.faint }}>
                      <User size={11} />
                      {action.owner}
                    </span>
                  )}
                  <ActionItemDueDate
                    recordingId={m.recording_id}
                    index={0}
                    dueDate={dueDate}
                    onSaved={(next) => setDueDateOverrides((prev) => ({ ...prev, [overrideKey]: next }))}
                  />
                </div>
              </div>
            )}
            {m.meeting_url && (
              <a
                href={m.meeting_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs mt-2 font-medium"
                style={{ color: "#6D5BD0" }}
              >
                Watch recording <ExternalLink size={11} />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Fathom never provides a due date for an action item (its schema has no
// such field) — this is the CEO's own manual tracking, saved via
// PATCH /api/meeting-summaries/{id}/action-items/{index}. Real, editable
// data the CEO enters, never a value invented from Fathom's own content.
function ActionItemDueDate({
  recordingId,
  index,
  dueDate,
  onSaved,
}: {
  recordingId: string;
  index: number;
  dueDate: string | null;
  onSaved: (dueDate: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(dueDate ?? "");

  async function save(value: string | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/meeting-summaries/${recordingId}/action-items/${index}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ due_date: value }),
      });
      if (res.ok) {
        onSaved(value);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="text-[11px] rounded border px-1 py-0.5"
          style={{ borderColor: C.border, color: C.ink }}
          disabled={saving}
          autoFocus
        />
        <button
          onClick={() => save(draft || null)}
          disabled={saving || !draft}
          className="text-[11px] font-medium disabled:opacity-40"
          style={{ color: "#6D5BD0" }}
        >
          Save
        </button>
        <button onClick={() => setEditing(false)} disabled={saving} className="text-[11px]" style={{ color: C.faint }}>
          Cancel
        </button>
      </span>
    );
  }

  if (dueDate) {
    return (
      <button
        onClick={() => {
          setDraft(dueDate);
          setEditing(true);
        }}
        className="inline-flex items-center gap-1 hover:underline"
        style={{ color: C.faint }}
      >
        <CalendarPlus size={11} />
        Due {fmtDay(dueDate)}
      </button>
    );
  }

  return (
    <button
      onClick={() => {
        setDraft("");
        setEditing(true);
      }}
      className="inline-flex items-center gap-1 hover:underline"
      style={{ color: C.faint }}
    >
      <CalendarPlus size={11} />
      Add due date
    </button>
  );
}

