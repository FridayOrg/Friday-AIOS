import { NextResponse } from "next/server";

const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${FRIDAY_API_URL}/daily-brief`, { cache: "no-store" });
    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `Friday backend error: ${detail}` },
        { status: 502 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
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
