import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/data";
import { classifyMeeting } from "@/lib/timeline";
import type { HighlightEntity } from "@/lib/matchTarget";

// Real-clock dependent (calendar dates shift with today) — never cache this.
export const dynamic = "force-dynamic";

// A flat list of dashboard entities Ask Friday can match a question against, so the
// matching itself stays client-side and instant (see lib/matchTarget.ts) instead of
// requiring a backend round-trip on every chat turn.
export async function GET() {
  const data = getDashboardData();

  const entities: HighlightEntity[] = [
    ...data.revenue.byClient.map((c) => ({
      section: "financial" as const,
      id: c.id,
      label: c.name,
      statusKey: c.risk,
    })),
    ...data.pipeline.clients.map((c) => ({
      section: "pipeline" as const,
      id: c.id,
      label: c.name,
      statusKey: c.status,
    })),
    ...data.tasks.map((t) => ({
      section: "tasks" as const,
      id: t.id,
      label: t.title,
      statusKey: t.status === "overdue" ? "overdue" : t.priority,
    })),
    ...data.calendar.map((m) => ({
      section: "calendar" as const,
      id: `${m.date}|${m.time}|${m.name}`,
      label: m.name,
      statusKey: m.priority,
      // Real done/upcoming status (not just a date comparison) — lets the matcher tell
      // "today's standup already happened" from "today's standup is still ahead" when
      // disambiguating which occurrence of a recurring meeting an answer meant.
      done: classifyMeeting(m.date, m.time, m.durationMin, new Date(`${data.today}T${data.now}:00`)).status === "done",
    })),
  ];

  return NextResponse.json({ entities, today: data.today });
}
