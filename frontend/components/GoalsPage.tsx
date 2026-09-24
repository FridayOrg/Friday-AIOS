import { Target } from "lucide-react";
import { C, PAGE_BG, CARD_BG } from "@/lib/dashboardTokens";

// The /goals page — its own tab, reading directly from Context/strategy.md's
// "Current Goals" list (see lib/data.ts's getStrategyGoals) rather than a
// separately-maintained list, so it always matches what the AI agent itself
// reasons from.
export default function GoalsPage({ goals }: { goals: string[] }) {
  return (
    <div
      style={{
        minHeight: "100%",
        fontFamily: "'Inter', system-ui, sans-serif",
        color: C.ink,
        background: PAGE_BG,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');`}</style>
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold">Goals</h1>
          <p className="text-sm mt-0.5" style={{ color: C.muted }}>
            Current strategic priorities
          </p>
        </div>

        <div
          className="rounded-2xl p-5"
          style={{ background: CARD_BG, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}
        >
          {goals.length === 0 ? (
            <p className="text-sm" style={{ color: C.faint }}>No goals found in strategy.md.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {goals.map((goal, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className="mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
                    style={{ background: "rgba(14,165,233,0.12)", color: C.teal }}
                  >
                    {i + 1}
                  </span>
                  <p className="text-sm leading-relaxed" style={{ color: C.ink }}>{goal}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: C.faint }}>
          <Target size={12} />
          Sourced from Context/strategy.md
        </div>
      </div>
    </div>
  );
}
