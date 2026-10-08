import { NextResponse } from "next/server";

const AUTH_COOKIE = "friday_demo_auth";

export async function POST() {
  const res = NextResponse.json({ status: "ok" });
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
