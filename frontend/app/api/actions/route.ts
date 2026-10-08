import { NextResponse } from "next/server";

const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

// Shape backend/app/actions_mapper.py's generate_actions() returns (snake_case,
// per playbook.py's _action()).
interface BackendAction {
  action_id: string;
  priority: string;
  action: string;
  owner: string;
  due: string;
  status: string;
  opportunity_id: string;
  deal: string;
  value: number;
  why_now: string;
  source: string;
  rule: string;
  time_horizon: string;
  user_decision: string;
  notes: string;
}

function toCamelCase(a: BackendAction) {
  return {
    actionId: a.action_id,
    priority: a.priority,
    action: a.action,
    owner: a.owner,
    due: a.due,
    status: a.status,
    opportunityId: a.opportunity_id,
    deal: a.deal,
    value: a.value,
    whyNow: a.why_now,
    source: a.source,
    rule: a.rule,
    timeHorizon: a.time_horizon,
    userDecision: a.user_decision,
    notes: a.notes,
  };
}

// Proxies the backend's GET /actions, which computes Today's Priorities fresh
// from the Playbook rules on every call (see actions_mapper.py) — no cached
// file on disk to go stale between runs.
export async function GET() {
  try {
    const res = await fetch(`${FRIDAY_API_URL}/actions`, { cache: "no-store" });
    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `Friday backend error: ${detail}` },
        { status: 502 }
      );
    }
    const data: { actions: BackendAction[] } = await res.json();
    return NextResponse.json({ actions: data.actions.map(toCamelCase) });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not reach the Friday backend. Is it running? (uvicorn backend.app.main:app --reload)",
      },
      { status: 502 }
    );
  }
}
