"use client";

// The CRM page (/crm) — a CEO-facing view built entirely from live Pipedrive
// data (backend/app/crm_metrics.py via GET /api/crm -> backend's
// /crm/overview). Self-contained client widget, same convention as
// IndustryUpdates.tsx/UrgentEmails.tsx: fetches its own data rather than
// going through lib/data.ts, so this stays fully isolated from the existing
// mock-data dashboard plumbing.
//
// Every number rendered here traces back to a specific Pipedrive field —
// see crm_metrics.py's per-function docstrings for the exact calculation.
// Metrics Pipedrive can't support (e.g. forecast with no probability set)
// come back as null from the backend and are rendered as "Not available"
// rather than a fabricated 0 — never silently coerced to zero here either.

import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  CheckCircle2,
  Percent,
  Clock,
  Users,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { C, PAGE_BG, CARD_BG, fmtFullDay } from "@/lib/dashboardTokens";
import type { CrmOverview, DateRangeKey, TrendPeriod, DealRow } from "@/lib/crmTypes";

const STAGE_COLORS = ["#38BDF8", "#A78BFA", "#34D399", "#FBBF24", "#F87171", "#22D3EE", "#FB923C"];

const RANGE_OPTIONS: { key: DateRangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "quarter", label: "This Quarter" },
  { key: "year", label: "This Year" },
  { key: "custom", label: "Custom Range" },
];

const TREND_OPTIONS: { key: TrendPeriod; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

function fmtCurrency(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number | null | undefined) {
  if (n === null || n === undefined) return null;
  return `${n > 0 ? "+" : ""}${n}%`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function CrmDashboard({ today }: { today: string }) {
  const [range, setRange] = useState<DateRangeKey>("month");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("30d");
  const [data, setData] = useState<CrmOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedDeal, setExpandedDeal] = useState<number | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ range, trend_period: trendPeriod });
    if (range === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    return params.toString();
  }, [range, trendPeriod, customStart, customEnd]);

  async function load() {
    try {
      const res = await fetch(`/api/crm?${query}`, { cache: "no-store" });
      const json = await res.json();
      setData(json);
    } catch {
      setData({ configured: false, message: "Could not reach the Friday backend." });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function handleRefresh() {
    setRefreshing(true);
    load();
  }

  return (
    <div
      style={{
        minHeight: "100%",
        fontFamily: "'Inter', system-ui, sans-serif",
        color: C.ink,
        background: `linear-gradient(135deg, ${PAGE_BG} 0%, #0D1526 50%, ${PAGE_BG} 100%)`,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');`}</style>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header: greeting + global date filter */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold">CRM</h1>
            <p className="text-sm mt-0.5" style={{ color: C.muted }}>
              Pipedrive-powered CEO view · {fmtFullDay(today)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {range === "custom" && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="text-xs px-2.5 py-2 rounded-lg"
                  style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.ink, colorScheme: "dark" }}
                />
                <span className="text-xs" style={{ color: C.faint }}>to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="text-xs px-2.5 py-2 rounded-lg"
                  style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.ink, colorScheme: "dark" }}
                />
              </div>
            )}
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as DateRangeKey)}
              className="text-xs font-medium px-3 py-2 rounded-lg"
              style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.ink }}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.muted }}
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl px-5 py-10 text-sm text-center" style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.faint }}>
            Loading CRM data…
          </div>
        ) : !data?.configured ? (
          <div className="rounded-xl px-5 py-8 text-sm text-center" style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.faint }}>
            {data?.message ?? "Pipedrive is not configured."}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <KpiRow data={data} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <RevenueTrendCard
                  data={data}
                  trendPeriod={trendPeriod}
                  onTrendPeriodChange={setTrendPeriod}
                />
              </div>
              <DealsByStageCard data={data} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PipelineByStageCard data={data} />
              <WonVsLostCard data={data} />
            </div>

            <ForecastCard data={data} />

            <TopDealsCard data={data} expandedDeal={expandedDeal} setExpandedDeal={setExpandedDeal} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ActivitiesCard data={data} />
              <ContactsCard data={data} />
            </div>

            <RisksCard data={data} />

            <LimitationsCard data={data} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI CARDS
