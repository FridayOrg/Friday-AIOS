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

type Horizon = "Today" | "This Week";
type LocalStatus = "done" | "in_progress" | "dismissed";

interface Evidence {
  source: string; // "CRM" | "Meeting" | "Email" | "Calendar"
  signal: string;
}

interface Action {
  actionId: string;
  priority: string; // "Critical" | "High" | "Low" — as given in actions.json
  action: string;
  owner: string;
  due: string;
  deal: string;
  account: string;
  value: number;
  expectedClose: string | null;
  whyNow: string;
  notes: string;
  evidence: Evidence[];
}

function formatValue(value: number): string {
  if (value >= 1000) return `£${Math.round(value / 100) / 10}k`;
  return `£${value}`;
}

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

// Overdue / due today -> red (most urgent); due tomorrow / due this week ->
// amber; further out -> no badge at all, same red/amber scale as the CRM
// dashboard's close-date column (CrmDashboard.tsx's closeDateTone). Driven
// by the CRM's own expected close date, NOT this action's own due date —
// two independent dates (one is "when the deal should close", the other is
// "when Friday wants a follow-up") that happen to coincide sometimes.
//
// Returns the bucket's sort rank alongside its label/color so the list can
// be ordered Overdue -> Due today -> Due tomorrow -> Due this week -> (no
// badge, sorted last) — the same urgency scale the badge itself shows,
// instead of a separately-maintained priority ranking.
function closeDateTag(expectedClose: string | null): { label: string; className: string; rank: number } | null {
  if (!expectedClose) return null;
  const today = isoDay(new Date());
  const date = new Date(expectedClose + "T00:00:00");
  const base = new Date(today + "T00:00:00");
  const days = Math.round((date.getTime() - base.getTime()) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return { label: "Overdue", className: "bg-red-100 text-red-700", rank: 0 };
  if (days === 0) return { label: "Due today", className: "bg-red-100 text-red-700", rank: 1 };
  if (days === 1) return { label: "Due tomorrow", className: "bg-amber-100 text-amber-700", rank: 2 };
  if (days <= 7) return { label: "Due this week", className: "bg-amber-100 text-amber-700", rank: 3 };
  return null;
}

const UNRANKED = 4; // no badge (further out, or no close date at all) — sorts last

function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Filters work off the CRM's own expected close date (not this action's own
// due date — see closeDateTag's comment on why those are two independent
// dates), same field the close-date badge and sort order already use, so
// the filter and what's actually shown agree with each other. "Today" =
// closes today; "This Week" = closes within the next 7 days (today through
// today+6, the same rolling window closeDateTag's "Due this week" bucket
// uses) — a deal closing next week or later simply doesn't show until that
// week actually arrives, rather than being visible early under a calendar-
// week definition.
function inHorizon(expectedClose: string | null, h: "all" | Horizon): boolean {
  if (h === "all") return true;
  if (!expectedClose) return false;
  const now = new Date();
  const today = isoDay(now);
  if (h === "Today") return expectedClose === today;
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6);
  return expectedClose >= today && expectedClose <= isoDay(weekEnd);
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
        .map((action) => ({ action }))
        .sort((a, b) => {
          const rankA = closeDateTag(a.action.expectedClose)?.rank ?? UNRANKED;
          const rankB = closeDateTag(b.action.expectedClose)?.rank ?? UNRANKED;
          return rankA - rankB;
        }),
    [actions]
  );

  const visibleItems = items.filter((i) => inHorizon(i.action.expectedClose, horizonFilter));

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
                <p className="text-[13px] font-medium leading-snug text-slate-900">
                  {item.action.account || item.action.deal}
                  {typeof item.action.value === "number" && ` – ${formatValue(item.action.value)}`}
                  {" / "}
                  {item.action.action}
                </p>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <div className="flex items-center gap-2 min-w-0">
                    {(() => {
                      const tag = closeDateTag(item.action.expectedClose);
                      return tag ? (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${tag.className}`}>
                          {tag.label}
                        </span>
                      ) : null;
                    })()}
                    <span className="text-xs text-slate-500 truncate">· {item.action.owner}</span>
                  </div>
                  <button
                    onClick={() => setExpandedActionId(expanded ? null : item.action.actionId)}
                    className="shrink-0 text-xs text-blue-600"
                  >
                    Why?
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-xs text-slate-500">{item.action.deal}</span>
                </div>
                {expanded && (
                  <div className="mt-2 text-xs text-slate-600 leading-snug bg-slate-50 rounded-md px-2.5 py-2 space-y-1.5">
                    {item.action.evidence?.map((e, i) => (
                      <p key={i}>
                        <span className="font-medium text-slate-700">{e.source} signal: </span>
                        {e.signal}
                      </p>
                    ))}
                    <p className="pt-1 border-t border-slate-200">
                      <span className="font-medium text-slate-700">Friday recommendation: </span>
                      {item.action.whyNow}
                    </p>
                    {item.action.notes && <p className="text-slate-500">{item.action.notes}</p>}
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
