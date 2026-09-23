"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { matchTarget, type HighlightEntity, type HighlightTarget } from "./matchTarget";

// Bridges the AskFriday chat panel (client component) to the dashboard (a sibling
// client component under AppShell) so a question like "what meetings do I have" can
// expand + glow the matching dashboard card. `ts` is bumped on every match — even a
// repeat of the same target — so the dashboard can restart the glow animation instead
// of a no-op state update.
interface FiredTarget extends HighlightTarget {
  ts: number;
}

interface HighlightContextValue {
  target: FiredTarget | null;
  highlightFromText: (text: string) => void;
  highlightMeeting: (date: string, time: string, name: string) => void;
}

const HighlightContext = createContext<HighlightContextValue | null>(null);

export function HighlightProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<FiredTarget | null>(null);
  const entitiesRef = useRef<HighlightEntity[]>([]);
  const todayRef = useRef<string | undefined>(undefined); // disambiguates recurring meetings — see matchTarget.ts

  useEffect(() => {
    let cancelled = false;
    fetch("/api/highlight-index")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          entitiesRef.current = d.entities ?? [];
          todayRef.current = d.today;
        }
      })
      .catch(() => {
        /* highlighting is a nice-to-have UI touch — a fetch failure just means chat
         * questions won't drive dashboard highlights this session; nothing to surface */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const highlightFromText = useCallback((text: string) => {
    const match = matchTarget(text, entitiesRef.current, todayRef.current);
    if (match) setTarget({ ...match, ts: Date.now() });
  }, []);

  // Used right after Ask Friday actually creates a meeting (see AskFriday.tsx's
  // "scheduled" SSE payload) — sets the glow directly from the exact values the
  // backend just created the event with, rather than fuzzy-matching prose
  // against the highlight index (which was fetched once at mount and won't
  // know about a meeting created seconds ago). The itemId format must match
  // Calendar3DayContent's own `${day.iso}|${m.time}|${m.name}` exactly.
  const highlightMeeting = useCallback((date: string, time: string, name: string) => {
    setTarget({ section: "calendar", itemIds: [`${date}|${time}|${name}`], ts: Date.now() });
  }, []);

  return (
    <HighlightContext.Provider value={{ target, highlightFromText, highlightMeeting }}>
      {children}
    </HighlightContext.Provider>
  );
}

export function useHighlight() {
  const ctx = useContext(HighlightContext);
  if (!ctx) throw new Error("useHighlight must be used within HighlightProvider");
  return ctx;
}
