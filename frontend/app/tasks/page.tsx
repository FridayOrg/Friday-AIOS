"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckSquare } from "lucide-react";

interface Task {
  id: string;
  type: string;
  title: string;
  description: string;
  due_date: string;
  priority: string;
  status: string;
  related_client?: string;
  raised_by?: string;
}

interface Action {
  actionId: string;
  priority: string; // "Critical" | "High" | "Low" — as given in actions.json
  action: string;
  owner: string;
  due: string;
  status: string;
  opportunityId: string;
  deal: string;
  value: number;
  whyNow: string;
  source: string;
  rule: string;
  timeHorizon: string;
  userDecision: string;
  notes: string;
}

// A single normalized shape both tasks and actions get mapped into, so they
// render in one combined, prioritized list instead of two separate blocks.
// due/priority/status are taken directly from each source's own fields —
// nothing here is re-derived from a different date.
interface Item {
  id: string;
  kind: "task" | "action";
  title: string;
  description: string;
  due: string;
  priority: "critical" | "high" | "medium" | "low";
  status?: string; // tasks only (overdue / due_today / pending)
  related_client?: string;
  raised_by?: string;
  whyNow?: string;
  notes?: string;
}

const STATUS_STYLE: Record<string, string> = {
  overdue: "bg-red-100 text-red-700",
  due_today: "bg-orange-100 text-orange-700",
  pending: "bg-amber-100 text-amber-700",
};

const STATUS_LABEL: Record<string, string> = {
  overdue: "overdue",
  due_today: "due today",
  pending: "pending",
};

const PRIORITY_STYLE: Record<string, string> = {
  critical: "bg-red-200 text-red-800",
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-gray-100 text-slate-600",
};

// Overdue tasks still surface first, then by priority — critical (actions
// only) outranks every other priority level.
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_RANK: Record<string, number> = { overdue: 0, due_today: 1, pending: 2 };

const STATUS_FILTERS = ["all", "overdue", "due_today", "pending"] as const;
const PRIORITY_FILTERS = ["all", "critical", "high", "medium", "low"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
type PriorityFilter = (typeof PRIORITY_FILTERS)[number];

function normalizeActionPriority(p: string): Item["priority"] {
  if (p === "Critical") return "critical";
  if (p === "High") return "high";
  return "low";
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full capitalize transition-colors ${
        active
          ? "bg-sky-50 text-sky-700"
          : "bg-white text-slate-500 border border-gray-200 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => setTasks(data.tasks))
      .finally(() => setLoading(false));
    fetch("/api/actions")
      .then((r) => r.json())
      .then((data) => setActions(data.actions ?? []))
      .catch(() => setActions([]));
  }, []);

  const items: Item[] = useMemo(
    () => [
      ...tasks.map((t): Item => ({
        id: t.id,
        kind: "task",
        title: t.title,
        description: t.description,
        due: t.due_date,
        priority: (t.priority as Item["priority"]) ?? "low",
        status: t.status,
        related_client: t.related_client,
        raised_by: t.raised_by,
      })),
      ...actions.map((a): Item => ({
        id: a.actionId,
        kind: "action",
        title: a.action,
        description: a.deal,
        due: a.due,
        priority: normalizeActionPriority(a.priority),
        related_client: a.deal,
        raised_by: a.owner,
        whyNow: a.whyNow,
        notes: a.notes,
      })),
    ],
    [tasks, actions]
  );

  const visibleItems = useMemo(() => {
    return items
      .filter((i) => statusFilter === "all" || i.status === statusFilter)
      .filter((i) => priorityFilter === "all" || i.priority === priorityFilter)
      .slice()
      .sort((a, b) => {
        const priorityDiff = (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
        if (priorityDiff !== 0) return priorityDiff;
        return (STATUS_RANK[a.status ?? ""] ?? 99) - (STATUS_RANK[b.status ?? ""] ?? 99);
      });
  }, [items, statusFilter, priorityFilter]);

  return (
    <div className="p-8 max-w-4xl mx-auto min-h-full bg-[#F5F6F8]">
      <div className="flex items-center gap-2 mb-6">
        <CheckSquare size={22} className="text-sky-600" />
        <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading tasks…</p>
      ) : (
        <>
          <div className="flex flex-col gap-2 mb-5">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_FILTERS.map((s) => (
                <FilterPill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                  {s === "all" ? "all" : STATUS_LABEL[s]}
                </FilterPill>
              ))}
              <span className="hidden sm:inline w-px h-4 bg-gray-200 mx-1" />
              {PRIORITY_FILTERS.map((p) => (
                <FilterPill key={p} active={priorityFilter === p} onClick={() => setPriorityFilter(p)}>
                  {p === "all" ? "all priority" : p}
                </FilterPill>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {visibleItems.length === 0 && (
              <p className="text-sm text-slate-500">No tasks match these filters.</p>
            )}
            {visibleItems.map((i) => {
              const expanded = expandedId === i.id;
              return (
                <div
                  key={i.id}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-2"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{i.title}</h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${
                          PRIORITY_STYLE[i.priority] ?? "bg-gray-100 text-slate-600"
                        }`}
                      >
                        {i.priority}
                      </span>
                      {i.status && (
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${
                            STATUS_STYLE[i.status] ?? "bg-gray-100 text-slate-600"
                          }`}
                        >
                          {STATUS_LABEL[i.status] ?? i.status}
                        </span>
                      )}
                      {i.kind === "action" && (
                        <button
                          onClick={() => setExpandedId(expanded ? null : i.id)}
                          className="text-xs font-medium text-sky-600"
                        >
                          Why?
                        </button>
                      )}
                    </div>
                  </div>
                  {i.kind === "task" && <p className="text-sm text-slate-600">{i.description}</p>}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                    <span>Due {i.due}</span>
                    {i.related_client && <span>Client: {i.related_client}</span>}
                    {i.raised_by && <span>Raised by {i.raised_by}</span>}
                  </div>
                  {i.kind === "action" && expanded && (
                    <div className="mt-1 text-xs text-slate-600 leading-snug bg-gray-50 rounded-md px-3 py-2">
                      <p>{i.whyNow}</p>
                      {i.notes && <p className="mt-1 text-slate-500">{i.notes}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
