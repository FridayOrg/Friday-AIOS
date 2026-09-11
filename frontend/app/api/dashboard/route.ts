import { NextResponse } from "next/server";
import {
  getTodaysMeetings,
  getAttentionItems,
  getSpendToday,
  getRevenue,
} from "@/lib/data";

// Real-clock dependent (today's meetings, past vs. upcoming) — never cache this.
export const dynamic = "force-dynamic";

export async function GET() {
  const meetings = getTodaysMeetings();
  const attention = getAttentionItems();
  const spend = getSpendToday();
  const revenue = getRevenue();

  return NextResponse.json({ meetings, attention, spend, revenue });
}
