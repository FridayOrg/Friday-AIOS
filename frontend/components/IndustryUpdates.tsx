"use client";

// A standalone, self-contained dashboard widget: fetches its own data
// client-side from /api/industry-updates rather than going through
// lib/data.ts's getDashboardData(), so this feature stays fully isolated
// from the existing calendar/tasks/revenue data plumbing. Mounted inside
// CeoDashboard's "Overview" card, stacked below UrgentEmails, so it's
// unstyled at the outer level (no page padding/card of its own) — the parent
// Overview card already provides that chrome. A blue/indigo tint
// distinguishes it from UrgentEmails' pink.

import { useEffect, useState } from "react";
import { Newspaper, RefreshCw, ExternalLink } from "lucide-react";

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
    <div className="rounded-xl overflow-hidden bg-[#F0F5FC] border border-[#D7E3F7]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#DCEEFB] shrink-0">
            <Newspaper size={13} className="text-[#2D9CDB]" />
          </span>
          <span className="text-sm font-semibold">Industry Updates</span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
      <div className="px-4 pb-4 pt-0.5 border-t border-[#D7E3F7]">
        {loading ? (
          <p className="text-xs text-slate-400 pt-2">Checking for updates...</p>
        ) : updates.length === 0 ? (
          <p className="text-xs text-slate-400 pt-2">No significant updates today yet.</p>
        ) : (
          <div className="flex flex-col gap-2 pt-2 max-h-56 overflow-y-auto">
            {updates.map((u) => (
              <div key={u.url} className="rounded-lg bg-white/80 border border-[#D7E3F7] px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug truncate">{u.title}</p>
                    {u.content && (
                      <p className="text-xs text-slate-500 mt-1 leading-snug">{u.content}</p>
                    )}
                  </div>
                  <a
                    href={u.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-teal-600 mt-0.5"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
