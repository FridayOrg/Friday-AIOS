"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser, useClerk } from "@clerk/nextjs";
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

// Avatar with a dropdown (email + sign out) and a confirm dialog before the
// actual sign-out call, so a stray click never logs someone out by accident.
function UserMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const email = user?.primaryEmailAddress?.emailAddress;
  const initials = (user?.firstName?.[0] ?? email?.[0] ?? "?").toUpperCase();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={menuOpen}
        className="h-8 w-8 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center text-xs font-semibold hover:bg-violet-500/30 transition-colors"
      >
        {initials}
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-white/10 bg-[#111827] shadow-xl shadow-black/40 py-2 z-50">
          <div className="px-3.5 py-2.5">
            <p className="text-xs uppercase tracking-wide text-slate-500">Signed in as</p>
            <p className="mt-0.5 text-sm font-medium text-slate-100 truncate">{email ?? "—"}</p>
          </div>
          <div className="my-1 border-t border-white/10" />
          <button
            onClick={() => {
              setMenuOpen(false);
              setConfirmOpen(true);
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#111827] p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center">
                <LogOut size={18} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Log out?</h2>
                <p className="mt-0.5 text-sm text-slate-400">
                  Are you sure you want to log out{email ? ` of ${email}` : ""}?
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => signOut({ redirectUrl: "/sign-in" })}
                className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors"
              >
                Yes, log out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
          <UserMenu />
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
            <UserMenu />
          </div>
        </div>
      )}
    </header>
  );
}
