import { NextResponse } from "next/server";
import { getContextFiles } from "@/lib/data";

// getContextFiles() reads from Context/ straight off disk — see
// app/api/actions/route.ts's comment for why this needs force-dynamic.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ files: getContextFiles() });
}
