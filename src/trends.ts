// Live Pinterest search demand for Clarity's own topic vocabulary.
//
// Why a cache and not a fetch: trends.pinterest.com is cookie-authenticated
// against the ClarityBucketLists login, so the nightly 02:00 job — which runs
// with no browser and nobody logged in — can never call it. The data is pulled
// by hand through Chrome (see scripts/refresh-trends.md), frozen into
// data/trends.json, and read from disk here.
//
// Why our vocabulary and not Pinterest's top-trends list: /top_trends_filtered/
// returns the global US firehose and ignores its topicInterestIds parameter
// entirely (verified across nine interests — byte-identical results). Today that
// list is nails, hairstyles and holiday greetings, which would drag a bucket-list
// brand somewhere it should not go. The /metrics/ endpoint scores terms WE name,
// so the pipeline asks "how much demand do our themes have?" instead of "what is
// Pinterest trending?" — a far better question for this brand.
//
// The whole module is pure except loadTrends, so tests/trends.test.ts can pin the
// arithmetic and the prompt block down without touching disk or the network.
import { readFile } from "node:fs/promises";
import path from "node:path";

/** One vocabulary term as Pinterest scored it. */
export interface TrendTerm {
  term: string;
  /** Pinterest's normalised search index for the latest week (0-100). */
  searchCount: number;
  /** Percent change month over month. */
  momChange: number;
  /** Percent change year over year. */
  yoyChange: number;
  /** 0-1; high means the term lives or dies by the calendar. */
  seasonality: number;
}

export interface TrendsCache {
  /** The day the pull happened (what staleness is measured from). */
  fetchedAt: string;
  /** Pinterest's own latest_available_date — it lags the pull by about a week. */
  dataDate: string;
  country: string;
  terms: TrendTerm[];
}

/** Past this many days the cache is called stale and the run warns. */
export const STALE_AFTER_DAYS = 30;

/** MoM percent at or above which a term counts as rising. */
export const RISING_MOM = 15;

/** MoM percent at or below which a term counts as fading. */
export const FADING_MOM = -15;

/** Seasonality at or above which a term is called out as calendar-driven. */
export const PEAKING_SEASONALITY = 0.5;

/**
 * A term must carry at least this much volume before a percentage move counts as
 * "rising". Without it an index of 1 ticking to 2 reads as +100% and outranks a
 * real mover — noise dressed up as a headline. Such terms still show under
 * "peaking" when they are genuinely seasonal, which is where they belong.
 */
export const MIN_RISING_INDEX = 5;

export const TRENDS_FILE = path.join("data", "trends.json");

/**
 * The terms we ask Pinterest to score, drawn from BOARDS, THEMES and the phrasing
 * that actually appears in Pinterest search — "fall bucket list", not "autumnal
 * listicle". Every board should have at least one term pointing at it so a whole
 * board cannot silently fall out of the demand picture.
 *
 * Extend freely; the refresh script batches them, so length costs only pull time.
 */
export const TREND_VOCABULARY = [
  // Core bucket-list intent
  "bucket list", "bucket list ideas", "30 before 30", "101 things in 1001 days",
  "life goals list", "yearly goals", "new year goals", "monthly goals", "2027 goals",
  // Seasonal spines
  "fall bucket list", "autumn bucket list", "winter bucket list", "summer bucket list",
  "spring bucket list", "christmas bucket list", "halloween bucket list", "holiday bucket list",
  "fall activities", "things to do this fall", "winter activities", "christmas activities",
  "thanksgiving activities", "seasonal activities", "cozy fall activities", "fall aesthetic",
  "pumpkin patch", "apple picking",
  // Aesthetic / self-care / manifestation boards
  "vision board ideas", "manifestation", "manifestation journal", "self care ideas",
  "self care checklist", "self care sunday", "glow up checklist", "glow up tips",
  "that girl aesthetic", "that girl routine", "romanticize your life", "morning routine",
  "evening routine", "habit tracker", "journaling prompts", "mindfulness", "dopamine menu",
  // Slow living / digital detox
  "digital detox", "slow living", "hygge", "rainy day activities", "staycation ideas",
  // People
  "date night ideas", "date ideas", "couple bucket list", "friendship bucket list",
  "family bucket list", "things to do with friends", "girls night ideas", "things to do alone",
  // Travel & festivals
  "travel bucket list", "places to visit before you die", "solo travel", "weekend getaway ideas",
  "road trip ideas", "europe travel", "micro adventures", "adventure bucket list",
  "outdoor adventures", "nature bucket list", "stargazing", "sunrise hike",
  "music festival", "festival outfits", "concert bucket list",
  // Screen & stage
  "movies to watch", "movie night ideas", "films to watch before you die", "tv shows to watch",
  "binge watch list", "broadway musicals", "theatre kid",
  // Books & learning
  "books to read", "reading challenge", "book bucket list", "booktok",
  "learn a new skill", "skills to learn",
  // Career & tech
  "career goals", "career change", "side hustle ideas", "productivity tips",
  "learn to code", "coding for beginners", "tech skills",
  // Creative & food
  "creative hobbies", "hobby ideas", "art journal ideas", "crafts to try",
  "baking bucket list", "foods to try", "restaurant bucket list", "cocktail recipes",
  "coffee shop aesthetic",
  // Luxury
  "luxury lifestyle", "luxury travel", "old money aesthetic", "rich girl aesthetic",
  // Celebration
  "party ideas", "birthday ideas", "celebration ideas", "new year's eve ideas",
] as const;

