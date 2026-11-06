import { NextRequest } from "next/server";
import { proxyToBackend } from "../proxy";

// Proxies to backend/app/main.py:/proposals/generate (see ../proxy.ts for why).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return proxyToBackend("/proposals/generate", await req.json());
}
