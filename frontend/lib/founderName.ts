"use client";

// Resolves the name used in greetings ("Good morning, X") across the app.
// No accounts/auth exist in this MVP (see app/profile/page.tsx's own note on
// that), so there's no per-user identity to key off — this is a per-browser
// preference, same pattern as AskFriday.tsx's VOICE_OUT_KEY localStorage flag.
//
// Resolution order:
//   1. A name the person explicitly set (saved in localStorage, via the
//      Profile page) — always wins once set.
//   2. Falls back to the real CEO name already readable from Context/team.md
//      (via /api/context), same source app/profile/page.tsx uses, so a fresh
//      browser still greets correctly rather than showing a placeholder.
//   3. "Founder" if neither is available yet (e.g. context still loading).

import { useEffect, useState } from "react";

const STORAGE_KEY = "friday_founder_name";
const DEFAULT_NAME = "Founder";
// AppShell (TopNav + AskFriday) is mounted once in the root layout and never
// unmounts across client-side navigation — including the /login -> / jump
// after signing in — so a plain useEffect([]) in useFounderName() would
// only ever read localStorage once, before setFounderName() has run. This
// custom event lets every mounted useFounderName() instance re-read the
// moment setFounderName() is called, instead of needing a remount.
const NAME_CHANGED_EVENT = "friday-founder-name-changed";

interface ContextFile {
  slug: string;
  title: string;
  content: string;
}

// Same regex app/profile/page.tsx's parseCeoFromTeamDoc uses, kept here too
// (just the name capture) so this hook has no dependency on that page.
export function parseCeoNameFromTeamDoc(content: string): string | null {
  const match = content.match(/\*\*([^,*]+),\s*([^(*]+?)\s*\([^)]+\)\*\*/);
  if (!match || !/CEO/i.test(match[2])) return null;
  return match[1].trim();
}

function readStoredName(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private browsing / blocked storage — degrade to the fallback
  }
}

export function setFounderName(name: string): void {
  try {
    const trimmed = name.trim();
    if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable — nothing to do, caller's in-memory state still updates
  }
  window.dispatchEvent(new Event(NAME_CHANGED_EVENT));
}

export function useFounderName(): string {
  const [name, setName] = useState<string>(DEFAULT_NAME);

  useEffect(() => {
    function resolve() {
      const stored = readStoredName();
      if (stored) {
        setName(stored);
        return;
      }
      fetch("/api/context")
        .then((r) => r.json())
        .then((data) => {
          const files: ContextFile[] = data.files ?? [];
          const teamDoc = files.find((f) => f.slug === "team");
          const parsed = teamDoc ? parseCeoNameFromTeamDoc(teamDoc.content) : null;
          if (parsed) setName(parsed);
        })
        .catch(() => {
          // keep DEFAULT_NAME — context endpoint being down shouldn't break the greeting
        });
    }

    resolve();
    // Re-resolve whenever setFounderName() runs anywhere (e.g. the login
    // page, or the Profile page's pencil edit) — AppShell/AskFriday mount
    // once in the root layout and never remount across navigation, so a
    // one-shot effect alone would miss a name set after this component's
    // first mount. Also listens for "storage" so a name change in another
    // tab is picked up here too.
    window.addEventListener(NAME_CHANGED_EVENT, resolve);
    window.addEventListener("storage", resolve);
    return () => {
      window.removeEventListener(NAME_CHANGED_EVENT, resolve);
      window.removeEventListener("storage", resolve);
    };
  }, []);

  return name;
}
