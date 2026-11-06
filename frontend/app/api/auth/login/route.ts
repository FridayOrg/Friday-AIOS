import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION, AUTH_COOKIE, COOKIE_MAX_AGE_SECONDS } from "@/lib/auth";

// Demo-only credential check — see middleware.ts's module docstring for why
// this is intentionally not real auth. Credentials come from DEMO_USERS, a
// server-only env var (never NEXT_PUBLIC_, so never shipped to the browser),
// formatted as "email1:password1,email2:password2,email3:password3".
function loadDemoUsers(): Record<string, string> {
  const raw = process.env.DEMO_USERS ?? "";
  const users: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [email, password] = pair.split(":");
    if (email && password) users[email.trim().toLowerCase()] = password;
  }
  return users;
}

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();
  const users = loadDemoUsers();
  const match = typeof email === "string" && users[email.trim().toLowerCase()] === password;

  if (!match) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const res = NextResponse.json({ status: "ok" });
  res.cookies.set(AUTH_COOKIE, ADMIN_SESSION, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
