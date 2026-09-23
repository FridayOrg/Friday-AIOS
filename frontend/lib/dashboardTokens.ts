import type React from "react";

// Shared between CeoDashboard.tsx (main dashboard) and CrmDashboard.tsx (the
// separate /crm page that Financial Performance / Sales & Guarantee Pipeline /
// Spend & Notifications moved into) — kept in one place so both pages render
// risk/status/priority colors and the chat-driven glow highlight identically.

// Dark navy theme — the one color combination in use across the whole app
// (Dashboard, CRM, Goals, top nav, Ask Friday). PAGE_BG/PANEL_BG/CARD_BG give
// the layered dark surfaces (page darkest, panel/nav a touch lighter, cards
// lighter still), CARD_BORDER is the subtle light-on-dark hairline every
// card uses, and C.* are the text/status colors tuned for contrast against
// those dark surfaces — swap any of these to re-theme everywhere at once.
export const PAGE_BG = "#0B1220";
export const PANEL_BG = "#0F172A";
export const CARD_BG = "#141E33";
export const CARD_BORDER = "rgba(255,255,255,0.08)";

export const C = {
  ink: "#F1F5F9",
  muted: "#94A3B8",
  faint: "#64748B",
  border: CARD_BORDER,
  teal: "#22D3EE",
  up: "#34D399",
  down: "#F87171",
};

const STATUS: Record<string, { color: string; label: string }> = {
  guarantee_met: { color: "#34D399", label: "Guarantee met" },
  on_track: { color: "#38BDF8", label: "On track" },
  ramping: { color: "#FBBF24", label: "Ramping" },
};
export const statusOf = (k: string) => STATUS[k] ?? { color: C.muted, label: k };

const RISK: Record<string, { color: string; label: string }> = {
  none: { color: "#34D399", label: "No risk" },
  low: { color: "#94A3B8", label: "Low risk" },
  medium: { color: "#FBBF24", label: "Medium risk" },
  high: { color: "#F87171", label: "High risk" },
};
export const riskOf = (k: string) => RISK[k] ?? { color: C.muted, label: k };

const PRIORITY: Record<string, { color: string; label: string }> = {
  critical: { color: "#F87171", label: "Critical" },
  high: { color: "#FBBF24", label: "High" },
  medium: { color: "#94A3B8", label: "Medium" },
  low: { color: "#94A3B8", label: "Low" },
};
export const priorityOf = (k: string) => PRIORITY[k] ?? { color: C.faint, label: k };

export interface Glow {
  section: string;
  itemIds?: string[];
  ts: number;
}

export function glowColorFor(section: string, statusKey?: string): string {
  if (!statusKey) return C.teal;
  switch (section) {
    case "financial":
      return riskOf(statusKey).color;
    case "pipeline":
      return statusOf(statusKey).color;
    case "tasks":
      return statusKey === "overdue" ? C.down : priorityOf(statusKey).color;
    case "calendar":
      return priorityOf(statusKey).color;
    default:
      return C.teal;
  }
}

export function glowProps(active: boolean, color: string): { className: string; style: React.CSSProperties } {
  if (!active) return { className: "", style: {} };
  return {
    className: " glow-pulse glow-active",
    style: { ["--glow" as unknown as string]: `${color}80` } as React.CSSProperties,
  };
}

export const fmtUsd = (n: number) => `$${n.toLocaleString("en-US")}`;

export const fmtDay = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

export const fmtFullDay = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
