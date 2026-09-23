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
import Link from "next/link";
import { Mail, RefreshCw, ExternalLink, ArrowRight, CheckSquare } from "lucide-react";

interface UrgentEmail {
  id: string;
  subject: string;
  sender: string;
  snippet: string;
  received_at: string | null;
  gmail_url: string;
  reason: string;
}

interface Task {
  id: string;
  title: string;
  due_date: string;
  priority: string;
  status: string;
}

// Same "what needs attention first" ordering as the full /tasks page:
// overdue before pending, then by priority.
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
function topTwoTasks(tasks: Task[]): Task[] {
  return tasks
    .slice()
    .sort((a, b) => {
      if (a.status === "overdue" && b.status !== "overdue") return -1;
      if (b.status === "overdue" && a.status !== "overdue") return 1;
      return (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
    })
    .slice(0, 2);
}

export default function UrgentEmails() {
  const [emails, setEmails] = useState<UrgentEmail[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
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
    fetch("/api/tasks", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTasks(topTwoTasks(d.tasks ?? [])))
      .catch(() => setTasks([]));
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
    <div>
      <div className="rounded-xl overflow-hidden bg-[#3F1233] border border-[#5A2145]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#4A1938] shrink-0">
              <Mail size={13} className="text-[#F472B6]" />
            </span>
            <span className="text-sm font-semibold">Needs Your Reply</span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
        <div className="px-4 pb-4 pt-0.5 border-t border-[#5A2145]">
          {loading ? (
            <p className="text-xs text-slate-400 pt-2">Checking your inbox...</p>
          ) : emails.length === 0 ? (
            <p className="text-xs text-slate-400 pt-2">
              Nothing needs an immediate reply right now.
            </p>
          ) : (
            <div className="flex flex-col gap-2 pt-2 max-h-56 overflow-y-auto">
              {emails.map((e) => (
                <div key={e.id} className="rounded-lg bg-white/5 border border-[#5A2145] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug truncate">{e.subject}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{e.sender}</p>
                      <p className="text-xs text-slate-400 mt-1 leading-snug">{e.reason}</p>
                    </div>
                    <a
                      href={e.gmail_url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 text-xs text-teal-400 mt-0.5"
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

      {tasks.length > 0 && (
        <div className="flex flex-col gap-2 mt-3">
          {tasks.map((t) => (
            <div key={t.id} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <CheckSquare size={13} className="text-slate-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug truncate">{t.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${
                        t.status === "overdue" ? "bg-red-500/15 text-red-300" : "bg-white/10 text-slate-300"
                      }`}
                    >
                      {t.status === "overdue" ? "Overdue" : `Due ${t.due_date}`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Link
        href="/tasks"
        className="inline-flex items-center gap-1 text-xs font-medium text-[#F472B6] mt-3"
      >
        View more <ArrowRight size={12} />
      </Link>
    </div>
  );
}
