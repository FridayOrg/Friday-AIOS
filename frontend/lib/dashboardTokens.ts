import type React from "react";

// Shared between CeoDashboard.tsx (main dashboard) and CrmDashboard.tsx (the
// separate /crm page that Financial Performance / Sales & Guarantee Pipeline /
// Spend & Notifications moved into) — kept in one place so both pages render
// risk/status/priority colors and the chat-driven glow highlight identically.

// Light SaaS-analytics theme — the CRM page (components/CrmDashboard.tsx) is
// the single source of truth this was copied from. PAGE_BG/PANEL_BG/CARD_BG
// give the layered light surfaces (page off-white, panel/nav stays dark navy
// by its own explicit styling, cards white), CARD_BORDER is the subtle
// hairline every card uses, and C.* are the text/status colors tuned for
// contrast against those light surfaces — swap any of these to re-theme
// everywhere at once. Note: the top nav and Ask Friday panel deliberately do
// NOT import this file — they keep their own hardcoded dark navy styling.
export const PAGE_BG = "#F5F6F8";
export const PANEL_BG = "#0F172A";
export const CARD_BG = "#FFFFFF";
export const CARD_BORDER = "#E5E7EB";

export const C = {
  ink: "#1F2937",
  muted: "#4B5563",
  faint: "#9CA3AF",
  border: CARD_BORDER,
  teal: "#0EA5E9",
  up: "#2BAF6A",
  down: "#EF6B6B",
};

const STATUS: Record<string, { color: string; label: string }> = {
  guarantee_met: { color: "#2BAF6A", label: "Guarantee met" },
  on_track: { color: "#3B82F6", label: "On track" },
  ramping: { color: "#F59E0B", label: "Ramping" },
};
export const statusOf = (k: string) => STATUS[k] ?? { color: C.muted, label: k };

const RISK: Record<string, { color: string; label: string }> = {
  none: { color: "#2BAF6A", label: "No risk" },
  low: { color: "#9CA3AF", label: "Low risk" },
  medium: { color: "#F59E0B", label: "Medium risk" },
  high: { color: "#EF6B6B", label: "High risk" },
};
export const riskOf = (k: string) => RISK[k] ?? { color: C.muted, label: k };

const PRIORITY: Record<string, { color: string; label: string }> = {
  critical: { color: "#EF6B6B", label: "Critical" },
  high: { color: "#F59E0B", label: "High" },
  medium: { color: "#9CA3AF", label: "Medium" },
  low: { color: "#9CA3AF", label: "Low" },
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
