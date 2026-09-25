"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  X,
  ChevronDown,
  AlertCircle,
  CalendarClock,
  TrendingUp,
  TrendingDown,
  LayoutGrid,
  FileText,
  ExternalLink,
  User,
  CalendarPlus,
} from "lucide-react";
import type { DashboardData } from "@/lib/data";
import type { CrmOverview } from "@/lib/crmTypes";
import { classifyMeeting } from "@/lib/timeline";
import { useHighlight } from "@/lib/highlight-context";
import { C, PAGE_BG, CARD_BG, statusOf, riskOf, priorityOf } from "@/lib/dashboardTokens";
import UrgentEmails from "./UrgentEmails";
import IndustryUpdates from "./IndustryUpdates";

// ---------------------------------------------------------------------------
// TOKENS — shared light palette from lib/dashboardTokens for page/card
// background and body text. ACCENT_* stay local to this file (not written
// into dashboardTokens.ts) since this blue-header color format is specific
// to the Dashboard page only — CRM/Goals/Company/Tasks/Profile keep their
// existing look.
// ---------------------------------------------------------------------------

const ACCENT_BLUE = "#2563EB";
const ACCENT_UP = "#16A34A";
const ACCENT_DOWN = "#DC2626";

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
  { key: "tasks", title: "Actions", subtitle: null, icon: AlertCircle, iconBg: "rgba(239,107,107,0.12)", iconColor: "#EF6B6B" },
  { key: "calendar", title: "Calendar", subtitle: null, icon: CalendarClock, iconBg: "rgba(59,130,246,0.12)", iconColor: "#3B82F6" },
  {
    key: "industry",
    title: "Industry Updates",
    subtitle: "Latest news and trends shaping the industry",
    icon: FileText,
    iconBg: "rgba(59,130,246,0.12)",
    iconColor: "#3B82F6",
  },
  {
    key: "meetings",
    title: "Meeting Summary",
    subtitle: "Key meetings and important takeaways",
    icon: FileText,
    iconBg: "rgba(139,92,246,0.12)",
    iconColor: "#8B5CF6",
  },
] as const;

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

