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
import { RefreshCw, ExternalLink, ArrowRight } from "lucide-react";

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
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-500">Needs Your Reply</span>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-slate-500 pt-2">Checking your inbox...</p>
      ) : emails.length === 0 ? (
        <p className="text-xs text-slate-500 pt-2">
          Nothing needs an immediate reply right now.
        </p>
      ) : (
        <div className="flex flex-col max-h-56 overflow-y-auto">
          {emails.map((e) => (
            <div key={e.id} className="py-2.5 border-b border-gray-100 last:border-b-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug truncate text-slate-900">{e.subject}</p>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{e.sender}</p>
                  <p className="text-xs text-slate-500 mt-1 leading-snug">{e.reason}</p>
                </div>
                <a
                  href={e.gmail_url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-blue-600 mt-0.5"
                >
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-col mt-1">
          {tasks.map((t) => (
            <div key={t.id} className="py-2.5 border-b border-gray-100 last:border-b-0">
              <p className="text-sm font-semibold leading-snug truncate text-slate-900">{t.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${
                    t.status === "overdue" ? "bg-red-100 text-red-700" : "bg-gray-100 text-slate-600"
                  }`}
                >
                  {t.status === "overdue" ? "Overdue" : `Due ${t.due_date}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Link
        href="/tasks"
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 mt-3"
      >
        View more <ArrowRight size={12} />
      </Link>
    </div>
  );
}
