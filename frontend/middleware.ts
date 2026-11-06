import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION, AUTH_COOKIE, GUEST_SESSION, isGuestBlocked } from "@/lib/auth";

// Demo-only login gate for presenting the app (e.g. at BNI) without exposing
// it unauthenticated. NOT real security: see app/api/auth/login/route.ts —
// plaintext credential comparison against a few env-configured pairs, no
// hashing, no rate-limiting, no password reset. Fine for a controlled demo
// in front of an audience; replace with NextAuth.js (or similar) before this
// ever holds real customer data or is left publicly reachable long-term.
//
// Two roles: admin (full app) and guest (full app except the Proposal
// Generator, still in testing — see lib/auth.ts). A guest hitting /proposals
// or its API is redirected to "/", same as a page that doesn't exist for them;
// there's no locked placeholder to tell them it's there.

// Paths that must stay reachable without the cookie, or nobody could ever
// log in (the login page itself, its API route, and Next's own internals).
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/guest-login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/friday-mark.png" ||
    pathname === "/friday-logo.png" ||
    pathname === "/login-illustration.png"
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get(AUTH_COOKIE)?.value;
  if (session !== ADMIN_SESSION && session !== GUEST_SESSION) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session === GUEST_SESSION && isGuestBlocked(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not available." }, { status: 404 });
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except static assets — api routes ARE covered (so the
  // backend-proxying routes can't be hit directly without logging in first).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
