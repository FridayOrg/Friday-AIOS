// Matches Friday's chat answer against the dashboard's entities (clients, tasks,
// meetings) to decide which card/section to highlight. Deliberately simple keyword/
// substring matching (same spirit as the backend's heuristic_route in
// backend/app/llm_client.py) — no LLM call, so it fires instantly with zero added
// latency or cost. Matches on the ANSWER, not the question: the question only tells
// you what was asked, the answer tells you what's actually true right now (e.g. "no
// meetings today" vs. three specific meetings) — see lib/highlight-context.tsx.

export interface HighlightEntity {
  section: "financial" | "pipeline" | "tasks" | "calendar" | "spend";
  id: string;
  label: string;
  // Raw status/risk/priority value from the source data — CeoDashboard resolves this
  // to an actual color using the same maps it already renders with.
  statusKey: string;
  // Calendar entities only: has this specific occurrence already finished? Computed
  // from real classification (lib/timeline.ts), not a date comparison — see
  // resolveCalendarDuplicates below for why that distinction matters.
  done?: boolean;
}

export interface HighlightTarget {
  section: HighlightEntity["section"];
  // Every entity the answer actually names or matches a status/priority filter for.
  // Absent (or empty) means "expand this card, but nothing specific to point at" —
  // e.g. a generic "what's our MRR" with no named client or filter.
  itemIds?: string[];
}

// Generic section-level fallback when no specific entity or filter is mentioned (e.g.
// "what's our MRR" or "what meetings do I have today").
const SECTION_KEYWORDS: [HighlightTarget["section"], RegExp][] = [
  ["tasks", /\b(task|tasks|to-?do|to-?dos|deadline|deadlines|overdue|approval|decision)\b/i],
  ["calendar", /\b(meeting|meetings|calendar|schedule|agenda|appointment)\b/i],
  ["pipeline", /\b(pipeline|guarantee|slots?|booked)\b/i],
  ["financial", /\b(revenue|mrr|arr|billing|financ\w*)\b/i],
  ["spend", /\b(spend|burn|expense|cost)\b/i],
];

// Status/priority phrases that mean "every item with this value" rather than one named
// item — lets "what's high priority" highlight all matching rows in that card, not
// just the first one the model happens to name.
const FILTER_PATTERNS: Record<HighlightTarget["section"], [RegExp, string][]> = {
  tasks: [
    [/\boverdue\b/i, "overdue"],
    [/\bhigh[- ]priority\b/i, "high"],
    [/\bmedium[- ]priority\b/i, "medium"],
    [/\blow[- ]priority\b/i, "low"],
  ],
  calendar: [
    [/\bcritical\b/i, "critical"],
    [/\bhigh[- ]priority\b/i, "high"],
  ],
  financial: [
    [/\bhigh risk\b|\bat risk\b/i, "high"],
    [/\bmedium risk\b/i, "medium"],
    [/\blow risk\b/i, "low"],
    [/\bno risk\b/i, "none"],
  ],
  pipeline: [
    [/\bguarantee met\b/i, "guarantee_met"],
    [/\bon track\b/i, "on_track"],
    [/\bramping\b|\bramp\b/i, "ramping"],
  ],
  spend: [],
};

/** Recurring meetings (e.g. a daily "Standup Call") share an identical label across
 * every date they occur on. Matching purely by label text would otherwise glow EVERY
 * occurrence in the rendered week just because the model named the meeting once — the
 * answer almost always means one specific occurrence. Reduce each duplicated label
 * down to the single occurrence the answer most likely meant: prefer whichever exact
 * date is literally named in the text (the agents are instructed to always state one
 * for future meetings, so this covers the common case), else the nearest occurrence
 * that hasn't already finished (using real done/upcoming status, not a date compare —
 * a same-day occurrence can be either "still ahead" or "already over," and only the
 * real status tells them apart), else the nearest occurrence overall. Only affects
 * name-matching — a status/priority filter query ("critical meetings this week")
 * still legitimately wants every real occurrence. */
function resolveCalendarDuplicates(text: string, entities: HighlightEntity[], today?: string): HighlightEntity[] {
  const byLabel = new Map<string, HighlightEntity[]>();
  for (const e of entities) {
    if (e.section !== "calendar") continue;
    const list = byLabel.get(e.label) ?? [];
    list.push(e);
    byLabel.set(e.label, list);
  }

  const keep = new Set<string>();
  for (const occurrences of byLabel.values()) {
    if (occurrences.length === 1) {
      keep.add(occurrences[0].id);
      continue;
    }
    const exact = occurrences.find((e) => text.includes(e.id.split("|")[0]));
    if (exact) {
      keep.add(exact.id);
      continue;
    }
    if (!today) {
      keep.add(occurrences[0].id); // can't disambiguate further — at least pick just one
      continue;
    }
    const todayMs = new Date(`${today}T00:00:00`).getTime();
    const withMs = occurrences.map((e) => ({ e, ms: new Date(`${e.id.split("|")[0]}T00:00:00`).getTime() }));
    const notDone = withMs.filter((x) => !x.e.done).sort((a, b) => a.ms - b.ms);
    const chosen = notDone[0] ?? withMs.sort((a, b) => Math.abs(a.ms - todayMs) - Math.abs(b.ms - todayMs))[0];
    keep.add(chosen.e.id);
  }

  return entities.filter((e) => e.section !== "calendar" || keep.has(e.id));
}

export function matchTarget(text: string, entities: HighlightEntity[], today?: string): HighlightTarget | null {
  const lower = text.toLowerCase();

  // Which card(s) the answer is actually about, by topic keyword. This exists to
  // disambiguate an answer like "the Ashcombe escalation" — a TASK about the Ashcombe
  // client, not a pipeline update — from wrongly matching the client-name entity that
  // also happens to exist under pipeline/financial. When a topic is recognizable,
  // entity and filter matching are both scoped to it; a bare name match is only used
  // as a last resort when no topic keyword is present at all.
  const topicSections = SECTION_KEYWORDS.filter(([, re]) => re.test(text)).map(([s]) => s);

  const namePool = resolveCalendarDuplicates(text, entities, today);
  const named = namePool.filter((e) => e.label.length >= 3 && lower.includes(e.label.toLowerCase()));
  const scopedNamed = topicSections.length ? named.filter((e) => topicSections.includes(e.section)) : named;
  if (scopedNamed.length) {
    // A task's full title often contains a shorter client name that separately exists
    // as its own financial/pipeline entity (e.g. a task titled "Northgate Financial
    // Advisory — approve renewal terms..." contains the financial entity's label
    // "Northgate Financial Advisory"). The longest matching label is the more specific
    // signal — picking array order instead (as this used to) meant whichever section
    // happened to be built first in the entity list always won ties, regardless of
    // which match was actually more precise.
    const best = scopedNamed.reduce((a, b) => (b.label.length > a.label.length ? b : a));
    const ids = scopedNamed.filter((e) => e.section === best.section).map((e) => e.id);
    return { section: best.section, itemIds: ids };
  }

  // No entity named (in-topic or otherwise) — a status/priority filter within a
  // recognized topic narrows to specific items ("high priority tasks").
  for (const section of topicSections) {
    for (const [filterRe, value] of FILTER_PATTERNS[section]) {
      if (filterRe.test(text)) {
        const ids = entities.filter((e) => e.section === section && e.statusKey === value).map((e) => e.id);
        if (ids.length) return { section, itemIds: ids };
      }
    }
  }
  if (topicSections.length) return { section: topicSections[0] }; // just expand the card

  return null;
}
