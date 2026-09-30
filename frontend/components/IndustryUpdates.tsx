"use client";

// A standalone, self-contained dashboard widget: fetches its own data
// client-side from /api/industry-updates rather than going through
// lib/data.ts's getDashboardData(), so this feature stays fully isolated
// from the existing calendar/tasks/revenue data plumbing. The header/icon/
// subtitle/chevron chrome lives in the parent grid card (CeoDashboard.tsx's
// GRID_CARDS) — this component renders only the item list + a small refresh
// affordance.

import { useEffect, useState } from "react";

interface IndustryUpdate {
  url: string;
  title: string;
  content: string | null;
  fetched_at: string;
}

export default function IndustryUpdates() {
  const [industryUpdates, setIndustryUpdates] = useState<IndustryUpdate[]>([]);
  const [competitorMoves, setCompetitorMoves] = useState<IndustryUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/industry-updates", { cache: "no-store" });
      const data = await res.json();
      setIndustryUpdates(data.industry_updates ?? []);
      setCompetitorMoves(data.competitor_moves ?? []);
    } catch {
      setIndustryUpdates([]);
      setCompetitorMoves([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await fetch("/api/industry-updates", { method: "POST" });
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-1">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-slate-500 pt-1">Checking for updates...</p>
      ) : industryUpdates.length === 0 && competitorMoves.length === 0 ? (
        <p className="text-xs text-slate-500 pt-1">No significant updates yet.</p>
      ) : (
        <div className="flex flex-col max-h-56 overflow-y-auto overflow-x-hidden -mr-2.5 pr-2.5">
          <UpdateGroup label="Industry Updates" items={industryUpdates} />
          <UpdateGroup label="Competitor Moves" items={competitorMoves} />
        </div>
      )}
    </div>
  );
}

function UpdateGroup({ label, items }: { label: string; items: IndustryUpdate[] }) {
  if (items.length === 0) return null;
  return (
    <div className="pt-2 first:pt-0">
      <span className="inline-block text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 rounded px-2 py-0.5">
        {label}
      </span>
      {items.map((u) => (
        <div key={u.url} className="py-2.5 row-separator">
          <p className="text-[13px] font-medium leading-snug text-slate-900 line-clamp-1">{u.title}</p>
          {u.content && (
            <p className="text-xs text-slate-500 mt-1 leading-snug line-clamp-2">{u.content}</p>
          )}
          <a
            href={u.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs mt-2 text-blue-600 font-medium"
          >
            View full article →
          </a>
        </div>
      ))}
    </div>
  );
}
