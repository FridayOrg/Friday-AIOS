import { NextResponse } from "next/server";

// Thin proxy to the FastAPI backend's Industry Updates endpoints
// (backend/app/main.py: /industry-updates, /industry-updates/refresh) — same
// pattern as the other app/api/*/route.ts files. Kept as its own isolated
// route, separate from lib/data.ts, so this feature never touches the
// existing calendar/tasks/revenue data plumbing.
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

// Server-only (no NEXT_PUBLIC_ prefix, so never shipped to the browser) —
// must match backend's INDUSTRY_UPDATES_REFRESH_SECRET so the manual
// "Refresh" button on the dashboard can call the backend's secret-guarded
// refresh endpoint, the same way the scheduled GitHub Actions cron does.
const REFRESH_SECRET = process.env.INDUSTRY_UPDATES_REFRESH_SECRET ?? "";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${FRIDAY_API_URL}/industry-updates`, { cache: "no-store" });
    if (!res.ok) throw new Error(`/industry-updates returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Could not fetch industry updates from the Friday backend:", err);
    return NextResponse.json({ updates: [] });
  }
}

export async function POST() {
  try {
    const res = await fetch(`${FRIDAY_API_URL}/industry-updates/refresh`, {
      method: "POST",
      headers: { "x-refresh-secret": REFRESH_SECRET },
    });
    if (!res.ok) throw new Error(`/industry-updates/refresh returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Could not refresh industry updates via the Friday backend:", err);
    return NextResponse.json({ status: "error" }, { status: 502 });
  }
}