/** Pinterest's /metrics/ endpoint takes a comma-joined batch; 20 is what its own UI sends. */
export const METRICS_BATCH_SIZE = 20;

const DAY_MS = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Weekly buckets, so a month is four points back and a year is fifty-two. */
const WEEKS_PER_MONTH = 4;
const WEEKS_PER_YEAR = 52;

/** Percent changes are clamped here — off a near-zero baseline they explode. */
export const MAX_PCT = 500;

/** Percent change from `from` to `to`, clamped, and honest about a zero baseline. */
function pctChange(from: number, to: number): number {
  if (from <= 0) return to > 0 ? MAX_PCT : 0;
  const pct = ((to - from) / from) * 100;
  return Math.max(-100, Math.min(MAX_PCT, pct));
}

/**
 * How calendar-driven a term is, on 0-1, from the shape of its own year.
 *
 * A flat series has a mean close to its peak and scores near 0; a series that
 * spends the year at nothing and spikes once scores near 1. Pinterest exposes a
 * seasonality_score on /top_trends_filtered/ but not on /metrics/, so it is
 * derived here rather than left blank.
 */
function seasonalityOf(counts: number[]): number {
  if (counts.length < WEEKS_PER_MONTH) return 0;
  const peak = Math.max(...counts);
  if (peak <= 0) return 0;
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  return Math.max(0, Math.min(1, 1 - mean / peak));
}

/** One entry as Pinterest sends it; every field optional because it omits them freely. */
interface RawMetricsEntry {
  term?: unknown;
  counts?: unknown;
}

/**
 * Map Pinterest's /metrics/ payload onto TrendTerm.
 *
 * The payload is an array of `{ term, counts: [{ date, normalizedCount }] }` —
 * weekly points, oldest first. It also carries a `growth_rates` object, which is
 * NOT used: Pinterest reports mom_change 2 for a 31 -> 86 move, so its units do
 * not agree with the series it ships alongside. Recomputing from counts keeps the
 * numbers we print and the numbers we rank on the same numbers.
 *
 * Both the array form and an object-keyed form have been seen in the wild, so both
 * are accepted. A malformed entry is skipped rather than throwing — one bad term
 * must not take a generation run down.
 */
export function parseMetricsResponse(raw: unknown): TrendTerm[] {
  const entries: RawMetricsEntry[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.values(raw as Record<string, RawMetricsEntry>)
      : [];

  const out: TrendTerm[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || typeof entry.term !== "string") continue;
    const points = Array.isArray(entry.counts) ? entry.counts : [];
    // Pinterest sends {date, normalizedCount} points; data/trends.json stores the
    // same series as bare numbers, which keeps the committed cache small.
    const counts = points.map((p: any) => (typeof p === "number" ? num(p) : num(p?.normalizedCount ?? p?.count)));

    const latest = counts.length ? counts[counts.length - 1] : 0;
    const monthAgo = counts[counts.length - 1 - WEEKS_PER_MONTH];
    const yearAgo = counts[counts.length - 1 - WEEKS_PER_YEAR];

    out.push({
      term: entry.term,
      searchCount: latest,
      momChange: monthAgo === undefined ? 0 : pctChange(monthAgo, latest),
      yoyChange: yearAgo === undefined ? 0 : pctChange(yearAgo, latest),
      seasonality: seasonalityOf(counts),
    });
  }
  return out;
}

