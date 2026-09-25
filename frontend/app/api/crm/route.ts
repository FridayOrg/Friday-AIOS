import { NextRequest, NextResponse } from "next/server";

// Thin proxy to the FastAPI backend's GET /crm/overview (backend/app/main.py,
// data derived in backend/app/crm_metrics.py from live HubSpot data) — same
// pattern as the other app/api/*/route.ts files. Forwards the date-filter
// query params straight through; the backend does all the range math.
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search; // includes leading "?" or is ""
  try {
    const res = await fetch(`${FRIDAY_API_URL}/crm/overview${qs}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`/crm/overview returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Could not fetch CRM overview from the Friday backend:", err);
    return NextResponse.json(
      { configured: false, message: "Could not reach the Friday backend." },
      { status: 502 }
    );
  }
}
