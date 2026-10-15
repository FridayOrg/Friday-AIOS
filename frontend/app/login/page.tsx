"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Lock, Mail, TrendingUp, User, UserRound, ArrowRight } from "lucide-react";
import { setFounderName } from "@/lib/founderName";

type Tab = "guest" | "user";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  // Purely visual — "Continue as Guest" always logs in immediately on click
  // regardless of which tab is shown as active; the User Login form below is
  // always rendered either way. This just mirrors the two-tab look of the
  // design, since there's no separate "guest view" content to switch to.
  const [activeTab, setActiveTab] = useState<Tab>("guest");

  // Warm up the destination route while the user is still typing.
  useEffect(() => {
    router.prefetch(next);
  }, [router, next]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setError(data.error ?? "Invalid email or password.");
      setSubmitting(false);
      return;
    }
    // Whatever name was typed in becomes the greeting name app-wide (see
    // lib/founderName.ts — same localStorage-backed mechanism the Profile
    // page's edit-name pencil uses).
    setFounderName(name);
    // Stay in the "Signing in…" state until the next page takes over, instead
    // of flipping back to "Sign in" while the dashboard loads. No router.refresh():
    // push already renders the destination fresh with the new cookie.
    router.push(next);
  }

  async function handleGuest() {
    setActiveTab("guest");
    setError(null);
    setGuestLoading(true);
    const res = await fetch("/api/auth/guest-login", { method: "POST" }).catch(() => null);
    if (!res || !res.ok) {
      setError("Could not continue as guest. Please try again.");
      setGuestLoading(false);
      return;
    }
    // "Guest" is handled specially by CeoDashboard.tsx's greetingFor(),
    // which shows "Welcome Guest" instead of the usual time-of-day greeting.
    setFounderName("Guest");
    router.push(next);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F6F8] px-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-[2fr_3fr]">
        {/* ---------------- LEFT: branding panel ---------------- */}
        <div className="relative flex flex-col justify-between p-8 bg-gradient-to-br from-[#EEF2FF] via-[#F2F6FF] to-[#E7EEFF] overflow-hidden">
          <div
            aria-hidden
            className="absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-blue-200/40"
          />
          <div
            aria-hidden
            className="absolute -bottom-28 left-10 h-72 w-72 rounded-full bg-blue-300/30"
          />
          <div className="relative z-10">
            <div className="mb-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/friday-logo.png" alt="Friday" className="h-7 w-auto object-contain" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2 leading-snug">
              Smarter insights.
              <br />
              Better decisions.
            </h2>
            <p className="text-sm text-slate-500">Your AI-powered assistant for what matters most.</p>
          </div>
          <div className="relative z-10 flex flex-col items-center gap-2 pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/login-illustration.png" alt="" className="w-44 h-auto object-contain" />
            <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <TrendingUp size={12} />
              Trending up
            </div>
          </div>
        </div>

        {/* ---------------- RIGHT: form panel ---------------- */}
        <div className="p-8">
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 mb-5">
            <button
              type="button"
              onClick={handleGuest}
              disabled={guestLoading}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                activeTab === "guest" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <UserRound size={14} />
              {guestLoading ? "Continuing…" : "Continue as Guest"}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("user")}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${
                activeTab === "user" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <User size={14} />
              User Login
            </button>
          </div>

          <div className="flex items-center gap-3 mb-5">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-[11px] text-slate-400">OR</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <h1 className="text-xl font-bold text-slate-900 mb-6">User Login</h1>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="Your name"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="you@bookmysales.ai"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 pl-9 pr-10 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 text-white text-sm font-semibold py-3 hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Signing in…" : (
                <>
                  Sign in
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