/** Whole days between the pull and `today`; never negative. */
export function cacheAgeDays(cache: TrendsCache, today: string): number {
  const age = Math.floor((toMs(today) - toMs(cache.fetchedAt)) / DAY_MS);
  return age > 0 ? age : 0;
}

/** A missing cache is stale by definition — there is nothing to trust. */
export function isStale(cache: TrendsCache | undefined, today: string, maxAgeDays = STALE_AFTER_DAYS): boolean {
  if (!cache) return true;
  return cacheAgeDays(cache, today) > maxAgeDays;
}

export interface Classified {
  rising: TrendTerm[];
  steady: TrendTerm[];
  fading: TrendTerm[];
  /** Calendar-driven terms, drawn from all three buckets. */
  peaking: TrendTerm[];
}

/**
 * Split the vocabulary by momentum, biggest mover first within each bucket.
 * The three momentum buckets are exhaustive: a term too small to call "rising"
 * falls back to steady rather than vanishing from the picture entirely.
 */
export function classify(terms: TrendTerm[]): Classified {
  const byMom = [...terms].sort((a, b) => b.momChange - a.momChange);
  const isFading = (t: TrendTerm) => t.momChange <= FADING_MOM;
  const isRising = (t: TrendTerm) => t.momChange >= RISING_MOM && t.searchCount >= MIN_RISING_INDEX;
  return {
    rising: byMom.filter(isRising),
    steady: byMom.filter((t) => !isRising(t) && !isFading(t)),
    fading: byMom.filter(isFading),
    peaking: byMom.filter((t) => t.seasonality >= PEAKING_SEASONALITY),
  };
}

const line = (t: TrendTerm) => `${t.term} (index ${Math.round(t.searchCount)}, ${t.momChange >= 0 ? "+" : ""}${Math.round(t.momChange)}% MoM)`;

/**
 * The block spliced into the ideas prompt. Returns "" when there is no cache at
 * all, so the prompt degrades to its old self rather than carrying an empty
 * heading the model might try to fill in.
 */
export function formatForPrompt(cache: TrendsCache | undefined, today: string): string {
  if (!cache || !cache.terms.length) return "";
  const { rising, steady, fading, peaking } = classify(cache.terms);
  const stale = isStale(cache, today);

  const parts = [
    `LIVE PINTEREST DEMAND (${cache.country}) — Pinterest data through ${cache.dataDate}, pulled ${cache.fetchedAt}.`,
    stale
      ? `WARNING: this data is stale (${cacheAgeDays(cache, today)} days old). Weigh it lightly and prefer evergreen angles.`
      : `These are real Pinterest search volumes for Clarity's own topic vocabulary — not generic trending terms.`,
    `Favour rising and peaking themes. Treat fading ones as spent unless you have a genuinely fresh angle.`,
  ];

  if (rising.length) parts.push(`\nRising:\n${rising.slice(0, 20).map((t) => `- ${line(t)}`).join("\n")}`);
  if (peaking.length) parts.push(`\nPeaking now (calendar-driven — good for a 45-60 day seasonal play):\n${peaking.slice(0, 12).map((t) => `- ${t.term}`).join("\n")}`);
  if (steady.length) parts.push(`\nSteady (reliable evergreen demand):\n${steady.slice(0, 12).map((t) => `- ${line(t)}`).join("\n")}`);
  if (fading.length) parts.push(`\nFading:\n${fading.slice(0, 10).map((t) => `- ${line(t)}`).join("\n")}`);

  return parts.join("\n");
}

/** Read data/trends.json; undefined when it is absent or unreadable. */
export async function loadTrends(file = TRENDS_FILE): Promise<TrendsCache | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as TrendsCache;
    if (!parsed?.terms?.length) return undefined;
    return parsed;
  } catch {
    // No cache yet, or a half-written one — the caller warns and carries on.
    return undefined;
  }
}
