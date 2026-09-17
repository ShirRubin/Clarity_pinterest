// src/topup.ts — which rows `clarity topup` brings up to the full template set.
// Pure; stages/design.ts does the rendering.
//
// Every template a row lacks is a fresh pin Pinterest has never seen, so a row
// that is already scheduled or live is just as worth topping up as one still
// in review — its missing variants are new pins, not duplicates. Backfill rows
// (the 2025 catalogue) qualify once they have a transcribed list and a blog
// post to link to; that is the "re-mine the dormant catalogue" item in
// ../CLARITY_PLAN.md §1.5.

const PIPELINE_STATUSES = new Set(["Designed", "In Review", "Approved", "Scheduled", "Published"]);

export function topUpCandidate(row: { source?: string; status?: string; listItems?: string; destinationLink?: string }): boolean {
  if (!row.listItems) return false;
  if (row.source === "backfill") {
    return row.status === "Published" && /\/posts\//.test(row.destinationLink ?? "");
  }
  return row.status !== undefined && PIPELINE_STATUSES.has(row.status);
}
