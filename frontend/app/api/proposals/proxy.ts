import { NextResponse } from "next/server";

// Server-side proxy to the FastAPI backend, same reasoning as app/api/ask/route.ts:
// the backend's address never reaches client code, and the proposal brain it reads
// stays entirely on the server.
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export async function proxyToBackend(path: string, body: unknown) {
  let upstream: Response;
  try {
    upstream = await fetch(`${FRIDAY_API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the Friday backend. Is it running? (uvicorn backend.app.main:app --reload)" },
      { status: 502 }
    );
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Something went wrong.";
    return NextResponse.json({ error: detail }, { status: upstream.status });
  }
  return NextResponse.json(data);
}
