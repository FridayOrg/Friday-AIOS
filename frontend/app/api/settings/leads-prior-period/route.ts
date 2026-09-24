import { NextRequest, NextResponse } from "next/server";

// Proxies to the FastAPI backend's GET/PATCH /settings/leads-prior-period
// (backend/app/main.py) — the CEO-entered "leads in the prior period"
// baseline used for the Daily Brief leads card's %-change badge. Pipedrive's
// Leads Inbox can't reconstruct this once a lead is deleted/converted, so
// it's a manually-recorded figure rather than a live Pipedrive read.
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${FRIDAY_API_URL}/settings/leads-prior-period`, { cache: "no-store" });
    if (!res.ok) throw new Error(`/settings/leads-prior-period returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Could not fetch leads prior-period count from the Friday backend:", err);
    return NextResponse.json({ error: "Could not reach the Friday backend." }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${FRIDAY_API_URL}/settings/leads-prior-period`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json({ status: "error", detail: "Could not reach the Friday backend." }, { status: 502 });
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(
      { status: "error", detail: data.detail ?? "Could not update the leads prior-period count." },
      { status: upstream.status }
    );
  }
  return NextResponse.json(data);
}
