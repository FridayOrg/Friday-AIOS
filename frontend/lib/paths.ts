import fs from "fs";
import path from "path";

// The frontend lives in <repo root>/frontend, context/mock-data live one level up.
// Single place this is defined so it never drifts between API routes.
export const REPO_ROOT = path.join(process.cwd(), "..");
export const CONTEXT_DIR = path.join(REPO_ROOT, "context");
export const MOCK_DATA_DIR = path.join(REPO_ROOT, "mock-data");

// The app runs on the real system clock. Optional FRIDAY_TZ (e.g. "Asia/Kolkata")
// pins the timezone so this and the backend (backend/app/config.py) agree regardless
// of where the server runs; unset = server local time. Nothing should hardcode the
// current date/time.
const TZ = process.env.FRIDAY_TZ || undefined;

/** "YYYY-MM-DD" for the real current instant, in the configured (or server-local)
 *  timezone. Recomputed on each call so a long-running server never serves a stale
 *  clock. */
export function isoDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "HH:MM" (24h) for the real current instant, in the configured (or server-local)
 *  timezone. */
export function isoTime(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

// The mock-data files were authored around this anchor date. Both sides slide every
// date in the mock data forward by (real today - anchor) days so "this week",
// "overdue" and "upcoming" stay correct as real time moves. See mock-data/today.json.
export const ANCHOR: string = JSON.parse(
  fs.readFileSync(path.join(MOCK_DATA_DIR, "today.json"), "utf-8")
).anchor;

/** Days to slide the frozen mock data forward so it lines up with the real today. */
export function shiftDays(): number {
  const [ay, am, ad] = ANCHOR.split("-").map(Number);
  const [ty, tm, td] = isoDate().split("-").map(Number);
  const anchorUtc = Date.UTC(ay, am - 1, ad);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((todayUtc - anchorUtc) / 86_400_000);
}

/** "YYYY-MM-DD" of the real current day, in the configured (or local) timezone. */
export const TODAY: string = isoDate();
