// src/posted.ts — what changes on a Notion row after one more of its variants
// lands in Pinterest's scheduler. Pure; the stage does the I/O.
export const pinUrl = (pinId: string) => `https://www.pinterest.com/pin/${pinId}/`;

export interface PostedInput {
  postedTemplates: string[];
  totalTemplates: number;
  firstPinId: string;
  earliestPackDate: string;
  existingScheduledDate?: string;
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
  return {
    status: "Scheduled",
    pinUrl: pinUrl(i.firstPinId),
    pinterestPinId: i.firstPinId,
    scheduledDate: i.existingScheduledDate ?? i.earliestPackDate,
  };
}
