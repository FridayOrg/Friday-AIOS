"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckSquare } from "lucide-react";

// tasks.json is deliberately not shown here — "Today's Priorities" replaces
// the old task list entirely rather than merging it in; this page now shows
// only actions.json.
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

const PRIORITY_STYLE: Record<string, string> = {
  critical: "bg-red-200 text-red-800",
  high: "bg-red-100 text-red-700",
  low: "bg-gray-100 text-slate-600",
};

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, low: 2 };

const PRIORITY_FILTERS = ["all", "critical", "high", "low"] as const;
type PriorityFilter = (typeof PRIORITY_FILTERS)[number];

function normalizeActionPriority(p: string): "critical" | "high" | "low" {
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
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/actions")
      .then((r) => r.json())
      .then((data) => setActions(data.actions ?? []))
      .catch(() => setActions([]))
      .finally(() => setLoading(false));
  }, []);

  const visibleActions = useMemo(() => {
    return actions
      .filter((a) => priorityFilter === "all" || normalizeActionPriority(a.priority) === priorityFilter)
      .slice()
      .sort(
        (a, b) =>
          (PRIORITY_RANK[normalizeActionPriority(a.priority)] ?? 99) -
          (PRIORITY_RANK[normalizeActionPriority(b.priority)] ?? 99)
      );
  }, [actions, priorityFilter]);

  return (
    <div className="p-8 max-w-4xl mx-auto min-h-full bg-[#F5F6F8]">
      <div className="flex items-center gap-2 mb-6">
        <CheckSquare size={22} className="text-sky-600" />
        <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="flex flex-col gap-2 mb-5">
            <div className="flex flex-wrap items-center gap-2">
              {PRIORITY_FILTERS.map((p) => (
                <FilterPill key={p} active={priorityFilter === p} onClick={() => setPriorityFilter(p)}>
                  {p === "all" ? "all priority" : p}
                </FilterPill>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {visibleActions.length === 0 && (
              <p className="text-sm text-slate-500">No actions match this filter.</p>
            )}
            {visibleActions.map((a) => {
              const expanded = expandedId === a.actionId;
              const priority = normalizeActionPriority(a.priority);
              return (
                <div
                  key={a.actionId}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-2"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{a.action}</h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${
                          PRIORITY_STYLE[priority] ?? "bg-gray-100 text-slate-600"
                        }`}
                      >
                        {a.priority}
                      </span>
                      <button
                        onClick={() => setExpandedId(expanded ? null : a.actionId)}
                        className="text-xs font-medium text-sky-600"
                      >
                        Why?
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                    <span>Due {a.due}</span>
                    <span>Deal: {a.deal}</span>
                    <span>Owner: {a.owner}</span>
                  </div>
                  {expanded && (
                    <div className="mt-1 text-xs text-slate-600 leading-snug bg-gray-50 rounded-md px-3 py-2">
                      <p>{a.whyNow}</p>
                      {a.notes && <p className="mt-1 text-slate-500">{a.notes}</p>}
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