export default function CeoDashboard({ data }: { data: DashboardData }) {
  const { tasks, calendar, meetingSummaries } = data;

  // Daily Brief's revenue/pipeline/conversion tiles are real HubSpot data
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

  // Monthly revenue target (see backend/app/main.py's /settings/revenue-target)
  // for the Revenue card's "% of target" badge + progress bar. Falls back to
  // `crm.revenue_target` (also returned inline on the CRM overview response)
  // if this separate fetch fails, so one flaky request doesn't blank the badge.
  const [revenueTarget, setRevenueTarget] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/settings/revenue-target", { cache: "no-store" })
      .then((res) => res.json())
      .then((d) => setRevenueTarget(typeof d.target === "number" ? d.target : null))
      .catch(() => setRevenueTarget(null));
  }, []);

  const effectiveRevenueTarget = revenueTarget ?? crm?.revenue_target ?? null;

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
        background: PAGE_BG,
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
                style={{ background: CARD_BG, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}
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
                    background: CARD_BG,
                    border: `1px solid ${C.border}`,
                    boxShadow: "0 12px 32px -12px rgba(0,0,0,0.5)",
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
                        className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50"
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
          style={{ background: CARD_BG, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(14,165,233,0.12)" }}>
              <LayoutGrid size={14} style={{ color: C.teal }} />
            </span>
            <h2 className="text-sm font-semibold">Daily Brief</h2>
          </div>

          <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-gray-200">
            {/* Card 1: New Qualified Leads — real data from HubSpot Contacts
                (see crm_metrics.build_qualified_leads / hubspot_client.get_leads),
                not the Deals pipeline */}
            <BriefTile
              label="New Qualified Leads"
              value={
                crmLoading
                  ? "—"
                  : !crm?.configured || crm.qualified_leads?.count_this_month == null
                  ? "N/A"
                  : String(crm.qualified_leads.count_this_month)
              }
              badge={
                crm?.configured && crm.qualified_leads?.pct_change_vs_last_month != null
                  ? {
                      text: `${crm.qualified_leads.pct_change_vs_last_month}%`,
                      positive: crm.qualified_leads.pct_change_vs_last_month >= 0,
                    }
                  : undefined
              }
              smallLabel={crm?.configured && crm.qualified_leads?.pct_change_vs_last_month != null ? "vs last month" : undefined}
              subtext={
                crm?.configured
                  ? [
                      crm.qualified_leads?.awaiting_first_contact != null
                        ? `${crm.qualified_leads.awaiting_first_contact} awaiting first contact`
                        : "No leads data available",
                    ]
                  : [crm?.message ?? "HubSpot not connected"]
              }
            />

            {/* Card 2: Open Sales Pipeline — real HubSpot data */}
            <BriefTile
              label="Open Sales Pipeline"
              value={crmLoading ? "—" : crm?.configured ? fmtUsd(crm.kpis!.open_pipeline_value) : "N/A"}
              subtext={
                crm?.configured
                  ? [
                      `${crm.pipeline?.total_open_count ?? 0} active opportunit${crm.pipeline?.total_open_count === 1 ? "y" : "ies"} · ${fmtUsd(crm.pipeline?.closing_this_month_value ?? 0)} expected to close this month`,
                    ]
                  : [crm?.message ?? "HubSpot not connected"]
              }
            />

            {/* Card 3: Deal Win Rate — real HubSpot data, trailing window (see WIN_RATE_WINDOW_DAYS) */}
            <BriefTile
              key={glow?.section === "pipeline" ? `winrate-${glow.ts}` : "winrate"}
              label="Deal Win Rate"
              value={
                crmLoading
                  ? "—"
                  : !crm?.configured
                  ? "N/A"
                  : crm.win_rate?.rate_pct == null
                  ? "N/A"
                  : `${crm.win_rate.rate_pct}%`
              }
              smallLabel={crm?.configured && crm.win_rate ? `Last ${crm.win_rate.window_days} days` : undefined}
              subtext={
                crm?.configured
                  ? [
                      crm.win_rate && crm.win_rate.closed_count > 0
                        ? `${crm.win_rate.won_count} won out of ${crm.win_rate.closed_count} closed deals`
                        : "no deals closed in this window yet",
                    ]
                  : [crm?.message ?? "HubSpot not connected"]
              }
              glow={glow?.section === "pipeline" ? C.teal : undefined}
            />

            {/* Card 4: Revenue Achieved This Month — real HubSpot data + configurable target */}
            <BriefTile
              key={glow?.section === "financial" ? `revenue-${glow.ts}` : "revenue"}
              label="Revenue Achieved This Month"
              value={crmLoading ? "—" : crm?.configured ? fmtUsd(crm.kpis!.won_revenue) : "N/A"}
              badge={
                crm?.configured && effectiveRevenueTarget
                  ? {
                      text: `${Math.round((crm.kpis!.won_revenue / effectiveRevenueTarget) * 100)}% of ${fmtUsd(effectiveRevenueTarget)} target`,
                      positive: crm.kpis!.won_revenue >= effectiveRevenueTarget,
                    }
                  : undefined
              }
              progressPct={
                crm?.configured && effectiveRevenueTarget
                  ? Math.min(100, (crm.kpis!.won_revenue / effectiveRevenueTarget) * 100)
                  : undefined
              }
              subtext={
                crm?.configured
                  ? effectiveRevenueTarget
                    ? [
                        crm.kpis!.won_revenue >= effectiveRevenueTarget
                          ? "Target reached"
                          : `${fmtUsd(effectiveRevenueTarget - crm.kpis!.won_revenue)} remaining to target`,
                      ]
                    : ["No revenue target set"]
                  : [crm?.message ?? "HubSpot not connected"]
              }
              glow={glow?.section === "financial" ? C.teal : undefined}
            />
          </div>

        </div>

        {/* ---------------- QUICK ACCESS: Actions | Calendar / Industry Updates | Meeting Summary ---------------- */}
        <div
          className="rounded-2xl p-5 mb-4"
          style={{ background: CARD_BG, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(14,165,233,0.12)" }}>
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
                  background: CARD_BG,
                  border: `1px solid ${C.border}`,
                  ...(glow?.section === c.key ? glowProps(true, C.teal).style : {}),
                }}
              >
              <button
                onClick={() => toggleGridCard(c.key)}
                className="w-full flex items-center justify-between px-5 py-3.5"
                style={{ background: ACCENT_BLUE }}
              >
                <div className="flex items-center gap-3">
                  <c.icon size={16} className="text-white shrink-0" />
                  <div className="flex flex-col items-start">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{c.title}</span>
                    </div>
                    {c.subtitle && (
                      <span className="text-[11px] text-white/75">{c.subtitle}</span>
                    )}
                  </div>
                </div>
                <ChevronDown
                  size={16}
                  className="text-white"
                  style={{
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
// BRIEF TILE — the 4 Daily Brief cards (New Qualified Leads, Open Sales
// Pipeline, Deal Win Rate, Revenue Achieved This Month). Icon top-right,
// label top-left, big metric, optional %-change badge (green/red + arrow),
// optional progress bar (Revenue card only), and 1-2 lines of muted subtext.
// ---------------------------------------------------------------------------

function BriefTile({
  label,
  value,
  smallLabel,
  badge,
  subtext,
  progressPct,
  glow,
}: {
  label: string;
  value: string;
  smallLabel?: string;
  badge?: { text: string; positive: boolean };
  subtext: React.ReactNode[];
  progressPct?: number;
  glow?: string;
}) {
  const g = glowProps(!!glow, glow ?? "");
  return (
    <div className={`flex-1 min-w-0 px-5 py-1 first:pl-0 last:pr-0${g.className}`} style={g.style}>
      <p className="text-xs font-medium mb-2" style={{ color: ACCENT_BLUE }}>{label}</p>

      <p className="text-2xl font-bold" style={{ color: C.ink }}>{value}</p>

      {badge && (
        <p
          className="inline-flex items-center gap-1 text-xs font-medium mt-1"
          style={{ color: badge.positive ? ACCENT_UP : ACCENT_DOWN }}
        >
          {badge.positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {badge.text}
        </p>
      )}
      {smallLabel && (
        <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{smallLabel}</p>
      )}

      {progressPct !== undefined && (
        <div className="w-full h-1.5 rounded-full mt-2 mb-1 overflow-hidden" style={{ background: "#E5E7EB" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(0, Math.min(100, progressPct))}%`, background: ACCENT_UP }}
          />
        </div>
      )}

      <div className="mt-1.5 flex flex-col gap-0.5">
        {subtext.map((line, i) => (
          <p key={i} className="text-xs" style={{ color: C.muted }}>{line}</p>
        ))}
      </div>
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
              <span className="text-xs font-semibold" style={{ color: isToday ? ACCENT_BLUE : C.ink }}>
                {dayLabel(day.iso).top}
              </span>
              <span className="text-[11px]" style={{ color: C.faint }}>{dayLabel(day.iso).bottom}</span>
            </div>
            {day.meetings.length === 0 ? (
              <div className="text-xs pb-1" style={{ color: C.faint }}>No meetings</div>
            ) : (
              <div className="flex flex-col">
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
                      className={`py-2 border-b border-gray-100 last:border-b-0${g.className}`}
                      style={{ opacity: done ? 0.55 : 1, ...g.style }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: pStyle.color }} />
                          <span
                            className="text-sm font-semibold truncate"
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
                            style={{ background: "#FEE2E2", color: C.down }}
                          >
                            now
                          </span>
                        )}
                        {isNext && !live && (
                          <span
                            className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(37,99,235,0.1)", color: ACCENT_BLUE }}
                          >
                            next
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: C.faint }}>
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
    <div className="flex flex-col max-h-56 overflow-y-auto">
      {summaries.map((m) => {
        const takeaway = extractFirstBullet(m.summary_markdown);
        const action = m.action_items[0] ?? null;
        const overrideKey = `${m.recording_id}:0`;
        const dueDate = overrideKey in dueDateOverrides ? dueDateOverrides[overrideKey] : action?.due_date ?? null;
        return (
          <div
            key={m.recording_id}
            className="py-2.5 border-b border-gray-100 last:border-b-0"
          >
            <p className="text-sm font-semibold leading-snug text-slate-900">{m.title}</p>
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
                style={{ color: ACCENT_BLUE }}
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
          style={{ borderColor: C.border, color: C.ink, background: CARD_BG, colorScheme: "light" }}
          disabled={saving}
          autoFocus
        />
        <button
          onClick={() => save(draft || null)}
          disabled={saving || !draft}
          className="text-[11px] font-medium disabled:opacity-40"
          style={{ color: ACCENT_BLUE }}
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

  // No due date set and it wasn't mentioned/entered — show nothing rather
  // than an "Add due date" prompt every action item would otherwise carry.
  return null;
}

