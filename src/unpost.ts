// src/unpost.ts — the reverse of `clarity uploaded`. A CSV bulk upload moves
// packs into exports/posted/ optimistically, before Pinterest confirms a thing;
// when Pinterest accepts only part of the file the rest sit there claiming to be
// scheduled forever, and the calendar in `clarity status` counts them. This
// decides which of those packs never arrived, so they can go back to packs/.
//
// Pure: the stage does the moving. The one safety rule lives here — a pack whose
// pin id we recorded is demonstrably live, so a short page from Pinterest's
// endpoint can never cost us a real pin.
import { reconcile, type PinterestPin } from "./reconcile.js";
import type { PackInfo } from "./packs.js";

/**
 * Posted packs that Pinterest's own lists do not contain and that can still be
 * scheduled. `reconcile` already ignores past-dated packs (they cannot be
 * rescheduled) and matches on title+date; this adds the recorded-pin-id guard.
 */
export function planUnpost(pins: PinterestPin[], posted: PackInfo[], today: string): PackInfo[] {
  return reconcile(pins, [], posted, today).missing.filter((pack) => !pack.text.posted?.pinId);
}

/**
 * Both of Pinterest's lists coming back empty means the pull failed (wrong tab,
 * logged out, rate-limited), not that the scheduler is empty — and acting on it
 * would move every posted pack back at once. `reconcile`'s own truncation
 * heuristic cannot help here: it compares against the posted-pack count, which
 * is exactly the number this command exists to correct, so it fires every time.
 */
export function pullLooksFailed(scheduledCount: number, createdCount: number): boolean {
  return scheduledCount + createdCount === 0;
}

export interface UnpostInput {
  /** template → pack date, for the variants of this row still on Pinterest. */
  stillPostedDates: Record<string, string>;
  allTemplates: string[];
  currentStatus?: string;
}

export interface UnpostPatch {
  status?: "Approved";
  /** A date for a variant still posted, null to clear the column of one that isn't. */
  variants?: Record<string, string | null>;
}

/**
 * The Notion half of unposting, mirroring `postedTransition`'s invariant from
 * the other side: a row is Scheduled only while every variant is on Pinterest,
 * so taking any variant away sends it back to Approved and clears that
 * template's date column.
 *
 * Only ever un-flips Scheduled. A Published row's pins are live — whatever the
 * scheduled list says — and a row parked in Rejected/Archived by hand keeps the
 * status its owner chose, exactly as `applyStatusGuard` does going forward.
 */
export function unpostTransition(i: UnpostInput): UnpostPatch {
  const variants = Object.fromEntries(
    i.allTemplates.map((t) => [t, i.stillPostedDates[t] ?? null] as const),
  );
  const complete = i.allTemplates.every((t) => i.stillPostedDates[t]);
  const unflip = i.currentStatus === "Scheduled" && !complete;
  return { ...(unflip ? { status: "Approved" as const } : {}), variants };
}

/** Strip the POSTED:/EXPORTED: bookkeeping lines so the pack reads as pending again. */
export function clearPostedMarks(txt: string): string {
  const kept = txt.split(/\r?\n/).filter((line) => !/^(POSTED|EXPORTED): /.test(line));
  return `${kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "")}\n`;
}
