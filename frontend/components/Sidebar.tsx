"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  CheckSquare,
  User,
  LogOut,
  ChevronsRight,
  ChevronsLeft,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/company", label: "Company", icon: Building2 },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/profile", label: "Profile", icon: User },
];

// Connections are shown as static status chips only — placeholders for the future
// integrations CLAUDE.md lists (Google Calendar, Sheets/CRM, Drive, Stripe). None of
// this is wired to a real integration; the mock-data files stand in for them for now.
const CONNECTIONS = [
  { label: "Salesforce", status: "Connected" as const },
  { label: "Google Cal", status: "Connected" as const },
  { label: "Stripe", status: "Connected" as const },
  { label: "Drive", status: "Connect" as const },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  // Mobile drawer mode: full nav content regardless of `collapsed`, with a close (X)
  // button instead of the desktop collapse toggle, and nav taps close the drawer.
  mobile?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ collapsed, onToggle, mobile, onClose }: SidebarProps) {
  const pathname = usePathname();

  if (mobile) {
    return (
      <aside className="w-72 max-w-[80vw] shrink-0 bg-white flex flex-col h-full">
        <div className="px-6 pt-6 pb-5 flex items-start justify-between">
          <div>
            <div className="text-2xl font-bold text-slate-900">
              friday<span className="text-blue-600">.</span>
            </div>
            <div className="text-sm text-slate-400 mt-0.5">Chief of Staff</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="px-3 flex flex-col gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon size={18} strokeWidth={2} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 px-6">
          <div className="text-xs font-semibold tracking-wide text-slate-400 mb-3">
            CONNECTIONS
          </div>
          <div className="flex flex-col gap-3">
            {CONNECTIONS.map((c) => (
              <div key={c.label} className="flex items-center justify-between">
                <span className="text-sm text-slate-700">{c.label}</span>
                {c.status === "Connected" ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Connected
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">Connect →</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto px-6 pb-6 pt-4 border-t border-slate-100">
          <button className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700">
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </aside>
    );
  }

  if (collapsed) {
    // Collapsed: logo, expand toggle, and nav item icons only — no connections,
    // no logout.
    return (
      <aside className="w-16 shrink-0 border-r border-slate-200 bg-white flex flex-col items-center h-full py-6 gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/friday-mark.png" alt="Friday" className="h-8 w-8 rounded-lg object-cover mb-4" />
        <button
          onClick={onToggle}
          aria-label="Expand sidebar"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 mb-4"
        >
          <ChevronsRight size={16} />
        </button>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              className={`h-10 w-10 rounded-lg flex items-center justify-center transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              <Icon size={18} strokeWidth={2} />
            </Link>
          );
        })}
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col h-full">
      <div className="px-6 pt-6 pb-5 flex items-start justify-between">
        <div>
          <div className="text-2xl font-bold text-slate-900">
            friday<span className="text-blue-600">.</span>
          </div>
          <div className="text-sm text-slate-400 mt-0.5">Chief of Staff</div>
        </div>
        <button
          onClick={onToggle}
          aria-label="Collapse sidebar"
          className="h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50"
        >
          <ChevronsLeft size={16} />
        </button>
      </div>

      <nav className="px-3 flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Icon size={18} strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 px-6">
        <div className="text-xs font-semibold tracking-wide text-slate-400 mb-3">
          CONNECTIONS
        </div>
        <div className="flex flex-col gap-3">
          {CONNECTIONS.map((c) => (
            <div key={c.label} className="flex items-center justify-between">
              <span className="text-sm text-slate-700">{c.label}</span>
              {c.status === "Connected" ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Connected
                </span>
              ) : (
                <span className="text-xs text-slate-400">Connect →</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto px-6 pb-6 pt-4 border-t border-slate-100">
        <button className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700">
          <LogOut size={16} />
          Log out
        </button>
      </div>
    </aside>
  );
}