// ---------------------------------------------------------------------------

function KpiRow({ data }: { data: CrmOverview }) {
  const k = data.kpis!;
  const trendPoints = data.revenue_trend?.points ?? [];

  const cards = [
    {
      label: "Won Revenue",
      value: fmtCurrency(k.won_revenue),
      change: fmtPct(k.revenue_growth_pct),
      icon: DollarSign,
      bg: "#0F2E2A",
      fg: "#34D399",
      spark: trendPoints,
    },
    {
      label: "Open Pipeline",
      value: fmtCurrency(k.open_pipeline_value),
      change: null,
      icon: Target,
      bg: "#241A4A",
      fg: "#A78BFA",
    },
    {
      label: "Deals Won",
      value: String(k.deals_won),
      change: null,
      icon: CheckCircle2,
      bg: "#0C2038",
      fg: "#38BDF8",
    },
    {
      label: "Conversion Rate",
      value: k.conversion_rate_pct === null ? "Not available" : `${k.conversion_rate_pct}%`,
      change: null,
      icon: Percent,
      bg: "#3D1F0C",
      fg: "#FB923C",
    },
    {
      label: "Activities Due",
      value: String(k.activities_due),
      change: null,
      icon: Clock,
      bg: "#3F1233",
      fg: "#F472B6",
    },
    {
      label: "New Contacts",
      value: String(k.new_contacts),
      change: null,
      icon: Users,
      bg: "#1A2E12",
      fg: "#84CC16",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl p-4 flex flex-col gap-2"
          style={{ background: CARD_BG, border: `1px solid ${C.border}` }}
        >
          <div className="flex items-center justify-between">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.bg }}>
              <c.icon size={14} style={{ color: c.fg }} />
            </span>
            {c.change && (
              <span
                className="flex items-center gap-0.5 text-[11px] font-medium"
                style={{ color: c.change.startsWith("+") ? C.up : C.down }}
              >
                {c.change.startsWith("+") ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {c.change}
              </span>
            )}
          </div>
          <div>
            <p className="text-lg font-bold leading-tight">{c.value}</p>
            <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{c.label}</p>
          </div>
          {c.spark && c.spark.length > 1 && (
            <div className="h-8 -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={c.spark} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="kpiSpark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c.fg} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={c.fg} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="value" stroke={c.fg} strokeWidth={1.5} fill="url(#kpiSpark)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CARD SHELL
// ---------------------------------------------------------------------------

function ChartCard({
  title, subtitle, right, children,
}: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-5 h-full" style={{ background: CARD_BG, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-[11px]" style={{ color: C.faint }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CHARTS
// ---------------------------------------------------------------------------

function RevenueTrendCard({
  data, trendPeriod, onTrendPeriodChange,
}: { data: CrmOverview; trendPeriod: TrendPeriod; onTrendPeriodChange: (p: TrendPeriod) => void }) {
  const points = data.revenue_trend?.points ?? [];
  return (
    <ChartCard
      title="Revenue Trend"
      subtitle="Won deal value over time"
      right={
        <select
          value={trendPeriod}
          onChange={(e) => onTrendPeriodChange(e.target.value as TrendPeriod)}
          className="text-[11px] font-medium px-2 py-1.5 rounded-lg"
          style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, color: C.muted }}
        >
          {TREND_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      }
    >
      {points.every((p) => p.value === 0) ? (
        <EmptyChart label="No won-deal revenue recorded in this window yet." />
      ) : (
        <div className="h-56 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="revTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34D399" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.faint }} tickFormatter={fmtDate} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => fmtCurrency(v)} />
              <Tooltip formatter={(v) => fmtCurrency(Number(v))} labelFormatter={(l) => fmtDate(String(l))} />
              <Area type="monotone" dataKey="value" stroke="#34D399" strokeWidth={2} fill="url(#revTrendFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function PipelineByStageCard({ data }: { data: CrmOverview }) {
  const rows = data.pipeline?.by_stage ?? [];
  return (
    <ChartCard title="Sales Pipeline" subtitle="Open deal value by stage">
      {rows.length === 0 ? (
        <EmptyChart label="No open deals in the pipeline." />
      ) : (
        <div className="h-56 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="stage_name" tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => fmtCurrency(v)} />
              <Tooltip formatter={(v) => fmtCurrency(Number(v))} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {rows.map((_, i) => (
                  <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function DealsByStageCard({ data }: { data: CrmOverview }) {
  const rows = data.deals_by_stage ?? [];
  return (
    <ChartCard title="Deals by Stage" subtitle="Open deal count distribution">
      {rows.length === 0 ? (
        <EmptyChart label="No open deals." />
      ) : (
        <div className="h-56 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows} dataKey="count" nameKey="stage_name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                {rows.map((_, i) => (
                  <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v, _n, entry) => [`${v} deals`, (entry?.payload as { stage_name?: string })?.stage_name ?? ""]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function WonVsLostCard({ data }: { data: CrmOverview }) {
  const rows = data.won_vs_lost ?? [];
  return (
    <ChartCard title="Won vs Lost" subtitle="Deal value closed per month, in the selected range">
      {rows.length === 0 ? (
        <EmptyChart label="No deals won or lost in this range." />
      ) : (
        <div className="h-56 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => fmtCurrency(v)} />
              <Tooltip formatter={(v) => fmtCurrency(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="won_value" name="Won" fill="#34D399" radius={[6, 6, 0, 0]} />
              <Bar dataKey="lost_value" name="Lost" fill="#F87171" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-40 flex items-center justify-center text-xs text-center px-6" style={{ color: C.faint }}>
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FORECAST
// ---------------------------------------------------------------------------

function ForecastCard({ data }: { data: CrmOverview }) {
  const f = data.forecast;
  return (
    <div className="rounded-xl p-5" style={{ background: CARD_BG, border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2 mb-1">
        <Target size={14} style={{ color: "#A78BFA" }} />
        <h3 className="text-sm font-semibold">Sales Forecast</h3>
      </div>
      {f ? (
        <>
          <p className="text-xl font-bold">{fmtCurrency(f.forecast_value)}</p>
          <p className="text-[11px] mt-1" style={{ color: C.faint }}>
            Weighted by deal/stage win probability · {f.included_deal_count} deal{f.included_deal_count === 1 ? "" : "s"} included
            {f.excluded_no_probability_count > 0 && `, ${f.excluded_no_probability_count} excluded (no probability set)`}
          </p>
        </>
      ) : (
        <p className="text-sm" style={{ color: C.faint }}>
          Not available — no open deals in this range have a probability set on the deal or its Pipedrive stage.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TOP DEALS TABLE
// ---------------------------------------------------------------------------

function TopDealsCard({
  data, expandedDeal, setExpandedDeal,
}: { data: CrmOverview; expandedDeal: number | null; setExpandedDeal: (id: number | null) => void }) {
  const deals = data.top_deals ?? [];
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${C.border}` }}>
      <div className="px-5 py-4">
        <h3 className="text-sm font-semibold">Top Open Deals</h3>
        <p className="text-[11px]" style={{ color: C.faint }}>Ranked by value, highest first</p>
      </div>
      {deals.length === 0 ? (
        <p className="text-sm px-5 pb-5" style={{ color: C.faint }}>No open deals.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
                {["Deal", "Company", "Value", "Stage", "Expected Close", "Owner", "Last Activity", "Next Activity"].map((h) => (
                  <th key={h} className="text-left font-medium px-5 py-2 text-[11px] whitespace-nowrap" style={{ color: C.faint }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <DealRowItem key={d.id} deal={d} expanded={expandedDeal === d.id} onToggle={() => setExpandedDeal(expandedDeal === d.id ? null : d.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DealRowItem({ deal, expanded, onToggle }: { deal: DealRow; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer hover:bg-black/[0.02]"
        style={{ borderBottom: expanded ? "none" : `1px solid ${C.border}` }}
      >
        <td className="px-5 py-2.5 font-medium whitespace-nowrap flex items-center gap-1.5">
          {expanded ? <ChevronDown size={13} style={{ color: C.faint }} /> : <ChevronRight size={13} style={{ color: C.faint }} />}
          {deal.name ?? "—"}
        </td>
        <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: C.muted }}>{deal.company ?? "—"}</td>
        <td className="px-5 py-2.5 whitespace-nowrap font-medium">
          {deal.value !== null ? `${deal.currency ?? ""} ${deal.value.toLocaleString("en-US")}`.trim() : "—"}
        </td>
        <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: C.muted }}>{deal.stage_name ?? "—"}</td>
        <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: C.muted }}>{fmtDate(deal.expected_close_date)}</td>
        <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: C.muted }}>{deal.owner ?? "—"}</td>
        <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: C.muted }}>{fmtDate(deal.last_activity_date)}</td>
        <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: C.muted }}>{fmtDate(deal.next_activity_date)}</td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
          <td colSpan={8} className="px-5 pb-3 pt-0">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs pl-5" style={{ color: C.muted }}>
              <span>Probability: {deal.probability !== null ? `${deal.probability}%` : "Not set"}</span>
              <span>Age: {deal.age_days !== null ? `${deal.age_days} days` : "—"}</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ACTIVITIES
// ---------------------------------------------------------------------------

function ActivitiesCard({ data }: { data: CrmOverview }) {
  const a = data.activities;
  if (!a) return null;
  return (
    <div className="rounded-xl p-5" style={{ background: CARD_BG, border: `1px solid ${C.border}` }}>
      <h3 className="text-sm font-semibold mb-3">Activities</h3>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <ActivityStat label="Overdue" value={a.overdue_count} color={C.down} />
        <ActivityStat label="Due Today" value={a.due_today_count} color="#FBBF24" />
        <ActivityStat label="Upcoming" value={a.upcoming_count} color="#38BDF8" />
      </div>
      {Object.keys(a.by_type).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {Object.entries(a.by_type).map(([type, count]) => (
            <span key={type} className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: C.muted }}>
              {type} <span style={{ color: C.ink, fontWeight: 600 }}>{count}</span>
            </span>
          ))}
        </div>
      )}
      {a.recent.length > 0 ? (
        <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
          {a.recent.slice(0, 8).map((act) => (
            <div key={act.id} className="flex items-center justify-between text-xs py-1" style={{ borderBottom: `1px solid ${C.border}` }}>
              <span className="truncate pr-2">{act.subject}</span>
              <span className="shrink-0" style={{ color: act.done ? C.faint : C.muted }}>{fmtDate(act.due_date)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs" style={{ color: C.faint }}>No activities due in this range.</p>
      )}
    </div>
  );
}

function ActivityStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg px-3 py-2 text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
      <p className="text-lg font-bold" style={{ color }}>{value}</p>
      <p className="text-[10px]" style={{ color: C.faint }}>{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CONTACTS / COMPANIES
// ---------------------------------------------------------------------------

function ContactsCard({ data }: { data: CrmOverview }) {
  const c = data.contacts;
  if (!c) return null;
  const stats = [
    { label: "New Contacts", value: c.new_contacts_count },
    { label: "New Organizations", value: c.new_organizations_count },
    { label: "Active Customers", value: c.active_customers_count },
    { label: "Prospects", value: c.prospects_count },
  ];
  return (
    <div className="rounded-xl p-5" style={{ background: CARD_BG, border: `1px solid ${C.border}` }}>
      <h3 className="text-sm font-semibold mb-3">Contacts &amp; Companies</h3>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.05)" }}>
            <p className="text-lg font-bold">{s.value}</p>
            <p className="text-[10px]" style={{ color: C.faint }}>{s.label}</p>
          </div>
        ))}
      </div>
      {c.accounts_without_recent_activity_count > 0 && (
        <div>
          <p className="text-xs font-medium mb-1.5" style={{ color: C.muted }}>
            Accounts without recent activity ({c.accounts_without_recent_activity_count})
          </p>
          <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
            {c.accounts_without_recent_activity.slice(0, 6).map((o) => (
              <div key={o.id} className="flex items-center justify-between text-xs">
                <span className="truncate pr-2">{o.name}</span>
                <span style={{ color: C.faint }}>{fmtDate(o.last_activity_date) || "No activity"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RISKS / ATTENTION REQUIRED
// ---------------------------------------------------------------------------

function RisksCard({ data }: { data: CrmOverview }) {
  const r = data.risks;
  if (!r) return null;

  const sections = [
    {
      title: "Overdue Close Date",
      items: r.overdue_close_deals,
      reason: (d: DealRow) => `Expected close was ${fmtDate(d.expected_close_date)} — already past`,
    },
    {
      title: "Approaching Close Date",
      items: r.approaching_close_deals,
      reason: (d: DealRow) => `Expected to close by ${fmtDate(d.expected_close_date)} (within ${r.approaching_close_threshold_days} days)`,
    },
    {
      title: "Stalled Deals",
      items: r.stalled_deals,
      reason: (d: DealRow) =>
        d.last_activity_date
          ? `No activity since ${fmtDate(d.last_activity_date)} (over ${r.stale_activity_threshold_days} days)`
          : `No recorded activity at all`,
    },
    {
      title: "Large Deals Without Upcoming Activity",
      items: r.large_deals_without_upcoming_activity,
      reason: () => `Above-median value with no next activity scheduled`,
    },
  ];

  const totalCount = sections.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <div className="rounded-xl p-5" style={{ background: CARD_BG, border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={15} style={{ color: "#FBBF24" }} />
        <h3 className="text-sm font-semibold">Risks / Attention Required</h3>
      </div>
      {totalCount === 0 ? (
        <p className="text-sm" style={{ color: C.faint }}>Nothing needs attention right now.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {sections.map((sec) =>
            sec.items.length === 0 ? null : (
              <div key={sec.title}>
                <p className="text-xs font-semibold mb-1.5">{sec.title} ({sec.items.length})</p>
                <div className="flex flex-col gap-1.5">
                  {sec.items.slice(0, 4).map((d) => (
                    <div key={d.id} className="rounded-lg px-3 py-2" style={{ background: "#3D2E12", border: "1px solid #5C4419" }}>
                      <p className="text-xs font-medium">{d.name} <span style={{ color: C.faint, fontWeight: 400 }}>· {d.company ?? "—"}</span></p>
                      <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>{sec.reason(d)}</p>
                    </div>
                  ))}
                  {sec.items.length > 4 && (
                    <p className="text-[11px]" style={{ color: C.faint }}>+{sec.items.length - 4} more</p>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DATA LIMITATIONS
// ---------------------------------------------------------------------------

function LimitationsCard({ data }: { data: CrmOverview }) {
  const limitations = data.limitations ?? [];
  if (limitations.length === 0) return null;
  return (
    <div className="rounded-xl px-5 py-3" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}` }}>
      <p className="text-[11px] font-semibold mb-1" style={{ color: C.muted }}>Data notes</p>
      <ul className="text-[11px] leading-relaxed list-disc pl-4" style={{ color: C.faint }}>
        {limitations.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
