import { Target } from "lucide-react";

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
        color: "#101828",
        background: "linear-gradient(135deg, #EAF7F1 0%, #EEEBFB 45%, #FBF0F6 100%)",
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');`}</style>
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold">Goals</h1>
          <p className="text-sm mt-0.5" style={{ color: "#667085" }}>
            Current strategic priorities
          </p>
        </div>

        <div
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(16,24,40,0.07)" }}
        >
          {goals.length === 0 ? (
            <p className="text-sm" style={{ color: "#98A2B3" }}>No goals found in strategy.md.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {goals.map((goal, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className="mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
                    style={{ background: "#E9F9F5", color: "#0F9E8E" }}
                  >
                    {i + 1}
                  </span>
                  <p className="text-sm leading-relaxed" style={{ color: "#344054" }}>{goal}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: "#98A2B3" }}>
          <Target size={12} />
          Sourced from Context/strategy.md
        </div>
      </div>
    </div>
  );
}
