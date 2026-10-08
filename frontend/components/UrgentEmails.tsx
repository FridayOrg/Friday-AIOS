"use client";

// A standalone, self-contained dashboard widget: fetches its own data
// client-side from /api/actions rather than going through lib/data.ts's
// getDashboardData(), so this feature stays fully isolated from the
// existing calendar/revenue data plumbing — nothing here is threaded
// through DashboardData. Mounted inside CeoDashboard's "My Priorities" card
// (see CeoDashboard.tsx) as a full-width strip below the 4 stat tiles, so
// it's unstyled at the outer level (no page padding/card of its own) — the
// parent card already provides that chrome.
//
// Shows only actions.json-derived data — emails are deliberately not shown
// here (removed per request); "View more" links to the full /tasks page.
//
// Today / This Week filter + Done/In Progress/Dismissed status are local-only
// (component state, not persisted) — see Monday PM sprint-plan item: "works
// locally", no backend write yet.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PriorityTier = "critical" | "high" | "low";
type Horizon = "Today" | "This Week";
type LocalStatus = "done" | "in_progress" | "dismissed";

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

const TIER_RANK: Record<PriorityTier, number> = { critical: 0, high: 1, low: 2 };
const TIER_LABEL: Record<PriorityTier, { text: string; className: string }> = {
  critical: { text: "Critical", className: "bg-red-200 text-red-800" },
  high: { text: "High", className: "bg-amber-100 text-amber-700" },
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
  const t = TIER_LABEL[tier] ?? TIER_LABEL.low;
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${t.className}`}>{t.text}</span>;
}

// Every action is always shown here — actions.json already is the curated
// "needs attention" list, nothing to filter further. Priority comes
// straight from the file, not re-derived from any date.
function actionTier(a: Action): PriorityTier {
  if (a.priority === "Critical") return "critical";
  if (a.priority === "High") return "high";
  return "low";
}

function actionHorizon(a: Action): Horizon {
  return a.timeHorizon === "Today" ? "Today" : "This Week";
}

export default function UrgentEmails() {
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [horizonFilter, setHorizonFilter] = useState<"all" | Horizon>("all");
  const [localStatus, setLocalStatus] = useState<Record<string, LocalStatus>>({});

  useEffect(() => {
    fetch("/api/actions", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setActions(d.actions ?? []))
      .catch(() => setActions([]))
      .finally(() => setLoading(false));
  }, []);

  function setStatus(id: string, status: LocalStatus) {
    setLocalStatus((prev) => ({ ...prev, [id]: prev[id] === status ? undefined : status } as Record<string, LocalStatus>));
  }

  const items = useMemo(
    () =>
      [...actions]
        .map((action) => ({ action, tier: actionTier(action), horizon: actionHorizon(action) }))
        .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]),
    [actions]
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
      </div>
      {loading ? (
        <p className="text-xs text-slate-500 pt-2">Loading priorities...</p>
      ) : visibleItems.length === 0 ? (
        <p className="text-xs text-slate-500 pt-2">Nothing needs your attention right now.</p>
      ) : (
        <div className="flex flex-col max-h-56 overflow-y-auto overflow-x-hidden -mr-2.5 pr-2.5">
          {visibleItems.map((item) => {
            const status = localStatus[item.action.actionId];
            const dimmed = status === "done" || status === "dismissed";
            const expanded = expandedActionId === item.action.actionId;
            return (
              <div key={item.action.actionId} className="py-2.5 row-separator" style={{ opacity: dimmed ? 0.5 : 1 }}>
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
                <div className="flex items-center gap-1 mt-1.5">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setStatus(item.action.actionId, opt.key)}
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full transition-colors ${
                        status === opt.key ? STATUS_STYLE[opt.key] : "bg-gray-100 text-slate-500"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
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
