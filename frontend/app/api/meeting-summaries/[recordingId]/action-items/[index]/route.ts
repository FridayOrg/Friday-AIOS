import { NextRequest, NextResponse } from "next/server";

// Proxies to the FastAPI backend's PATCH /meeting-summaries/{recording_id}/
// action-items/{index} (backend/app/main.py) — sets or clears the CEO's own
// manually-tracked due date for one action item. Called from the "+ Add due
// date" control on the Meeting Summary card.
const FRIDAY_API_URL = process.env.FRIDAY_API_URL ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ recordingId: string; index: string }> }
) {
  const { recordingId, index } = await params;
  const body = await req.json();

  let upstream: Response;
  try {
    upstream = await fetch(
      `${FRIDAY_API_URL}/meeting-summaries/${encodeURIComponent(recordingId)}/action-items/${encodeURIComponent(index)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
  } catch {
    return NextResponse.json(
      { status: "error", detail: "Could not reach the Friday backend." },
      { status: 502 }
    );
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(
      { status: "error", detail: data.detail ?? "Could not update the due date." },
      { status: upstream.status }
    );
  }
  return NextResponse.json(data);
}
