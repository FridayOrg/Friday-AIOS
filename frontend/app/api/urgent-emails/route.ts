import { NextResponse } from "next/server";

// Thin proxy to the FastAPI backend's Gmail endpoints (backend/app/main.py:
// /gmail/urgent, /gmail/refresh) — same pattern as the other app/api/*/route.ts
// files. Kept as its own isolated route, separate from lib/data.ts, so this
// feature never touches the existing calendar/tasks/revenue data plumbing.
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${FRIDAY_API_URL}/gmail/urgent`, { cache: "no-store" });
    if (!res.ok) throw new Error(`/gmail/urgent returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Could not fetch urgent emails from the Friday backend:", err);
    return NextResponse.json({ emails: [] });
  }
}

export async function POST() {
  try {
    const res = await fetch(`${FRIDAY_API_URL}/gmail/refresh`, { method: "POST" });
    if (!res.ok) throw new Error(`/gmail/refresh returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Could not refresh urgent emails via the Friday backend:", err);
    return NextResponse.json({ status: "error" }, { status: 502 });
  }
}
