import { NextRequest, NextResponse } from "next/server";

// Demo-only login gate for presenting the app (e.g. at BNI) without exposing
// it unauthenticated. NOT real security: see app/api/auth/login/route.ts —
// plaintext credential comparison against a few env-configured pairs, no
// hashing, no rate-limiting, no password reset. Fine for a controlled demo
// in front of an audience; replace with NextAuth.js (or similar) before this
// ever holds real customer data or is left publicly reachable long-term.
const AUTH_COOKIE = "friday_demo_auth";

// Paths that must stay reachable without the cookie, or nobody could ever
// log in (the login page itself, its API route, and Next's own internals).
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/friday-mark.png"
  ) {
    return NextResponse.next();
  }

  const authed = request.cookies.get(AUTH_COOKIE)?.value === "1";
  if (!authed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except static assets — api routes ARE covered (so the
  // backend-proxying routes can't be hit directly without logging in first).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
