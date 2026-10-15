import { NextResponse } from "next/server";

// Guest login — no credentials required, sets the exact same demo-auth
// cookie app/api/auth/login/route.ts does (so middleware.ts's gate treats
// a guest identically to an admin login) but skips the DEMO_USERS check
// entirely. See app/login/page.tsx's "Continue as Guest" button and
// CeoDashboard.tsx's greetingFor(), which special-cases the name "Guest"
// into "Welcome Guest" instead of the time-of-day greeting.
const AUTH_COOKIE = "friday_demo_auth";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12h, same as the admin login

export async function POST() {
  const res = NextResponse.json({ status: "ok" });
  res.cookies.set(AUTH_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
