import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /sign-in and its Google-redirect callback are the only pages a logged-out
// visitor may reach. Everything else — every page and every /api/* route
// that talks to the Friday backend — requires a signed-in, invited user.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless they're referenced in
    // search params (Clerk's own recommended default matcher).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
