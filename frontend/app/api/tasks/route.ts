import { NextResponse } from "next/server";
import { getTasks } from "@/lib/data";

// getTasks() reads mock-data/tasks.json straight off disk — no fetch() call
// for Next.js's build-time caching heuristics to notice, so without this the
// route gets statically cached at build time and keeps serving a stale read.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tasks: getTasks() });
}
