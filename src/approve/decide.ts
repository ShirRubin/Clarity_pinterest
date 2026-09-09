// src/approve/decide.ts — the one definition of what a review verdict does to a
// Notion row. Shared by the local review page (stages/approve.ts) and the
// hosted one (review-worker), so the two can never drift.
import type { Status } from "../schema.js";

export type Decision = "approve" | "reject" | "revise";
export const DECISIONS: readonly Decision[] = ["approve", "reject", "revise"];
export const isDecision = (x: unknown): x is Decision => DECISIONS.includes(x as Decision);

export const STATUS_FOR: Record<Decision, Status> = {
  approve: "Approved",
  reject: "Rejected",
  revise: "Needs changes",
};

// `revise` is the marker `clarity revise` looks for; the others are history only.
export const MARKER_FOR: Record<Decision, "review" | "revise"> = {
  approve: "review",
  reject: "review",
  revise: "revise",
};

/** Notes are appended, never overwritten — the row keeps its history. */
export const appendNote = (existing: string | undefined, entry: string): string =>
  existing?.trim() ? `${existing.trim()} | ${entry}` : entry;

export interface DecisionPatch {
  status: Status;
  notes?: string;
}

/** What to write to Notion for one verdict. `today` is YYYY-MM-DD. A revise
 * without a note is a caller bug — throws. */
export function decisionPatch(
  decision: Decision,
  note: string | undefined,
  existingNotes: string | undefined,
  today: string,
): DecisionPatch {
  const clean = note?.trim();
  if (decision === "revise" && !clean) {
    throw new Error("needs-changes requires a note saying what to change");
  }
  const patch: DecisionPatch = { status: STATUS_FOR[decision] };
  if (clean) patch.notes = appendNote(existingNotes, `${MARKER_FOR[decision]} ${today}: ${clean}`);
  return patch;
}
