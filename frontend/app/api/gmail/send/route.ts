import { NextRequest, NextResponse } from "next/server";

// Proxies to the FastAPI backend's POST /gmail/send (backend/app/main.py).
// Called from EmailDraftCard's "Send" button — one of two ways to confirm an
// email draft (the other is replying "yes, send it" in chat, handled
// server-side against conversation history). Neither path fires without an
// explicit user action.
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${FRIDAY_API_URL}/gmail/send`, {
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
      { status: "error", detail: data.detail ?? "Could not send the email." },
      { status: upstream.status }
    );
  }
  return NextResponse.json(data);
}
