import { NextRequest, NextResponse } from "next/server";

// Proxies text-to-speech to the FastAPI backend (which holds the ElevenLabs key).
// Same pattern as /api/ask — the backend address and key never reach the browser.
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text must not be empty" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${FRIDAY_API_URL}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the Friday backend." },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Voice backend error: ${detail}` },
      { status: upstream.status || 502 }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
