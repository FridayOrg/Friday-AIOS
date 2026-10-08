import { NextResponse } from "next/server";
import { getActions } from "@/lib/data";

// getActions() reads mock-data/generated_actions.json straight off disk —
// no fetch() call for Next.js's build-time caching heuristics to notice, so
// without this the route gets statically cached at build time and keeps
// serving whatever the file looked like at the last build, even across
// later deploys with a freshly-regenerated file on disk.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ actions: getActions() });
}
