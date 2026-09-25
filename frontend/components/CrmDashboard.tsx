"use client";

// The CRM page (/crm) — a CEO-facing view built entirely from live HubSpot
// data (backend/app/crm_metrics.py via GET /api/crm -> backend's
// /crm/overview). Self-contained client widget, same convention as
// IndustryUpdates.tsx/UrgentEmails.tsx: fetches its own data rather than
// going through lib/data.ts, so this stays fully isolated from the existing
// mock-data dashboard plumbing.
//
// Every number rendered here traces back to a specific HubSpot field —
// see crm_metrics.py's per-function docstrings for the exact calculation.
// Metrics HubSpot can't support (e.g. forecast with no probability set)
// come back as null from the backend and are rendered as "Not available"
// rather than a fabricated 0 — never silently coerced to zero here either.

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  ComposedChart,
  Area,
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
import { fmtFullDay } from "@/lib/dashboardTokens";
import type { CrmOverview, DateRangeKey, TrendPeriod, DealRow } from "@/lib/crmTypes";

// ---------------------------------------------------------------------------
// LIGHT THEME — this page deliberately uses its own light SaaS-analytics
// palette instead of the shared dark `dashboardTokens.ts` used by the rest
// of the app (CeoDashboard, AskFriday, etc. stay dark). Local to this file
// only, so it doesn't affect any other page.
// ---------------------------------------------------------------------------
const PAGE_BG = "#F5F6F8";
const CARD_BG = "#FFFFFF";
const C = {
  ink: "#1F2937", // headers, primary text
  muted: "#4B5563", // secondary text
  faint: "#9CA3AF", // tertiary/labels
  border: "#E5E7EB",
  up: "#2BAF6A", // positive delta / won
  down: "#EF6B6B", // negative delta / lost
  blue: "#3B82F6",
  orange: "#F59E0B",
};

// Restrained pastel accent set for chart series/segments — blue, green,
// orange, coral, plus two extra hues only for charts with >4 categories.
const STAGE_COLORS = ["#3B82F6", "#2BAF6A", "#F59E0B", "#EF6B6B", "#8B5CF6", "#22D3EE", "#FB923C"];

