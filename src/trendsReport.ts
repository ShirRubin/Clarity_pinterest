// src/trendsReport.ts — the `clarity trends` rows: Pinterest's top search trends
// from the API, shaped for picking new lists. Pure — the API calls live in
// stages/trends.ts.
//
// Print-only, like `clarity report`: Pinterest's developer guidelines and
// clarity-lists.com/privacy/ rule out storing data read from the API, so this
// never writes to data/trends.json (that cache is the Chrome-pulled demand data
// for our own vocabulary — see src/trends.ts).
import type { RawTrend } from "./pinterestApi.js";

export interface TrendRow {
  keyword: string;
  wow: number;
  mom: number;
  yoy: number;
  /** The latest weekly index, 0-100 against the keyword's own yearly peak. */
  now: number;
  /** Month of the yearly peak, e.g. "Oct" — pins should be live 45-60 days before it. */
  peakMonth: string;
  /** Blog post that already answers the search, if any. */
  coveredBy?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Words that never decide whether a post covers a search.
const FILLER = new Set(["bucket", "list", "lists", "idea", "ideas", "for", "the", "a", "an", "and", "of", "to", "with", "in", "my", "your", "aesthetic", "inspo", "2025", "2026", "2027"]);

/** Lower-case words. No plural folding: it let "spring bucket list" match the hot-springs post. */
function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * The blog post whose slug holds every meaningful word of the search, or
 * undefined when it looks like a gap. A search with nothing meaningful left
 * ("bucket list ideas") is answered by the site itself.
 */
export function coverage(keyword: string, slugs: Iterable<string>): string | undefined {
  const need = words(keyword).filter((w) => !FILLER.has(w));
  if (!need.length) return "(the whole site)";
  let best: string | undefined;
  for (const slug of slugs) {
    const have = new Set(words(slug));
    if (need.every((w) => have.has(w)) && (!best || slug.length < best.length)) best = slug;
  }
  return best;
}

export function toRow(t: RawTrend, slugs: Iterable<string>): TrendRow {
  const series = Object.entries(t.time_series ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const now = series.length ? series[series.length - 1][1] : 0;
  let peak: [string, number] | undefined;
  for (const e of series) if (!peak || e[1] > peak[1]) peak = e;
  return {
    keyword: t.keyword,
    wow: t.pct_growth_wow,
    mom: t.pct_growth_mom,
    yoy: t.pct_growth_yoy,
    now,
    peakMonth: peak ? (MONTHS[Number(peak[0].slice(5, 7)) - 1] ?? "?") : "?",
    coveredBy: coverage(t.keyword, slugs),
  };
}

/** Pinterest caps growth at 10001%, meaning "from nothing". */
export function pct(n: number): string {
  if (n >= 10001) return "new";
  return `${n > 0 ? "+" : ""}${n}%`;
}
