"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSignIn, useSignUp } from "@clerk/nextjs";

// Our own login screen (Friday logo + "Sign in with Google"), built on
// Clerk's useSignIn() hook rather than Clerk's prebuilt <SignIn> component —
// this is the piece that avoids the "Secured by Clerk" badge that ships on
// the free plan's prebuilt sign-in form.
//
// This page does double duty: a plain visit shows the Google button; a visit
// carrying an invitation ticket (__clerk_ticket / __clerk_status=sign_up,
// appended by Clerk to the link in the invitation email) instead auto-accepts
// that invitation and signs the person straight in — no separate click
// needed, since clicking the emailed link already proved they own that
// invited email address.
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInPageContent />
    </Suspense>
  );
}

function SignInPageContent() {
  const { signIn } = useSignIn(); // null until Clerk has finished loading
  const { signUp } = useSignUp(); // this Clerk version's "Future" signal API
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticket = searchParams.get("__clerk_ticket");
  const ticketStatus = searchParams.get("__clerk_status");
  const showingInviteFlow = !!ticket && ticketStatus === "sign_up";

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ticketSubmitted, setTicketSubmitted] = useState(false);

  // Step 1: hand the ticket to Clerk once. This is fire-and-forget — its
  // result shows up as signUp.status changing, picked up by the effect below
  // (signUp is a reactive "signal": Clerk re-renders us as it updates).
  useEffect(() => {
    if (!showingInviteFlow || ticketSubmitted || !signUp) return;
    setTicketSubmitted(true);
    signUp.ticket({ ticket: ticket! }).then(({ error: ticketError }) => {
      if (ticketError) {
        setError("This invitation link is invalid or has expired. Please ask for a new invite.");
      }
    });
  }, [showingInviteFlow, ticketSubmitted, signUp, ticket]);

  // Step 2: once the ticket exchange reports the sign-up as complete,
  // finalize it into an actual session and take the user into the app.
  useEffect(() => {
    if (signUp?.status !== "complete") return;
    signUp.finalize().then(({ error: finalizeError }) => {
      if (finalizeError) {
        setError("Something went wrong finishing sign-in. Please try again.");
      } else {
        router.push("/");
      }
    });
  }, [signUp?.status, signUp, router]);

  async function handleGoogleSignIn() {
    if (!signIn) return;
    setLoading(true);
    setError(null);
    // redirectCallbackUrl is the intermediate hop that finishes the Google
    // handshake (see app/sign-in/sso-callback); redirectUrl is where the
    // browser lands once sign-in is actually complete.
    const { error: ssoError } = await signIn.sso({
      strategy: "oauth_google",
      redirectCallbackUrl: "/sign-in/sso-callback",
      redirectUrl: "/",
    });
    if (ssoError) {
      // Reaching here means the redirect itself couldn't start (e.g. a
      // network hiccup) — an uninvited Google account instead fails further
      // along, after Google redirects back to /sign-in/sso-callback.
      setLoading(false);
      setError("Something went wrong signing in. Please try again.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F172A] px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/friday-mark.png" alt="Friday" className="h-12 w-12 rounded-xl object-cover" />
          <h1 className="text-xl font-bold text-slate-900">
            friday<span className="text-blue-600">.</span>
          </h1>
          <p className="text-sm text-slate-500 text-center">Sign in to your AI Chief of Staff</p>
        </div>

        {showingInviteFlow && !error ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="h-6 w-6 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
            <p className="text-sm text-slate-500">Accepting your invitation…</p>
          </div>
        ) : (
          <>
            <button
              onClick={handleGoogleSignIn}
              disabled={loading || !signIn}
              className="w-full flex items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <GoogleIcon />
              {loading ? "Redirecting…" : "Sign in with Google"}
            </button>

            {error && <p className="text-sm text-red-600 text-center">{error}</p>}

            <p className="text-xs text-slate-400 text-center">
              Only people invited to this workspace can sign in.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.4C29.6 35.3 26.9 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.6 5.1C9.7 39.7 16.3 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.6l6.6 5.4C39.9 36.9 44 31 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}
