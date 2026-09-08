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
