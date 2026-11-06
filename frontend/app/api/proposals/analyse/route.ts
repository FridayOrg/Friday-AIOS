import { NextRequest } from "next/server";
import { proxyToBackend } from "../proxy";

// Proxies to backend/app/main.py:/proposals/analyse (see ../proxy.ts for why).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return proxyToBackend("/proposals/analyse", await req.json());
}
