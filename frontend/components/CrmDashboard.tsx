"use client";

// The CRM page (/crm) — Financial Performance, Sales & Guarantee Pipeline, and
// Spend & Notifications, moved out of the main dashboard into their own tab.
// Same collapsible-accordion look as before, just relocated; shares its
// color/status/glow tokens with CeoDashboard.tsx via lib/dashboardTokens so
// both pages render identically. Chat-driven highlighting (Ask Friday jumping
// to a specific client/section) only targets the main dashboard for now —
// these sections don't glow from a chat answer on this page.

import { useState } from "react";
import { DollarSign, Target, ChevronDown, ChevronsUpDown } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";
import type { DashboardData } from "@/lib/data";
import { C, statusOf, riskOf, fmtUsd, fmtFullDay } from "@/lib/dashboardTokens";
import GoalsPanel from "./GoalsPanel";

const SECTIONS = [
  { key: "financial", title: "Financial Performance", icon: DollarSign, iconBg: "#D7F6EA", iconColor: "#0E9F6E" },
  { key: "pipeline", title: "Sales & Guarantee Pipeline", icon: Target, iconBg: "#E7E4FC", iconColor: "#6E5AE0" },
] as const;

export default function CrmDashboard({ data, goals }: { data: DashboardData; goals: string[] }) {
  const { revenue, pipeline, spend } = data;
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    financial: true,
    pipeline: true,
    spend: true,
  });

  const anyOpen = Object.values(openSections).some(Boolean);
  const toggleSection = (key: string) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleAll = () =>
    setOpenSections(
      anyOpen ? {} : { financial: true, pipeline: true, spend: true }
    );

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
      `}</style>

      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold">CRM</h1>
            <p className="text-sm mt-0.5" style={{ color: C.muted }}>
              Financial performance, pipeline, and spend · {fmtFullDay(data.today)}
            </p>
          </div>
          <button
            onClick={toggleAll}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg"
            style={{ background: "rgba(255,255,255,0.85)", border: `1px solid ${C.border}`, color: C.muted }}
          >
            <ChevronsUpDown size={14} />
            {anyOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
          <GoalsPanel goals={goals} />
          <div className="flex-1 min-w-0 space-y-3">
          {SECTIONS.map((s) => (
            <div
              key={s.key}
              className="rounded-xl overflow-hidden"
              style={{ background: "rgba(255,255,255,0.85)", border: `1px solid ${C.border}` }}
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
                  {s.key === "financial" && <FinancialContent revenue={revenue} />}
                  {s.key === "pipeline" && <PipelineContent clients={pipeline.clients} />}
                </div>
              )}
            </div>
          ))}

          <div
            className="rounded-xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.85)", border: `1px solid ${C.border}` }}
          >
            <button
              onClick={() => toggleSection("spend")}
              className="w-full flex items-center justify-between px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#FCE6DA" }}>
                  <DollarSign size={15} style={{ color: "#DD7A33" }} />
                </span>
                <span className="text-sm font-semibold">Spend & Notifications</span>
              </div>
              <ChevronDown
                size={16}
                style={{
                  color: C.faint,
                  transform: openSections.spend ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                }}
              />
            </button>
            {openSections.spend && (
              <div className="expand-panel px-5 pb-5 pt-1" style={{ borderTop: `1px solid ${C.border}` }}>
                <SpendContent spend={spend} />
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FinancialContent({ revenue }: { revenue: DashboardData["revenue"] }) {
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
        {revenue.byClient.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between py-1.5"
            style={{ borderBottom: `1px solid ${C.border}` }}
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
        ))}
      </div>
      {revenue.forecastNote && (
        <p className="text-xs mt-3 leading-relaxed" style={{ color: C.faint }}>{revenue.forecastNote}</p>
      )}
    </div>
  );
}

function PipelineContent({ clients }: { clients: DashboardData["pipeline"]["clients"] }) {
  return (
    <div className="flex gap-6 overflow-x-auto pt-3 pb-1">
      {clients.map((c) => (
        <Ring key={c.id} client={c} />
      ))}
    </div>
  );
}

function Ring({ client }: { client: DashboardData["pipeline"]["clients"][number] }) {
  const pct = Math.min(100, Math.round((client.booked / client.target) * 100));
  const color = statusOf(client.status).color;
  const r = 30;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center shrink-0 w-24 rounded-xl">
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
