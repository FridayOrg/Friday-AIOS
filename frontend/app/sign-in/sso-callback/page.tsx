"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

// Renders nothing visible — just finishes the Google redirect Clerk started
// on the /sign-in page, then sends the browser on to redirectUrlComplete
// ("/") or back to an error state if this Google account isn't invited.
export default function SSOCallbackPage() {
  return <AuthenticateWithRedirectCallback />;
}
