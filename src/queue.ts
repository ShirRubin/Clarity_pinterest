// Queue health — how far ahead the posting calendar runs, and how many new lists
// the next generation run should make to keep it there.
//
// The calendar of record is exports/packs/ + exports/posted/ (see stages/pack.ts):
// one dated directory per pin. A pack moves to posted/ by hand once it has been
// handed to Pinterest's native scheduler, but a future-dated one is still holding
// that day's slot, so both directories are read. Runway = days from today to the
// last dated pack. Overdue *pending* packs are counted and reported but never
// treated as cover — a pile of missed posts must not make the queue look healthy;
// submitted packs are already dealt with and are never past due.
//
// Since Oct 5 2026 (growth review, plan §1) runway is ALSO measured in NEW
// lists: 540 variant packs of lists Pinterest already knew read as 91 days of
// cover and switched the generator off for a month. `FRESH_LISTS_PER_WEEK` is
// a floor on lists whose first pin goes live in the next 7 days; the backlog
// of fourth skins never satisfies it (src/freshness.ts).
//
// The arithmetic half is pure so tests/queue.test.ts can pin it down; the async
// half reads the packs directory and Notion.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { listAllPins, type PinSummary } from "./notion.js";
import { PINS_PER_DAY } from "./schedule.js";
import type { Status } from "./schema.js";
import { slugify } from "./destination.js";
import { splitPackName } from "./packs.js";
import { freshLists, type CalendarPack } from "./freshness.js";
import { rowForPack } from "./rowForPack.js";

/** Keep this many days of scheduled packs ahead of today. */
export const TARGET_RUNWAY_DAYS = 14;

/** Ceiling on one run: draft alone costs ~85s per list, so a night's batch stays small. */
export const MAX_LISTS_PER_RUN = 6;

/** New lists (never posted, not backfill) whose first pin must go live each week, whatever the pack count says. */
export const FRESH_LISTS_PER_WEEK = 5;

/** The window `FRESH_LISTS_PER_WEEK` is counted over. */
export const FRESH_HORIZON_DAYS = 7;

/** Each approved list becomes one pin per template. Guarded against drift in tests. */
export const VARIANTS_PER_LIST = 4;

/** Rows generated but not yet packed — they will become packs without new generation. */
export const IN_FLIGHT_STATUSES: Status[] = ["Idea", "Drafted", "Designed", "In Review", "Approved"];

const DAY_MS = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

export interface Runway {
  /** Packs dated today or later — actual forward cover. */
  packsRemaining: number;
  /** Packs whose post date has already passed and that are still sitting there. */
  pastDue: number;
  lastScheduledDate?: string;
  /** Whole days from today to the last dated pack; never negative. */
  daysOfRunway: number;
}

const datesOf = (names: string[]): string[] => {
  const out: string[] = [];
  for (const name of names) {
    const m = /^(\d{4}-\d{2}-\d{2})--/.exec(name);
    if (m) out.push(m[1]);
  }
  return out;
};

/**
 * Read the calendar out of pack directory names (`YYYY-MM-DD--slug--template`).
 * `pending` is exports/packs/ (still to hand to Pinterest); `submitted` is
 * exports/posted/ (already in Pinterest's scheduler). Both hold their slot, but
 * only a pending pack whose date has passed is past due.
 */
export function runwayFromPackNames(
  pending: string[],
  today: string,
  submitted: string[] = [],
): Runway {
  const pendingDates = datesOf(pending);
  const dates = [...pendingDates, ...datesOf(submitted)];
  if (!dates.length) return { packsRemaining: 0, pastDue: 0, daysOfRunway: 0 };

  const pastDue = pendingDates.filter((d) => d < today).length;
  const upcoming = dates.filter((d) => d >= today);
  if (!upcoming.length) return { packsRemaining: 0, pastDue, daysOfRunway: 0 };
  const last = upcoming.reduce((a, b) => (a > b ? a : b));
  return {
    packsRemaining: upcoming.length,
    pastDue,
    lastScheduledDate: last,
    daysOfRunway: Math.max(0, Math.round((toMs(last) - toMs(today)) / DAY_MS)),
  };
}

/**
 * How many lists to generate: enough to reach TARGET_RUNWAY_DAYS of packs AND
 * enough new lists to hold FRESH_LISTS_PER_WEEK, whichever asks for more,
 * capped per run. Lists in flight (idea → approved, not yet packed) count
 * against both, since they become the next fresh openers.
 */
export function listsNeeded(runway: Runway, inFlightLists: number, freshThisWeek = FRESH_LISTS_PER_WEEK): number {
  const shortfallDays = TARGET_RUNWAY_DAYS - runway.daysOfRunway;
  const forRunway = shortfallDays > 0 ? Math.ceil((shortfallDays * PINS_PER_DAY) / VARIANTS_PER_LIST) - inFlightLists : 0;
  const forFreshness = FRESH_LISTS_PER_WEEK - freshThisWeek - inFlightLists;
  return Math.max(0, Math.min(MAX_LISTS_PER_RUN, Math.max(forRunway, forFreshness)));
}

