import { NextResponse } from "next/server";
import { getContextFiles } from "@/lib/data";

export async function GET() {
  return NextResponse.json({ files: getContextFiles() });
}
