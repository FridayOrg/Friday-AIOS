import { Target } from "lucide-react";

// Left-side panel on both the main dashboard and /crm — reads its content
// from Context/strategy.md's "Current Goals" list (see lib/data.ts's
// getStrategyGoals) rather than a hardcoded/separately-maintained list, so it
// always reflects the same goals the AI agent itself reasons from.
export default function GoalsPanel({ goals }: { goals: string[] }) {
  return (
    <div
      className="w-full lg:w-64 shrink-0 rounded-2xl p-5 self-start"
      style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(16,24,40,0.07)" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#E7E4FC] shrink-0">
          <Target size={14} className="text-[#6E5AE0]" />
        </span>
        <h2 className="text-sm font-semibold">Goals</h2>
      </div>
      <p className="text-xs mb-4" style={{ color: "#98A2B3" }}>
        Current strategic priorities
      </p>
      {goals.length === 0 ? (
        <p className="text-xs" style={{ color: "#98A2B3" }}>No goals found in strategy.md.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((goal, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span
                className="mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold"
                style={{ background: "#E9F9F5", color: "#0F9E8E" }}
              >
                {i + 1}
              </span>
              <p className="text-xs leading-relaxed" style={{ color: "#344054" }}>{goal}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
