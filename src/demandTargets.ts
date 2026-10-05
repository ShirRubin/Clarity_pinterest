// src/demandTargets.ts — the block of real Pinterest searches the ideas
// prompt must aim at. Pure; stages/ideas.ts fetches the rows live from the
// API (print-only, never stored — same rule as `clarity trends`).
//
// Growth review, Oct 5 2026 (plan §1): 98 of 132 live titles carried none of
// the words Pinterest's own data says people search, and the one post-
// revival pin on a trending phrase (Slow October) was the only one above
// 700 impressions. So the searches the blog does not answer yet are no
// longer a hint in the prompt; they are the assignment.
import type { TrendRow } from "./trendsReport.js";

/** At most this many gap searches are put in front of the model. */
export const MAX_TARGETS = 15;

/** Searches the blog has no post for, biggest and fastest-growing first. */
export function pickTargets(rows: TrendRow[], max = MAX_TARGETS): TrendRow[] {
  return rows
    .filter((r) => !r.coveredBy)
    .sort((a, b) => b.now - a.now || b.mom - a.mom || a.keyword.localeCompare(b.keyword))
    .slice(0, max);
}

/**
 * The prompt block. `count` is how many ideas the run makes; at least
 * `Math.min(count, targets.length)` of them must take a target phrase.
 * Empty when there are no targets, so the prompt degrades to the demand
 * cache alone rather than carrying an empty heading.
 */
export function formatDemandTargets(targets: TrendRow[], count: number): string {
  if (!targets.length) return "";
  const must = Math.min(count, targets.length);
  const lines = targets.map(
    (t) => `- "${t.keyword}" (this week ${t.now}/100 of its yearly peak, ${t.mom >= 0 ? "+" : ""}${t.mom}% month on month, peaks in ${t.peakMonth})`,
  );
  return [
    `SEARCHES PEOPLE RUN ON PINTEREST THAT THE BLOG DOES NOT ANSWER YET (live from Pinterest's trends API):`,
    ...lines,
    ``,
    `At least ${must} of the ${count} ideas MUST each take one of these searches: the exact phrase (or its natural singular/plural) appears in the list title, one idea per phrase, the biggest searches first. A search whose peak month is more than ~8 weeks away can wait; prefer the ones peaking within the next two months.`,
  ].join("\n");
}
