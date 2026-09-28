"use client";

// A standalone, self-contained dashboard widget: fetches its own data
// client-side from /api/urgent-emails and /api/tasks rather than going
// through lib/data.ts's getDashboardData(), so this feature stays fully
// isolated from the existing calendar/tasks/revenue data plumbing — nothing
// here is threaded through DashboardData. Mounted inside CeoDashboard's
// "My Actions" card (see CeoDashboard.tsx) as a full-width strip below the
// 4 stat tiles, so it's unstyled at the outer level (no page padding/card of
// its own) — the parent card already provides that chrome.
//
// Emails (from email_urgency.classify_emails) and tasks (from tasks.json)
// are merged into ONE list, ranked overdue-first/high-next/important-last
// (see TIER_RANK) rather than emails always sitting above tasks — the CEO
// wants whichever actually needs attention first at the top, regardless of
// which system it came from. Only items that clear that bar are shown here;
// "View more" links to the full /tasks page for everything else.

import { useEffect, useState } from "react";
import Link from "next/link";

type PriorityTier = "overdue" | "high" | "important";

interface UrgentEmail {
  id: string;
  subject: string;
  sender: string;
  snippet: string;
  received_at: string | null;
  gmail_url: string;
  reason: string;
  priority: PriorityTier;
}

interface Task {
  id: string;
  title: string;
  due_date: string;
  priority: string;
  status: string;
}

// Same three tiers email_urgency.py classifies emails into (see
// PRIORITY_TIERS there) — one shared ranking both item types sort by.
const TIER_RANK: Record<PriorityTier, number> = { overdue: 0, high: 1, important: 2 };
const TIER_LABEL: Record<PriorityTier, { text: string; className: string }> = {
  overdue: { text: "Overdue", className: "bg-red-100 text-red-700" },
  high: { text: "High", className: "bg-amber-100 text-amber-700" },
  important: { text: "Important", className: "bg-blue-100 text-blue-700" },
};

function PriorityTag({ tier }: { tier: PriorityTier }) {
  const t = TIER_LABEL[tier] ?? TIER_LABEL.important;
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${t.className}`}>{t.text}</span>;
}

// Tasks don't have an "important" tier of their own (that's the email
// classifier's catch-all) — a task only shows up here if it's overdue or
// explicitly high-priority; everything else (medium/low, not overdue) stays
// out of this card and is only visible via "View more" on the full /tasks
// page, per the CEO's ask to only surface overdue/high/important here.
function taskTier(t: Task): PriorityTier | null {
  if (t.status === "overdue") return "overdue";
  if (t.priority === "high") return "high";
  return null;
}

// The backend already filters emails down to only overdue/high/important
// (see email_urgency.PRIORITY_TIERS) — this just guards against an
// unexpected/stale value (e.g. a backend that hasn't picked up a change yet)
// so a bad string degrades to "important" instead of crashing the card.
function emailTier(e: UrgentEmail): PriorityTier {
  return e.priority in TIER_RANK ? e.priority : "important";
}

type ActionItem =
  | { kind: "email"; tier: PriorityTier; email: UrgentEmail }
  | { kind: "task"; tier: PriorityTier; task: Task };

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
      .then((d) => setTasks(d.tasks ?? []))
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

  const items: ActionItem[] = [
    ...emails.map((email): ActionItem => ({ kind: "email", tier: emailTier(email), email })),
    ...tasks
      .map((task) => ({ task, tier: taskTier(task) }))
      .filter((x): x is { task: Task; tier: PriorityTier } => x.tier !== null)
      .map((x): ActionItem => ({ kind: "task", tier: x.tier, task: x.task })),
  ].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);

  return (
    <div>
      <div className="flex items-center justify-end mb-1">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-slate-500 pt-2">Checking for anything urgent...</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500 pt-2">Nothing needs your attention right now.</p>
      ) : (
        <div className="flex flex-col max-h-56 overflow-y-auto overflow-x-hidden -mr-2.5 pr-2.5">
          {items.map((item) =>
            item.kind === "email" ? (
              <div key={item.email.id} className="py-2.5 row-separator">
                <p className="text-[13px] font-medium leading-snug truncate text-slate-900">{item.email.subject}</p>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <PriorityTag tier={item.tier} />
                  <a
                    href={item.email.gmail_url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs text-blue-600"
                  >
                    Open
                  </a>
                </div>
                <p className="text-xs text-slate-500 mt-1 truncate">{item.email.sender}</p>
                <p className="text-xs text-slate-500 mt-1 leading-snug">{item.email.reason}</p>
              </div>
            ) : (
              <div key={item.task.id} className="py-2.5 row-separator">
                <p className="text-[13px] font-medium leading-snug truncate text-slate-900">{item.task.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <PriorityTag tier={item.tier} />
                  <span className="text-xs text-slate-500">Due {item.task.due_date}</span>
                </div>
              </div>
            )
          )}
        </div>
      )}

      <Link href="/tasks" className="inline-block text-xs font-medium text-blue-600 mt-3">
        View more →
      </Link>
    </div>
  );
}
