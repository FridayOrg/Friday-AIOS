"use client";

// A standalone, self-contained dashboard widget: fetches its own data
// client-side from /api/urgent-emails, /api/tasks and /api/actions rather
// than going through lib/data.ts's getDashboardData(), so this feature stays
// fully isolated from the existing calendar/revenue data plumbing — nothing
// here is threaded through DashboardData. Mounted inside CeoDashboard's
// "My Priorities" card (see CeoDashboard.tsx) as a full-width strip below the
// 4 stat tiles, so it's unstyled at the outer level (no page padding/card of
// its own) — the parent card already provides that chrome.
//
// Emails (from email_urgency.classify_emails), tasks (from tasks.json) and
// actions (from actions.json) are merged into ONE list, ranked
// critical-first/overdue-next/.../low-last (see TIER_RANK) rather than kept
// in separate blocks — whichever actually needs attention first goes to the
// top, regardless of which system it came from. Every action is always
// shown (actions.json's own priority is used as-is, not re-derived from any
// other date); "View more" links to the full /tasks page for everything else.
//
// Today / This Week filter + Done/In Progress/Dismissed status are local-only
// (component state, not persisted) — see Monday PM sprint-plan item: "works
// locally", no backend write yet.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PriorityTier = "critical" | "overdue" | "due_today" | "high" | "important" | "low";
type Horizon = "Today" | "This Week";
type LocalStatus = "done" | "in_progress" | "dismissed";

interface UrgentEmail {
  id: string;
  subject: string;
  sender: string;
  snippet: string;
  received_at: string | null;
  gmail_url: string;
  reason: string;
  priority: "overdue" | "due_today" | "high" | "important";
}

interface Task {
  id: string;
  title: string;
  due_date: string;
  priority: string;
  status: string;
}

interface Action {
  actionId: string;
  priority: string; // "Critical" | "High" | "Low" — as given in actions.json
  action: string;
  owner: string;
  due: string;
  deal: string;
  whyNow: string;
  notes: string;
  timeHorizon: string; // "Today" | "This Week" — as given in actions.json
}

// Emails classify into 3 tiers (see PRIORITY_TIERS in email_urgency.py);
// tasks add a 4th, "due_today"; actions carry their own priority
// (Critical/High/Low) straight from actions.json. One shared ranking every
// item type sorts by — critical actions outrank even overdue tasks/emails.
const TIER_RANK: Record<PriorityTier, number> = {
  critical: 0,
  overdue: 1,
  due_today: 2,
  high: 3,
  important: 4,
  low: 5,
};
const TIER_LABEL: Record<PriorityTier, { text: string; className: string }> = {
  critical: { text: "Critical", className: "bg-red-200 text-red-800" },
  overdue: { text: "Overdue", className: "bg-red-100 text-red-700" },
  due_today: { text: "Due Today", className: "bg-orange-100 text-orange-700" },
  high: { text: "High", className: "bg-amber-100 text-amber-700" },
  important: { text: "Important", className: "bg-blue-100 text-blue-700" },
  low: { text: "Low", className: "bg-slate-100 text-slate-600" },
};

const STATUS_OPTIONS: { key: LocalStatus; label: string }[] = [
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
  { key: "dismissed", label: "Dismissed" },
];
const STATUS_STYLE: Record<LocalStatus, string> = {
  in_progress: "bg-blue-600 text-white",
  done: "bg-green-600 text-white",
  dismissed: "bg-slate-400 text-white",
};