const TOOLTIP_STYLE = {
  contentStyle: { background: "#FFFFFF", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 },
  labelStyle: { color: C.muted },
  itemStyle: { color: C.ink },
};

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

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Avatar({ name, color }: { name: string | null | undefined; color?: string }) {
  return (
    <span
      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
      style={{ background: color ?? "rgba(59,130,246,0.12)", color: color ? "#FFFFFF" : C.blue }}
    >
      {initials(name)}
    </span>
  );
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
        background: PAGE_BG,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');`}</style>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header: greeting + global date filter */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold">CRM</h1>
            <p className="text-sm mt-0.5" style={{ color: C.muted }}>
              HubSpot-powered CEO view · {fmtFullDay(today)}
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
                  style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.ink, colorScheme: "light" }}
                />
                <span className="text-xs" style={{ color: C.faint }}>to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="text-xs px-2.5 py-2 rounded-lg"
                  style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.ink, colorScheme: "light" }}
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
              className="text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.muted }}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl px-5 py-10 text-sm text-center" style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.faint }}>
            Loading CRM data…
          </div>
        ) : !data?.configured ? (
          <div className="rounded-xl px-5 py-8 text-sm text-center" style={{ background: CARD_BG, border: `1px solid ${C.border}`, color: C.faint }}>
            {data?.message ?? "HubSpot is not configured."}
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BestOwnersCard data={data} />
              <LostReasonsCard data={data} />
            </div>

            <ForecastCard data={data} />

            <TopDealsCard data={data} expandedDeal={expandedDeal} setExpandedDeal={setExpandedDeal} />

            <ActivitiesCard data={data} />

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
      fg: C.up,
      spark: trendPoints,
    },
    {
      label: "Open Pipeline",
      value: fmtCurrency(k.open_pipeline_value),
      change: null,
      fg: C.blue,
    },
    {
      label: "Deals Won",
      value: String(k.deals_won),
      change: null,
      fg: C.up,
    },
    {
      label: "Conversion Rate",
      value: k.conversion_rate_pct === null ? "Not available" : `${k.conversion_rate_pct}%`,
      change: null,
      fg: C.orange,
    },
    {
      label: "Activities Due",
      value: String(k.activities_due),
      change: null,
      fg: C.down,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl p-4 flex flex-col gap-2"
          style={{ background: CARD_BG, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: c.fg }}>{c.label}</p>
            {c.change && (
              <span
                className="flex items-center gap-0.5 text-[11px] font-medium"
                style={{ color: c.change.startsWith("+") ? C.up : C.down }}
              >
                <span aria-hidden>{c.change.startsWith("+") ? "↑" : "↓"}</span>
                {c.change}
              </span>
            )}
          </div>
          <div>
            <p className="text-lg font-bold leading-tight">{c.value}</p>
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
    <div className="rounded-xl p-5 h-full" style={{ background: CARD_BG, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}>
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
  // Forecast overlay: a flat reference line at the currently-selected-range's
  // weighted forecast value (see crm_metrics.build_forecast) — the backend
  // only produces one forecast number per range, not a time series, so this
  // is plotted as a constant dashed line alongside actual won revenue rather
  // than a fabricated forecast curve.
  const forecastValue = data.forecast?.forecast_value ?? null;
  const chartPoints = points.map((p) => ({ ...p, forecast: forecastValue }));
  return (
    <ChartCard
      title="Revenue Forecast"
      subtitle="Won revenue (actual) vs. weighted pipeline forecast"
      right={
        <select
          value={trendPeriod}
          onChange={(e) => onTrendPeriodChange(e.target.value as TrendPeriod)}
          className="text-[11px] font-medium px-2 py-1.5 rounded-lg"
          style={{ background: "#F9FAFB", border: `1px solid ${C.border}`, color: C.muted }}
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
            <ComposedChart data={chartPoints} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="revTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.up} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={C.up} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.faint }} tickFormatter={fmtDate} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => fmtCurrency(v)} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => fmtCurrency(Number(v))} labelFormatter={(l) => fmtDate(String(l))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="value" name="Actual" stroke={C.up} strokeWidth={2} fill="url(#revTrendFill)" />
              {forecastValue !== null && (
                <Line
                  type="monotone"
                  dataKey="forecast"
                  name="Forecast (weighted)"
                  stroke={C.blue}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                />
              )}
            </ComposedChart>
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
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="stage_name" tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => fmtCurrency(v)} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => fmtCurrency(Number(v))} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={28}>
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
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, _n, entry) => [`${v} deals`, (entry?.payload as { stage_name?: string })?.stage_name ?? ""]} />
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
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => fmtCurrency(v)} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => fmtCurrency(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="won_value" name="Won" fill={C.up} radius={[6, 6, 0, 0]} barSize={20} />
              <Bar dataKey="lost_value" name="Lost" fill={C.down} radius={[6, 6, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function BestOwnersCard({ data }: { data: CrmOverview }) {
  const rows = (data.deals_by_owner ?? []).slice(0, 8);
  return (
    <ChartCard title="Best Owners by Deal Amount" subtitle="Open pipeline value by rep">
      {rows.length === 0 ? (
        <EmptyChart label="No open deals to rank." />
      ) : (
        <div style={{ height: Math.max(160, rows.length * 34) }} className="mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 5, right: 20, bottom: 0, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtCurrency(v)} />
              <YAxis type="category" dataKey="owner" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} width={110} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, _n, entry) => [fmtCurrency(Number(v)), `${(entry?.payload as { count?: number })?.count ?? 0} deals`]} />
              <Bar dataKey="value" fill={C.blue} radius={[0, 6, 6, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function LostReasonsCard({ data }: { data: CrmOverview }) {
  const rows = data.lost_reasons ?? [];
  return (
    <ChartCard title="Lost Deal Reasons" subtitle="Lost deals in the selected range, by reason">
      {rows.length === 0 ? (
        <EmptyChart label="No lost deals in this range." />
      ) : (
        <div className="h-56 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows} dataKey="count" nameKey="reason" innerRadius={45} outerRadius={75} paddingAngle={2}>
                {rows.map((_, i) => (
                  <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, _n, entry) => [`${v} deal${v === 1 ? "" : "s"}`, (entry?.payload as { reason?: string })?.reason ?? ""]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
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
    <div className="rounded-xl p-5" style={{ background: CARD_BG, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}>
      <div className="mb-1">
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
          Not available — no open deals in this range have a probability set on their HubSpot deal stage.
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
    <div className="rounded-xl overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}>
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
                  <th
                    key={h}
                    className="text-left font-semibold uppercase tracking-wide px-5 py-2 text-[10px] whitespace-nowrap"
                    style={{ color: C.faint }}
                  >
                    {h}
                  </th>
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
        className="cursor-pointer hover:bg-gray-50"
        style={{ borderBottom: expanded ? "none" : `1px solid ${C.border}` }}
      >
        <td className="px-5 py-2.5 font-medium whitespace-nowrap flex items-center gap-1.5">
          <span aria-hidden className="text-xs" style={{ color: C.faint }}>{expanded ? "▾" : "▸"}</span>
          {deal.name ?? "—"}
        </td>
        <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: C.muted }}>{deal.company ?? "—"}</td>
        <td className="px-5 py-2.5 whitespace-nowrap font-medium">
          {deal.value !== null ? `${deal.currency ?? ""} ${deal.value.toLocaleString("en-US")}`.trim() : "—"}
        </td>
        <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: C.muted }}>{deal.stage_name ?? "—"}</td>
        <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: C.muted }}>{fmtDate(deal.expected_close_date)}</td>
        <td className="px-5 py-2.5 whitespace-nowrap">
          <span className="flex items-center gap-1.5" style={{ color: C.muted }}>
            <Avatar name={deal.owner} />
            {deal.owner ?? "—"}
          </span>
        </td>
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
    <div className="rounded-xl p-5" style={{ background: CARD_BG, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}>
      <h3 className="text-sm font-semibold mb-3">Activities</h3>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <ActivityStat label="Overdue" value={a.overdue_count} color={C.down} />
        <ActivityStat label="Due Today" value={a.due_today_count} color={C.orange} />
        <ActivityStat label="Upcoming" value={a.upcoming_count} color={C.blue} />
      </div>
      {Object.keys(a.by_type).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {Object.entries(a.by_type).map(([type, count]) => (
            <span key={type} className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#F9FAFB", color: C.muted }}>
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
    <div className="rounded-lg px-3 py-2 text-center" style={{ background: "#F9FAFB" }}>
      <p className="text-lg font-bold" style={{ color }}>{value}</p>
      <p className="text-[10px]" style={{ color: C.faint }}>{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CONTACTS / COMPANIES
// ---------------------------------------------------------------------------

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
    <div className="rounded-xl p-5" style={{ background: CARD_BG, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}>
      <div className="mb-3">
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
                    <div key={d.id} className="rounded-lg px-3 py-2" style={{ background: "#FEF9E7", border: "1px solid #FDE9B5" }}>
                      <p className="text-xs font-medium" style={{ color: C.ink }}>{d.name} <span style={{ color: C.faint, fontWeight: 400 }}>· {d.company ?? "—"}</span></p>
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
    <div className="rounded-xl px-5 py-3" style={{ background: "#F9FAFB", border: `1px solid ${C.border}` }}>
      <p className="text-[11px] font-semibold mb-1" style={{ color: C.muted }}>Data notes</p>
      <ul className="text-[11px] leading-relaxed list-disc pl-4" style={{ color: C.faint }}>
        {limitations.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
