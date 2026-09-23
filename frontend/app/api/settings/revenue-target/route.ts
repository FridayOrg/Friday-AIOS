import { NextRequest, NextResponse } from "next/server";

// Proxies to the FastAPI backend's GET/PATCH /settings/revenue-target
// (backend/app/main.py) — the configurable monthly revenue target used by
// the Daily Brief's Revenue card ("[X]% of $[target] target").
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${FRIDAY_API_URL}/settings/revenue-target`, { cache: "no-store" });
    if (!res.ok) throw new Error(`/settings/revenue-target returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Could not fetch revenue target from the Friday backend:", err);
    return NextResponse.json({ error: "Could not reach the Friday backend." }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${FRIDAY_API_URL}/settings/revenue-target`, {
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
      { status: "error", detail: data.detail ?? "Could not update the revenue target." },
      { status: upstream.status }
    );
  }
  return NextResponse.json(data);
}
