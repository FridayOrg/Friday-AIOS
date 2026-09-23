"use client";

// Renders a ```email-draft``` block the Analyst agent emitted (see
// ANALYST_HEADER's "Drafting and sending an EMAIL" section) as a review card
// with Send/Cancel buttons — one of two ways to confirm (the other is just
// replying "yes, send it" / "confirm" in chat, handled entirely server-side
// via backend/app/main.py's _maybe_send_email against conversation history).
// Neither path ever sends automatically; both require an explicit action.

import { useState } from "react";
import { Mail, Check, X, Loader2 } from "lucide-react";

export interface EmailDraft {
  to_name?: string;
  to_email: string;
  subject: string;
  body: string;
}

/** Finds the first complete ```email-draft ... ``` fenced block in `text`,
 * parses its JSON, and returns the text with that block removed (for
 * display only — the raw block must stay in the underlying message text so
 * it survives into conversation history for the backend's confirm/cancel
 * detection) plus the parsed draft, or null if there's no complete/valid
 * block yet. */
export function extractEmailDraft(text: string): { cleanText: string; draft: EmailDraft | null } {
  const match = text.match(/```email-draft\s*\n([\s\S]*?)\n```/);
  if (!match) return { cleanText: text, draft: null };
  try {
    const parsed = JSON.parse(match[1]);
    if (typeof parsed.to_email === "string" && typeof parsed.subject === "string" && typeof parsed.body === "string") {
      return {
        cleanText: (text.slice(0, match.index) + text.slice(match.index! + match[0].length)).trim(),
        draft: parsed,
      };
    }
  } catch {
    /* malformed JSON from the model — fall through, show the raw text instead */
  }
  return { cleanText: text, draft: null };
}

/** Strips a complete OR still-streaming email-draft block from `text`, for
 * text-to-speech only — voice output must never read raw JSON aloud, even
 * mid-stream before the closing fence has arrived. Display/history use the
 * untouched raw text; only the TTS pipeline should call this. */
export function speakableText(text: string): string {
  const start = text.indexOf("```email-draft");
  if (start === -1) {
    // Guard against a partial fence at the very end ("```email-dra") so a
    // fence-in-progress is never spoken as literal backticks either.
    const partial = text.match(/```[a-z-]*$/);
    return partial ? text.slice(0, partial.index) : text;
  }
  const rest = text.slice(start);
  const complete = rest.match(/^```email-draft\s*\n[\s\S]*?\n```([\s\S]*)$/);
  return text.slice(0, start) + (complete ? complete[1] : "");
}

type Status = "idle" | "sending" | "sent" | "cancelled" | "error";

export default function EmailDraftCard({ draft }: { draft: EmailDraft }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_email: draft.to_email, subject: draft.subject, body: draft.body }),
      });
      const data = await res.json();
      if (!res.ok || data.status === "error") {
        setStatus("error");
        setError(data.detail ?? "Could not send the email.");
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setError("Could not reach the Friday backend.");
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-blue-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Mail size={15} className="text-blue-600 shrink-0" />
        {draft.subject}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        To: {draft.to_name ? `${draft.to_name} <${draft.to_email}>` : draft.to_email}
      </p>
      <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{draft.body}</p>

      {status === "idle" && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={send}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            <Check size={13} />
            Send
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
      {status === "sending" && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" />
          Sending…
        </div>
      )}
      {status === "sent" && (
        <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <Check size={13} />
          Sent
        </div>
      )}
      {status === "cancelled" && <p className="mt-3 text-xs text-slate-400">Not sent. Ask Friday to change anything before sending.</p>}
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
