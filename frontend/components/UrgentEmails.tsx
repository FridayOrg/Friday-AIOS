"use client";

// A standalone, self-contained dashboard widget: fetches its own data
// client-side from /api/urgent-emails rather than going through lib/data.ts's
// getDashboardData(), so this feature stays fully isolated from the existing
// calendar/tasks/revenue data plumbing — nothing here is threaded through
// DashboardData. Mounted inside CeoDashboard's "Overview" card (see
// CeoDashboard.tsx) as a full-width strip below the 4 stat tiles, so it's
// unstyled at the outer level (no page padding/card of its own) — the parent
// Overview card already provides that chrome.

import { useEffect, useState } from "react";
import { Mail, RefreshCw, ExternalLink } from "lucide-react";

interface UrgentEmail {
  id: string;
  subject: string;
  sender: string;
  snippet: string;
  received_at: string | null;
  gmail_url: string;
  reason: string;
}

export default function UrgentEmails() {
  const [emails, setEmails] = useState<UrgentEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/urgent-emails", { cache: "no-store" });
      const data = await res.json();
      setEmails(data.emails ?? []);
    } catch {
      setEmails([]);
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
      await fetch("/api/urgent-emails", { method: "POST" });
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="rounded-xl overflow-hidden bg-[#FDF4F8] border border-[#F7D9E7]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#FBE3F0] shrink-0">
            <Mail size={13} className="text-[#D6428E]" />
          </span>
          <span className="text-sm font-semibold">Needs Your Reply</span>
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
      <div className="px-4 pb-4 pt-0.5 border-t border-[#F7D9E7]">
        {loading ? (
          <p className="text-xs text-slate-400 pt-2">Checking your inbox...</p>
        ) : emails.length === 0 ? (
          <p className="text-xs text-slate-400 pt-2">
            Nothing needs an immediate reply right now.
          </p>
        ) : (
          <div className="flex flex-col gap-2 pt-2 max-h-56 overflow-y-auto">
            {emails.map((e) => (
              <div key={e.id} className="rounded-lg bg-white/80 border border-[#F7D9E7] px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug truncate">{e.subject}</p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{e.sender}</p>
                    <p className="text-xs text-slate-500 mt-1 leading-snug">{e.reason}</p>
                  </div>
                  <a
                    href={e.gmail_url}
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
