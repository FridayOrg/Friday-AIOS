"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  CheckSquare,
  User,
  Briefcase,
  Target,
  Bell,
  Menu,
  X,
  LogOut,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/crm", label: "CRM", icon: Briefcase },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/company", label: "Company", icon: Building2 },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/profile", label: "Profile", icon: User },
];

// Flat, very mild ash background shared by the bar and the mobile dropdown.
const NAV_BG = "#EAF2FF";

// Faint, low-opacity wave shapes over the flat bar background: one soft arc on
// the left and one on the right. Decorative only.
function NavWaves() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 64"
      preserveAspectRatio="none"
      fill="none"
    >
      <path d="M0 0H320C284 18 262 42 222 64H0Z" fill="#BFDBFE" fillOpacity="0.30" />
      <path d="M0 0H190C166 20 150 42 116 64H0Z" fill="#93C5FD" fillOpacity="0.18" />
      <path d="M1200 0V64H940C990 48 1050 28 1086 0Z" fill="#BFDBFE" fillOpacity="0.30" />
      <path d="M1200 0V64H1060C1096 46 1136 26 1156 0Z" fill="#93C5FD" fillOpacity="0.18" />
    </svg>
  );
}

// Horizontal top nav replacing the old left sidebar. Fixed/sticky at the top
// so it stays stable while the page content scrolls beneath it. On small
// screens the nav items collapse behind a hamburger that opens a full-width
// dropdown panel (not a side drawer) directly under the bar.
export default function TopNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header
      className="sticky top-0 z-40 w-full border-b border-[#2563EB] shrink-0"
      style={{ background: NAV_BG }}
    >
      <NavWaves />
      <div className="relative z-10 flex items-center justify-between h-16 px-4 lg:px-6 gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/friday-mark.png" alt="Friday" className="h-8 w-8 rounded-lg object-cover shadow-sm ring-1 ring-slate-200" />
          <span className="text-lg font-bold text-slate-900 hidden sm:inline">
            friday<span className="text-blue-600">.</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white text-[#2563EB] border border-[#2563EB]"
                    : "border border-transparent text-slate-600 hover:bg-white/60 hover:text-slate-900"
                }`}
              >
                <Icon size={16} strokeWidth={2} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right-side actions */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <button
            aria-label="Notifications"
            className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-white/60 hover:text-slate-800"
          >
            <Bell size={18} />
          </button>
          <button
            onClick={handleLogout}
            aria-label="Sign out"
            title="Sign out"
            className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-white/60 hover:text-slate-800"
          >
            <LogOut size={18} />
          </button>
        </div>

        {/* Mobile: hamburger toggle */}
        <button
          onClick={() => setMobileOpen((o) => !o)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="md:hidden h-9 w-9 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white/60"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile dropdown panel */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#2563EB] px-4 py-3" style={{ background: NAV_BG }}>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-white text-[#2563EB] border border-[#2563EB]"
                      : "border border-transparent text-slate-600 hover:bg-white/60"
                  }`}
                >
                  <Icon size={18} strokeWidth={2} />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-2">
            <button
              aria-label="Notifications"
              className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-white/60 hover:text-slate-800"
            >
              <Bell size={18} />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
