// src/posted.ts — what changes on a Notion row after one more of its variants
// lands in Pinterest's scheduler. Pure; the stage does the I/O.
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
  const havePinned = i.existingPinUrl !== undefined && i.existingPinId !== undefined;
  return {
    status: "Scheduled",
    pinUrl: havePinned ? i.existingPinUrl : pinUrl(i.firstPinId),
    pinterestPinId: havePinned ? i.existingPinId : i.firstPinId,
    scheduledDate: i.existingScheduledDate ?? i.earliestPackDate,
  };
}
