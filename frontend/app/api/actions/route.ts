import { NextResponse } from "next/server";
import { getActions } from "@/lib/data";

export async function GET() {
  return NextResponse.json({ actions: getActions() });
}
