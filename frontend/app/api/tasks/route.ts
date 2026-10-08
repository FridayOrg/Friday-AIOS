import { NextResponse } from "next/server";
import { getTasks } from "@/lib/data";

// getTasks() reads mock-data/tasks.json straight off disk — see
// app/api/actions/route.ts's comment for why this needs force-dynamic.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tasks: getTasks() });
}
