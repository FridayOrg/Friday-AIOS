import type React from "react";

// Shared between CeoDashboard.tsx (main dashboard) and CrmDashboard.tsx (the
// separate /crm page that Financial Performance / Sales & Guarantee Pipeline /
// Spend & Notifications moved into) — kept in one place so both pages render
// risk/status/priority colors and the chat-driven glow highlight identically.

export const C = {
  ink: "#101828",
  muted: "#667085",
  faint: "#98A2B3",
  border: "rgba(16,24,40,0.07)",
  teal: "#0F9E8E",
  up: "#12B76A",
  down: "#F04438",
};

const STATUS: Record<string, { color: string; label: string }> = {
  guarantee_met: { color: "#0E9F6E", label: "Guarantee met" },
  on_track: { color: "#2D9CDB", label: "On track" },
  ramping: { color: "#DD9A2E", label: "Ramping" },
};
export const statusOf = (k: string) => STATUS[k] ?? { color: C.muted, label: k };

const RISK: Record<string, { color: string; label: string }> = {
  none: { color: "#0E9F6E", label: "No risk" },
  low: { color: "#667085", label: "Low risk" },
  medium: { color: "#DD9A2E", label: "Medium risk" },
  high: { color: "#F04438", label: "High risk" },
};
export const riskOf = (k: string) => RISK[k] ?? { color: C.muted, label: k };

const PRIORITY: Record<string, { color: string; label: string }> = {
  critical: { color: "#F04438", label: "Critical" },
  high: { color: "#DD9A2E", label: "High" },
  medium: { color: "#98A2B3", label: "Medium" },
  low: { color: "#98A2B3", label: "Low" },
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
