"use client";

// A standalone, self-contained dashboard section: fetches its own data
// client-side from /api/urgent-emails rather than going through lib/data.ts's
// getDashboardData(), so this feature stays fully isolated from the existing
// calendar/tasks/revenue data plumbing — nothing here is threaded through
// DashboardData or CeoDashboard.tsx.

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
    <div className="max-w-6xl mx-auto px-6 pb-6">
      <div className="rounded-xl overflow-hidden bg-white/85 border border-black/[0.07]">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#FDE7ED]">
              <Mail size={15} className="text-[#D6428E]" />
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
        <div className="px-5 pb-5 pt-1 border-t border-black/[0.07]">
          {loading ? (
            <p className="text-xs text-slate-400 pt-2">Checking your inbox...</p>
          ) : emails.length === 0 ? (
            <p className="text-xs text-slate-400 pt-2">
              Nothing needs an immediate reply right now.
            </p>
          ) : (
            emails.map((e) => (
              <div key={e.id} className="py-2.5 border-b border-black/[0.07] last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug truncate">{e.subject}</p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{e.sender}</p>
                    <p className="text-xs text-slate-500 mt-1">{e.reason}</p>
                  </div>
                  <a
                    href={e.gmail_url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-teal-600"
                  >
                    Open <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
