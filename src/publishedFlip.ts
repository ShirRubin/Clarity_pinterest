// src/publishedFlip.ts — which Scheduled rows are live now. Pure; the stage
// does the I/O. A row is live once every slot of its scheduled date has passed,
// i.e. on any later local day — never on the day itself (the nightly job runs at
// 02:00, seven hours before the first slot).
import { POST_TZ } from "./schedule.js";
import { variantSummary } from "./variants.js";

export interface FlipCandidate {
  pageId: string;
  name: string;
  status?: string;
  scheduledDate?: string; // YYYY-MM-DD
  publishedDate?: string; // YYYY-MM-DD
  /** Per-variant date columns; when any is filled they decide instead of scheduledDate. */
  variants?: Partial<Record<string, string>>;
}

export interface FlipDecision {
  pageId: string;
  /** What `Published date` becomes: the existing value if set, else the scheduled date. */
  publishedDate: string;
}

/** The calendar date in the posting zone — the nightly job runs at 02:00 local,
 *  which is still "yesterday" in UTC. */
export function localToday(now: Date = new Date(), tz: string = POST_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function publishedFlip(rows: FlipCandidate[], today: string): FlipDecision[] {
  const out: FlipDecision[] = [];
  for (const r of rows) {
    if (r.status !== "Scheduled") continue;
    const earliest = variantSummary(r.variants ?? {}, today).earliest ?? r.scheduledDate;
    if (!earliest) continue; // never flip blind
    if (earliest >= today) continue; // YYYY-MM-DD compares lexically
    out.push({ pageId: r.pageId, publishedDate: r.publishedDate ?? earliest });
  }
  return out;
}
