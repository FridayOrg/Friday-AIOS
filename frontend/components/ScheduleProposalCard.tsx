"use client";

// Renders a ```schedule-proposal``` block the Analyst agent emitted (see
// ANALYST_HEADER in backend/app/context_loader.py) as a confirm/cancel card
// instead of raw JSON. Nothing here ever creates a real calendar event on its
// own — only the explicit "Confirm & Schedule" click calls the backend's one
// write endpoint (POST /api/calendar/events -> backend's POST
// /calendar/events), matching CLAUDE.md's "externally visible actions need
// explicit approval" rule.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, X, Loader2, ExternalLink } from "lucide-react";

export interface ScheduleProposal {
  title: string;
  date: string;
  time: string;
  duration_minutes?: number;
  attendees?: string[];
  notes?: string;
}

/** Finds the first complete ```schedule-proposal ... ``` fenced block in `text`,
 * parses its JSON, and returns the text with that block removed plus the
 * parsed proposal (or the original text + null if there's no complete block
 * yet — e.g. still streaming — or it fails to parse). */
export function extractScheduleProposal(text: string): { cleanText: string; proposal: ScheduleProposal | null } {
  const match = text.match(/```schedule-proposal\s*\n([\s\S]*?)\n```/);
  if (!match) return { cleanText: text, proposal: null };
  try {
    const parsed = JSON.parse(match[1]);
    if (typeof parsed.title === "string" && typeof parsed.date === "string" && typeof parsed.time === "string") {
      return { cleanText: (text.slice(0, match.index) + text.slice(match.index! + match[0].length)).trim(), proposal: parsed };
    }
  } catch {
    /* malformed JSON from the model — fall through, show the raw text instead */
  }
  return { cleanText: text, proposal: null };
}

function fmtDate(iso: string) {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function to12h(t: string) {
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return t;
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${m.toString().padStart(2, "0")} ${period}`;
}

type Status = "idle" | "scheduling" | "scheduled" | "cancelled" | "error";

export default function ScheduleProposalCard({ proposal }: { proposal: ScheduleProposal }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [eventLink, setEventLink] = useState<string | null>(null);

  async function confirm() {
    setStatus("scheduling");
    setError(null);
    try {
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposal),
      });
      const data = await res.json();
      if (!res.ok || data.status === "error") {
        setStatus("error");
        setError(data.detail ?? "Could not create the event.");
        return;
      }
      setEventLink(data.html_link ?? null);
      setStatus("scheduled");
      // Re-run the dashboard's server-side data fetch (getDashboardData ->
      // live /calendar) so the Calendar card and Next Meetings tile pick up
      // the just-created event immediately, without a manual page reload.
      router.refresh();
    } catch {
      setStatus("error");
      setError("Could not reach the Friday backend.");
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-blue-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <CalendarPlus size={15} className="text-blue-600 shrink-0" />
        {proposal.title}
      </div>
      <div className="mt-1.5 text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
        <span>{fmtDate(proposal.date)}</span>
        <span>
          {to12h(proposal.time)}
          {proposal.duration_minutes ? ` · ${proposal.duration_minutes} min` : ""}
        </span>
      </div>
      {proposal.attendees && proposal.attendees.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">Attendees: {proposal.attendees.join(", ")}</p>
      )}
      {proposal.notes && <p className="mt-1 text-xs text-slate-500">{proposal.notes}</p>}

      {status === "idle" && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={confirm}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            <Check size={13} />
            Confirm &amp; Schedule
          </button>
          <button
            onClick={() => setStatus("cancelled")}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <X size={13} />
            Cancel
          </button>
        </div>
      )}
      {status === "scheduling" && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" />
          Scheduling…
        </div>
      )}
      {status === "scheduled" && (
        <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <Check size={13} />
          Scheduled on Google Calendar
          {eventLink && (
            <a href={eventLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
              View <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}
      {status === "cancelled" && <p className="mt-3 text-xs text-slate-400">Not scheduled.</p>}
      {status === "error" && (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-xs font-medium text-red-600">{error}</p>
          <button
            onClick={() => setStatus("idle")}
            className="self-start text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
