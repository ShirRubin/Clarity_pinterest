// src/posted.ts — what changes on a Notion row after one more of its variants
// lands in Pinterest's scheduler. Pure; the stage does the I/O.
import type { PackInfo } from "./packs.js";

export const pinUrl = (pinId: string) => `https://www.pinterest.com/pin/${pinId}/`;

export interface PostedInput {
  postedTemplates: string[];
  totalTemplates: number;
  firstPinId: string;
  earliestPackDate: string;
  existingScheduledDate?: string;
  existingPinUrl?: string;
  existingPinId?: string;
}

export interface PostedPatch {
  status?: "Scheduled";
  pinUrl?: string;
  pinterestPinId?: string;
  scheduledDate?: string;
}

/** A row is Scheduled only once every variant is on Pinterest — a half-posted
 *  list stays Approved so the status card can show "3/4 posted". */
export function postedTransition(i: PostedInput): PostedPatch {
  if (new Set(i.postedTemplates).size < i.totalTemplates) return {};
  // A pin id/URL already recorded on the row wins over the derived one — the
  // same keep-what's-there precedence as scheduledDate, so a re-run (or a
  // row whose earliest-posted marker was recovered later) never clobbers it.
  // Either field alone is enough to pin the row: a URL pasted by hand with no
  // "Pinterest pin ID" column filled in must not be overwritten just because
  // its sibling field is empty — the id is then parsed out of the URL, and a
  // bare existing id derives its URL the normal way.
  let finalPinUrl: string;
  let finalPinId: string;
  if (i.existingPinUrl !== undefined) {
    finalPinUrl = i.existingPinUrl;
    finalPinId = i.existingPinId ?? i.existingPinUrl.match(/\/pin\/(\d+)\//)?.[1] ?? i.firstPinId;
  } else if (i.existingPinId !== undefined) {
    finalPinId = i.existingPinId;
    finalPinUrl = pinUrl(i.existingPinId);
  } else {
    finalPinId = i.firstPinId;
    finalPinUrl = pinUrl(i.firstPinId);
  }
  return {
    status: "Scheduled",
    pinUrl: finalPinUrl,
    pinterestPinId: finalPinId,
    scheduledDate: i.existingScheduledDate ?? i.earliestPackDate,
  };
}

export interface PostedDerivation {
  /** The earliest-dated pack with a POSTED: marker's pin id — undefined only
   *  when no pack for this row has one yet (should not happen once this pack
   *  itself has just been marked, but the repair path can't assume that). */
  firstPinId?: string;
  earliestPackDate: string;
}

/**
 * The two things `postedTransition` needs beyond the posted-template count:
 * which pin id to record, and the earliest date across every pack for this
 * row — posted or still pending. Packs posted before this stage existed (or
 * mid-repair, see stages/posted.ts) may have no POSTED: marker; those are
 * never candidates for "first".
 */
export function postedDerivation(postedPacks: PackInfo[], pendingPacks: PackInfo[]): PostedDerivation {
  const earliestPackDate = [...postedPacks, ...pendingPacks].map((p) => p.date).sort()[0];
  const known = postedPacks
    .filter((p) => p.text.posted?.pinId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.dir.localeCompare(b.dir));
  return { firstPinId: known[0]?.text.posted?.pinId, earliestPackDate };
}

/**
 * A row is only ever flipped to Scheduled here — never anything else — so the
 * guard is narrow: withhold just the status change when the row's current
 * status isn't Approved or Scheduled (someone moved it to Rejected/Archived/etc
 * by hand), leaving the rest of the patch (pin id, URL, date) to be recorded
 * as-is. The caller still appends its posting note either way.
 */
export function applyStatusGuard(patch: PostedPatch, currentStatus?: string): PostedPatch {
  if (!patch.status) return patch;
  if (currentStatus === "Approved" || currentStatus === "Scheduled") return patch;
  const { status, ...rest } = patch;
  return rest;
}
