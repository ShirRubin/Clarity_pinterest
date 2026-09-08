// Queue health — how far ahead the posting calendar runs, and how many new lists
// the next generation run should make to keep it there.
//
// The calendar of record is exports/packs/ + exports/posted/ (see stages/publish.ts):
// one dated directory per pin. A pack moves to posted/ by hand once it has been
// handed to Pinterest's native scheduler, but a future-dated one is still holding
// that day's slot, so both directories are read. Runway = days from today to the
// last dated pack. Overdue *pending* packs are counted and reported but never
// treated as cover — a pile of missed posts must not make the queue look healthy;
// submitted packs are already dealt with and are never past due.
//
// The arithmetic half is pure so tests/queue.test.ts can pin it down; the async
// half reads the packs directory and Notion.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { listAllPins, type PinSummary } from "./notion.js";
import { PINS_PER_DAY } from "./schedule.js";
import type { Status } from "./schema.js";

/** Keep this many days of scheduled packs ahead of today. */
export const TARGET_RUNWAY_DAYS = 14;

/** Ceiling on one run: draft alone costs ~85s per list, so a night's batch stays small. */
export const MAX_LISTS_PER_RUN = 6;

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

/** How many fresh lists to generate to reach TARGET_RUNWAY_DAYS, capped per run. */
export function listsNeeded(runway: Runway, inFlightLists: number): number {
  const shortfallDays = TARGET_RUNWAY_DAYS - runway.daysOfRunway;
  if (shortfallDays <= 0) return 0;
  const packsWanted = shortfallDays * PINS_PER_DAY;
  const lists = Math.ceil(packsWanted / VARIANTS_PER_LIST) - inFlightLists;
  return Math.max(0, Math.min(MAX_LISTS_PER_RUN, lists));
}

export interface QueueHealth extends Runway {
  /** Row counts per pipeline status, for the statuses that represent work in flight. */
  inFlight: Partial<Record<Status, number>>;
  inFlightLists: number;
  needed: number;
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

  const inFlight: Partial<Record<Status, number>> = {};
  for (const row of rows ?? (await listAllPins())) {
    // Backfill rows are imported history, not pipeline output — they never become packs.
    if (row.source === "backfill") continue;
    const status = row.status as Status | undefined;
    if (status && IN_FLIGHT_STATUSES.includes(status)) inFlight[status] = (inFlight[status] ?? 0) + 1;
  }
  const inFlightLists = Object.values(inFlight).reduce((a, b) => a + b, 0);

  return { ...runway, inFlight, inFlightLists, needed: listsNeeded(runway, inFlightLists) };
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
    h.needed
      ? `Generate  ${h.needed} new list(s) to reach a ${TARGET_RUNWAY_DAYS}-day runway`
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
