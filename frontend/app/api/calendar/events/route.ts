import { NextRequest, NextResponse } from "next/server";

// Proxies to the FastAPI backend's POST /calendar/events (backend/app/main.py) —
// the one write/action endpoint in this app. Only ever called from
// ScheduleProposalCard.tsx's "Confirm & Schedule" button, i.e. only after a
// human has explicitly approved a proposal Ask Friday drafted; nothing here
// decides on its own to create an event.
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
