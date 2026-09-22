"use client";

// A standalone, self-contained dashboard widget: fetches its own data
// client-side from /api/industry-updates rather than going through
// lib/data.ts's getDashboardData(), so this feature stays fully isolated
// from the existing calendar/tasks/revenue data plumbing. The header/icon/
// subtitle/chevron chrome lives in the parent grid card (CeoDashboard.tsx's
// GRID_CARDS) — this component renders only the item list + a small refresh
// affordance.

import { useEffect, useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";

interface IndustryUpdate {
  url: string;
  title: string;
  content: string | null;
  fetched_at: string;
}

export default function IndustryUpdates() {
  const [updates, setUpdates] = useState<IndustryUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/industry-updates", { cache: "no-store" });
      const data = await res.json();
      setUpdates(data.updates ?? []);
    } catch {
      setUpdates([]);
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
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-slate-400 pt-1">Checking for updates...</p>
      ) : updates.length === 0 ? (
        <p className="text-xs text-slate-400 pt-1">No significant updates today yet.</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
          {updates.map((u) => (
            <div key={u.url} className="rounded-lg bg-[#EFF6FD] border border-[#D7E3F7] px-3 py-2.5">
              <p className="text-sm font-medium leading-snug">{u.title}</p>
              {u.content && (
                <p className="text-xs text-slate-500 mt-1 leading-snug line-clamp-2">{u.content}</p>
              )}
              <a
                href={u.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs mt-2 text-[#2D9CDB] font-medium"
              >
                View full article <ExternalLink size={11} />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
