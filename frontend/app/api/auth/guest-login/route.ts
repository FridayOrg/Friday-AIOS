import { NextResponse } from "next/server";
import { AUTH_COOKIE, COOKIE_MAX_AGE_SECONDS, GUEST_SESSION } from "@/lib/auth";

// Guest login — no credentials required. Sets the guest session value, which
// middleware.ts keeps out of the Proposal Generator only (see lib/auth.ts);
// every other tab works normally. See app/login/page.tsx's "Continue as Guest"
// button and CeoDashboard.tsx's greetingFor(), which special-cases the name
// "Guest" into "Welcome Guest" instead of the time-of-day greeting.
export async function POST() {
  const res = NextResponse.json({ status: "ok" });
  res.cookies.set(AUTH_COOKIE, GUEST_SESSION, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
