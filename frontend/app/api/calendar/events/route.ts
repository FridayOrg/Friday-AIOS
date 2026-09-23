import { NextRequest, NextResponse } from "next/server";

// Proxies to the FastAPI backend's POST /calendar/events (backend/app/main.py).
// Not used by Ask Friday's own chat flow — the agent schedules a meeting
// directly server-side the moment it has full details (see main.py's
// _execute_schedule_proposal), with no separate confirm click. This route
// stays as a direct way to create an event given full details up front.
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${FRIDAY_API_URL}/calendar/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { status: "error", detail: "Could not reach the Friday backend." },
      { status: 502 }
    );
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(
      { status: "error", detail: data.detail ?? "Could not create the event." },
      { status: upstream.status }
    );
  }
  return NextResponse.json(data);
}
