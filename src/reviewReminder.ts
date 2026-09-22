// src/reviewReminder.ts — the daily nudge for lists sitting in "In Review".
//
// The nightly job keeps exactly ONE open Todoist task while the review queue is
// non-empty: created the first night, re-dated (and re-reminded) every night
// after, closed the night the queue empties. Pure — the stage does the I/O, so
// every rule below is unit-tested without touching Notion or Todoist.
import { POST_TZ } from "./schedule.js";

export const REVIEW_URL = "https://review.clarity-lists.com";

/** When the reminder should fire on a normal 02:00 run, in the posting zone. */
export const REMINDER_LOCAL_TIME = "09:00";

/** A deferred run (the laptop slept through 02:00) still gets a reminder, this far out. */
const DEFERRED_GRACE_MIN = 10;

/** Titles listed in full before the rest are summarised as a count. */
const MAX_LISTED = 8;

export interface ReminderState {
  /** The Todoist task this job is keeping open, if any. */
  taskId?: string;
}

export type ReminderPlan =
  | { kind: "none" }
  | { kind: "close"; taskId: string }
  | { kind: "create"; content: string; description: string; dueLocal: string }
  | { kind: "update"; taskId: string; content: string; description: string; dueLocal: string };

const pad = (n: number) => String(n).padStart(2, "0");
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fromMinutes = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

/**
 * The local datetime the reminder should fire at.
 *
 * Normally 09:00 on the run's own day. But the job is only as punctual as the
 * laptop — a run deferred by StartWhenAvailable can land at 10:00, and a
 * reminder in the past never fires, so anything at or after 09:00 is pushed a
 * few minutes out instead. Clamped to 23:59 so it can never roll into tomorrow.
 */
export function reminderTime(today: string, nowLocal: string): string {
  const target = toMinutes(REMINDER_LOCAL_TIME);
  const now = toMinutes(nowLocal);
  const at = now < target ? target : Math.min(now + DEFERRED_GRACE_MIN, toMinutes("23:59"));
  return `${today}T${fromMinutes(at)}:00`;
}

export function reminderTitle(count: number): string {
  return `Review ${count} Clarity list${count === 1 ? "" : "s"}`;
}

export function reminderBody(names: string[]): string {
  const shown = names.slice(0, MAX_LISTED).map((n) => `• ${n}`);
  const rest = names.length - shown.length;
  return [
    `${names.length} list${names.length === 1 ? " is" : "s are"} waiting for your verdict.`,
    ``,
    REVIEW_URL,
    ``,
    ...shown,
    ...(rest > 0 ? [`…and ${rest} more`] : []),
  ].join("\n");
}

/** What tonight's run should do about the reminder task. */
export function planReminder(
  state: ReminderState,
  names: string[],
  today: string,
  nowLocal: string,
): ReminderPlan {
  if (!names.length) return state.taskId ? { kind: "close", taskId: state.taskId } : { kind: "none" };

  const fields = {
    content: reminderTitle(names.length),
    description: reminderBody(names),
    dueLocal: reminderTime(today, nowLocal),
  };
  return state.taskId ? { kind: "update", taskId: state.taskId, ...fields } : { kind: "create", ...fields };
}

// --- local time ---------------------------------------------------------------------
// Todoist is told an absolute instant rather than a floating local time, so the
// reminder cannot drift when Israel changes clocks in October.

/** The wall clock in the posting zone, as HH:MM. */
export function localHHMM(now: Date = new Date(), tz: string = POST_TZ): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  // Some ICU builds report midnight as hour 24 under hour12:false.
  const hour = Number(get("hour")) % 24;
  return `${pad(hour)}:${get("minute")}`;
}

/** How far `tz` is ahead of UTC at a given instant, in minutes. */
function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return (asIfUtc - at.getTime()) / 60_000;
}

/** "2026-09-23T09:00:00" in `tz` → the same moment as a UTC ISO string. */
export function localToUtcISO(local: string, tz: string = POST_TZ): string {
  const naive = Date.parse(`${local}Z`);
  // First guess uses the offset at the naive instant; a second pass settles the
  // rare case where that guess lands on the other side of a DST change.
  let ms = naive - tzOffsetMinutes(new Date(naive), tz) * 60_000;
  ms = naive - tzOffsetMinutes(new Date(ms), tz) * 60_000;
  return new Date(ms).toISOString();
}