/**
 * Rows still to become packs, by status. An Approved row whose packs are already
 * on disk is counted by the runway, not here — otherwise it would count twice.
 */
export function inFlightFrom(
  rows: Pick<PinSummary, "name" | "status" | "source">[],
  packNames: string[],
): Partial<Record<Status, number>> {
  const packed = new Set(packNames.map((n) => splitPackName(n)?.slug).filter(Boolean));
  const inFlight: Partial<Record<Status, number>> = {};
  for (const row of rows) {
    if (row.source === "backfill") continue;
    const status = row.status as Status | undefined;
    if (!status || !IN_FLIGHT_STATUSES.includes(status)) continue;
    if (status === "Approved" && packed.has(slugify(row.name))) continue;
    inFlight[status] = (inFlight[status] ?? 0) + 1;
  }
  return inFlight;
}

export interface QueueHealth extends Runway {
  /** Row counts per pipeline status, for the statuses that represent work in flight. */
  inFlight: Partial<Record<Status, number>>;
  inFlightLists: number;
  /** New lists whose first pin goes live in the next FRESH_HORIZON_DAYS days. */
  freshThisWeek: string[];
  needed: number;
}

/** Pack names → the shape src/freshness.ts reads (exported flag unknown here; it only matters for re-dating). */
function calendarPacks(names: string[]): CalendarPack[] {
  const out: CalendarPack[] = [];
  for (const dir of names) {
    const parts = splitPackName(dir);
    if (parts) out.push({ dir, ...parts });
  }
  return out;
}

/** Pack directory names under exports/<dir>, or none when it does not exist yet. */
export async function packNames(dir: string): Promise<string[]> {
  try {
    return await readdir(path.join("exports", dir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }
}

/**
 * `rows` lets a caller that has already queried Notion (clarity status) share the
 * round trip instead of paying for a second one.
 */
export async function queueHealth(
  today = new Date().toISOString().slice(0, 10),
  rows?: PinSummary[],
): Promise<QueueHealth> {
  const [pending, submitted] = await Promise.all([packNames("packs"), packNames("posted")]);
  const runway = runwayFromPackNames(pending, today, submitted);

  const allRows = rows ?? (await listAllPins());
  const inFlight = inFlightFrom(allRows, [...pending, ...submitted]);
  const inFlightLists = Object.values(inFlight).reduce((a, b) => a + b, 0);

  // A pack without a PAGE: line falls back to a slug match against non-backfill
  // rows, so a backfill list (a 2025 pin Pinterest already knows) is never "new".
  const isNew = (slug: string) => !!rowForPack({ text: {}, slug }, allRows);
  const freshThisWeek = freshLists(calendarPacks(pending), calendarPacks(submitted), today, FRESH_HORIZON_DAYS, isNew);

  return { ...runway, inFlight, inFlightLists, freshThisWeek, needed: listsNeeded(runway, inFlightLists, freshThisWeek.length) };
}

export function formatQueueHealth(h: QueueHealth): string {
  const lines = [
    `Runway    ${h.daysOfRunway} day(s) — ${h.packsRemaining} pack(s) still to post` +
      (h.lastScheduledDate ? `, last dated ${h.lastScheduledDate}` : ""),
  ];
  if (h.pastDue) lines.push(`Overdue   ${h.pastDue} pack(s) past their post date — post these first`);
  lines.push(
    h.inFlightLists
      ? `In flight ${h.inFlightLists} list(s): ` +
          IN_FLIGHT_STATUSES.filter((s) => h.inFlight[s]).map((s) => `${h.inFlight[s]} ${s}`).join(", ")
      : `In flight nothing — no lists between idea and approval`,
  );
  lines.push(
    `Fresh     ${h.freshThisWeek.length} new list(s) go live in the next ${FRESH_HORIZON_DAYS} days (floor ${FRESH_LISTS_PER_WEEK})` +
      (h.freshThisWeek.length ? `: ${h.freshThisWeek.slice(0, 5).join(", ")}${h.freshThisWeek.length > 5 ? ", …" : ""}` : ""),
  );
  lines.push(
    h.needed
      ? `Generate  ${h.needed} new list(s) — ` +
          (h.daysOfRunway < TARGET_RUNWAY_DAYS ? `to reach a ${TARGET_RUNWAY_DAYS}-day runway` : `to keep ${FRESH_LISTS_PER_WEEK} new lists a week going live`)
      : `Generate  nothing — the queue is healthy`,
  );
  if (h.inFlight["In Review"]) {
    lines.push(``, `${h.inFlight["In Review"]} list(s) waiting on you: npm run clarity -- approve`);
  }
  return lines.join("\n");
}

export async function runQueue(): Promise<void> {
  console.log(formatQueueHealth(await queueHealth()));
}
