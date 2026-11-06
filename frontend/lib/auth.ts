// Demo-auth constants shared by middleware.ts, the auth routes and the app shell.
// See middleware.ts for why this is a demo gate, not real security.

export const AUTH_COOKIE = "friday_demo_auth";
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12h, long enough to cover a demo day

// Cookie values. Admin stays "1" so sessions issued before roles existed keep working.
export const ADMIN_SESSION = "1";
export const GUEST_SESSION = "guest";

// A guest (people the CEO shares a demo login with) sees the real, working app —
// same as an admin — with one exception: the Proposal Generator is still in testing,
// so it's the one area kept out of guest sessions entirely (no nav tab, no page, no
// API access — not even a locked placeholder, it's just not there for a guest).
export const GUEST_HOME = "/";
const GUEST_BLOCKED_PREFIXES = ["/proposals", "/api/proposals"];

export function isGuestBlocked(pathname: string): boolean {
  return GUEST_BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
