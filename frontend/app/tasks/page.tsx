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

const STATUS_STYLE: Record<string, string> = {
  overdue: "bg-red-50 text-red-600",
  pending: "bg-amber-50 text-amber-600",
};

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

// Overdue tasks always surface first, then by priority — same "what needs
// attention" ordering as the dashboard, so Tasks isn't just raw JSON order.
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

const STATUS_FILTERS = ["all", "overdue", "pending"] as const;
const PRIORITY_FILTERS = ["all", "high", "medium", "low"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
type PriorityFilter = (typeof PRIORITY_FILTERS)[number];

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
          ? "bg-blue-50 text-blue-700"
          : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => setTasks(data.tasks))
      .finally(() => setLoading(false));
  }, []);

  const visibleTasks = useMemo(() => {
    return tasks
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
      .filter((t) => priorityFilter === "all" || t.priority === priorityFilter)
      .slice()
      .sort((a, b) => {
        if (a.status === "overdue" && b.status !== "overdue") return -1;
        if (b.status === "overdue" && a.status !== "overdue") return 1;
        return (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99);
      });
  }, [tasks, statusFilter, priorityFilter]);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <CheckSquare size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading tasks…</p>
      ) : (
        <>
          <div className="flex flex-col gap-2 mb-5">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_FILTERS.map((s) => (
                <FilterPill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                  {s}
                </FilterPill>
              ))}
              <span className="hidden sm:inline w-px h-4 bg-slate-200 mx-1" />
              {PRIORITY_FILTERS.map((p) => (
                <FilterPill key={p} active={priorityFilter === p} onClick={() => setPriorityFilter(p)}>
                  {p === "all" ? "all priority" : p}
                </FilterPill>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {visibleTasks.length === 0 && (
              <p className="text-sm text-slate-400">No tasks match these filters.</p>
            )}
            {visibleTasks.map((t) => (
              <div
                key={t.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{t.title}</h3>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${
                        PRIORITY_STYLE[t.priority] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {t.priority}
                    </span>
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${
                        STATUS_STYLE[t.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-slate-600">{t.description}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 mt-1">
                  <span>Due {t.due_date}</span>
                  {t.related_client && <span>Client: {t.related_client}</span>}
                  {t.raised_by && <span>Raised by {t.raised_by}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
