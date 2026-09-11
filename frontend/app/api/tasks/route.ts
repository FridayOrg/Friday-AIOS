import { NextResponse } from "next/server";
import { getTasks } from "@/lib/data";

export async function GET() {
  return NextResponse.json({ tasks: getTasks() });
}
