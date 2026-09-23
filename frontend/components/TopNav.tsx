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
  Search,
  Bell,
  Menu,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/crm", label: "CRM", icon: Briefcase },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/company", label: "Company", icon: Building2 },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/profile", label: "Profile", icon: User },
];

// Horizontal top nav replacing the old left sidebar. Fixed/sticky at the top
// so it stays stable while the page content scrolls beneath it. On small
// screens the nav items collapse behind a hamburger that opens a full-width
// dropdown panel (not a side drawer) directly under the bar.
export default function TopNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full bg-[#0F172A] border-b border-white/10 shrink-0">
      <div className="flex items-center justify-between h-16 px-4 lg:px-6 gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/friday-mark.png" alt="Friday" className="h-8 w-8 rounded-lg object-cover" />
          <span className="text-lg font-bold text-white hidden sm:inline">
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
                    ? "bg-sky-500/15 text-sky-300"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
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
            aria-label="Search"
            className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-white/5 hover:text-slate-200"
          >
            <Search size={18} />
          </button>
          <button
            aria-label="Notifications"
            className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-white/5 hover:text-slate-200"
          >
            <Bell size={18} />
          </button>
          <div className="h-8 w-8 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center">
            <User size={16} />
          </div>
        </div>

        {/* Mobile: hamburger toggle */}
        <button
          onClick={() => setMobileOpen((o) => !o)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="md:hidden h-9 w-9 rounded-lg flex items-center justify-center text-slate-300 hover:bg-white/5"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile dropdown panel */}
      {mobileOpen && (
        <div className="md:hidden border-t border-white/10 bg-[#0F172A] px-4 py-3">
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
                      ? "bg-sky-500/15 text-sky-300"
                      : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  <Icon size={18} strokeWidth={2} />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
            <button
              aria-label="Search"
              className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-white/5 hover:text-slate-200"
            >
              <Search size={18} />
            </button>
            <button
              aria-label="Notifications"
              className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-white/5 hover:text-slate-200"
            >
              <Bell size={18} />
            </button>
            <div className="h-8 w-8 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center">
              <User size={16} />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