function PriorityTag({ tier }: { tier: PriorityTier }) {
  const t = TIER_LABEL[tier] ?? TIER_LABEL.important;
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${t.className}`}>{t.text}</span>;
}

// Tasks don't have an "important" tier of their own (that's the email
// classifier's catch-all) — a task only shows up here if it's overdue, due
// today, or explicitly high-priority; everything else (medium/low, due
// later) stays out of this card and is only visible via "View more" on the
// full /tasks page. `status` is already derived from due_date vs. today (see
// lib/data.ts's getTasks), not a stale hardcoded value.
function taskTier(t: Task): PriorityTier | null {
  if (t.status === "overdue") return "overdue";
  if (t.status === "due_today") return "due_today";
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

// Every action is always shown here (unlike tasks, which get filtered down
// to just the urgent ones) — actions.json already is the curated "needs
// attention" list, nothing to filter further. Priority comes straight from
// the file, not re-derived from any date.
function actionTier(a: Action): PriorityTier {
  if (a.priority === "Critical") return "critical";
  if (a.priority === "High") return "high";
  return "low";
}

// Emails carry no due date of their own (urgency comes from the inbox, not a
// deadline) so they're always "Today". Tasks use their own derived status —
// overdue/due_today both count as "Today", everything else as "This Week".
// Actions use their own timeHorizon field directly, unchanged.
function emailHorizon(): Horizon {
  return "Today";
}
function taskHorizon(t: Task): Horizon {
  return t.status === "overdue" || t.status === "due_today" ? "Today" : "This Week";
}
function actionHorizon(a: Action): Horizon {
  return a.timeHorizon === "Today" ? "Today" : "This Week";
}

type ActionItem =
  | { kind: "email"; id: string; tier: PriorityTier; horizon: Horizon; email: UrgentEmail }
  | { kind: "task"; id: string; tier: PriorityTier; horizon: Horizon; task: Task }
  | { kind: "action"; id: string; tier: PriorityTier; horizon: Horizon; action: Action };

export default function UrgentEmails() {
  const [emails, setEmails] = useState<UrgentEmail[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [horizonFilter, setHorizonFilter] = useState<"all" | Horizon>("all");
  const [localStatus, setLocalStatus] = useState<Record<string, LocalStatus>>({});

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
    fetch("/api/actions", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setActions(d.actions ?? []))
      .catch(() => setActions([]));
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

  function setStatus(id: string, status: LocalStatus) {
    setLocalStatus((prev) => ({ ...prev, [id]: prev[id] === status ? undefined : status } as Record<string, LocalStatus>));
  }

  const items: ActionItem[] = useMemo(
    () =>
      [
        ...emails.map((email): ActionItem => ({
          kind: "email",
          id: `email-${email.id}`,
          tier: emailTier(email),
          horizon: emailHorizon(),
          email,
        })),
        ...tasks
          .map((task) => ({ task, tier: taskTier(task) }))
          .filter((x): x is { task: Task; tier: PriorityTier } => x.tier !== null)
          .map((x): ActionItem => ({
            kind: "task",
            id: `task-${x.task.id}`,
            tier: x.tier,
            horizon: taskHorizon(x.task),
            task: x.task,
          })),
        ...actions.map((action): ActionItem => ({
          kind: "action",
          id: `action-${action.actionId}`,
          tier: actionTier(action),
          horizon: actionHorizon(action),
          action,
        })),
      ].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]),
    [emails, tasks, actions]
  );

  const visibleItems = items.filter((i) => horizonFilter === "all" || i.horizon === horizonFilter);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1.5">
          {(["all", "Today", "This Week"] as const).map((h) => (
            <button
              key={h}
              onClick={() => setHorizonFilter(h)}
              className={`text-[11px] font-medium px-2 py-1 rounded-full transition-colors ${
                horizonFilter === h ? "bg-sky-50 text-sky-700" : "bg-white text-slate-500 border border-gray-200"
              }`}
            >
              {h === "all" ? "All" : h}
            </button>
          ))}
        </div>
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
      ) : visibleItems.length === 0 ? (
        <p className="text-xs text-slate-500 pt-2">Nothing needs your attention right now.</p>
      ) : (
        <div className="flex flex-col max-h-56 overflow-y-auto overflow-x-hidden -mr-2.5 pr-2.5">
          {visibleItems.map((item) => {
            const status = localStatus[item.id];
            const dimmed = status === "done" || status === "dismissed";
            const statusRow = (
              <div className="flex items-center gap-1 mt-1.5">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setStatus(item.id, opt.key)}
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full transition-colors ${
                      status === opt.key ? STATUS_STYLE[opt.key] : "bg-gray-100 text-slate-500"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            );

            if (item.kind === "email") {
              return (
                <div key={item.id} className="py-2.5 row-separator" style={{ opacity: dimmed ? 0.5 : 1 }}>
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
                  {statusRow}
                </div>
              );
            }
            if (item.kind === "task") {
              return (
                <div key={item.id} className="py-2.5 row-separator" style={{ opacity: dimmed ? 0.5 : 1 }}>
                  <p className="text-[13px] font-medium leading-snug truncate text-slate-900">{item.task.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <PriorityTag tier={item.tier} />
                    <span className="text-xs text-slate-500">Due {item.task.due_date}</span>
                  </div>
                  {statusRow}
                </div>
              );
            }
            const expanded = expandedActionId === item.action.actionId;
            return (
              <div key={item.id} className="py-2.5 row-separator" style={{ opacity: dimmed ? 0.5 : 1 }}>
                <p className="text-[13px] font-medium leading-snug text-slate-900">{item.action.action}</p>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <PriorityTag tier={item.tier} />
                    <span className="text-xs text-slate-500 truncate">{item.action.deal}</span>
                  </div>
                  <button
                    onClick={() => setExpandedActionId(expanded ? null : item.action.actionId)}
                    className="shrink-0 text-xs text-blue-600"
                  >
                    Why?
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-xs text-slate-500">{item.action.owner}</span>
                  <span className="text-xs text-slate-500">Due {item.action.due}</span>
                </div>
                {expanded && (
                  <div className="mt-2 text-xs text-slate-600 leading-snug bg-slate-50 rounded-md px-2.5 py-2">
                    <p>{item.action.whyNow}</p>
                    {item.action.notes && <p className="mt-1 text-slate-500">{item.action.notes}</p>}
                  </div>
                )}
                {statusRow}
              </div>
            );
          })}
        </div>
      )}

      <Link href="/tasks" className="inline-block text-xs font-medium text-blue-600 mt-3">
        View more →
      </Link>
    </div>
  );
}
