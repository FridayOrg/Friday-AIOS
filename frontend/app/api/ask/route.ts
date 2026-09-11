import { NextRequest, NextResponse } from "next/server";

// Proxies to the FastAPI backend's streaming endpoint (backend/app/main.py:/ask/stream).
// Kept as a server-side proxy rather than calling the backend directly from the
// browser so the backend's address never has to be exposed to client code and CORS
// isn't a concern. The response body is piped straight through unbuffered so the
// browser gets each chunk as Gemini generates it, rather than Next.js waiting for
// the full answer before forwarding anything.
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const history = Array.isArray(body.history) ? body.history : undefined;

  if (!question) {
    return NextResponse.json({ error: "question must not be empty" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${FRIDAY_API_URL}/ask/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not reach the Friday backend. Is it running? (uvicorn backend.app.main:app --reload)",
      },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Friday backend error: ${detail}` },
      { status: 502 }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
