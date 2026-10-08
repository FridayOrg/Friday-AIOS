import { NextRequest, NextResponse } from "next/server";

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

const AUTH_COOKIE = "friday_demo_auth";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12h — long enough to cover a demo day

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();
  const users = loadDemoUsers();
  const match = typeof email === "string" && users[email.trim().toLowerCase()] === password;

  if (!match) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const res = NextResponse.json({ status: "ok" });
  res.cookies.set(AUTH_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
