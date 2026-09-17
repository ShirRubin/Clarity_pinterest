import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMetricsResponse,
  cacheAgeDays,
  isStale,
  classify,
  formatForPrompt,
  STALE_AFTER_DAYS,
  RISING_MOM,
  FADING_MOM,
  PEAKING_SEASONALITY,
  MIN_RISING_INDEX,
  MAX_PCT,
  type TrendsCache,
  type TrendTerm,
} from "../src/trends.js";

const term = (over: Partial<TrendTerm> & { term: string }): TrendTerm => ({
  searchCount: 50,
  momChange: 0,
  yoyChange: 0,
  seasonality: 0.1,
  ...over,
});

const cache = (over: Partial<TrendsCache> = {}): TrendsCache => ({
  fetchedAt: "2026-09-17",
  dataDate: "2026-09-09",
  country: "US",
  terms: [term({ term: "fall bucket list" })],
  ...over,
});

// --- parseMetricsResponse ----------------------------------------------------
//
// Pinterest returns an ARRAY of { term, counts: [weekly points], growth_rates }.
// Its own growth_rates are not trustworthy as percentages — it reports mom_change
// 2 for a 31 -> 86 move (really +177%) — so momentum is recomputed from counts.

/** Build a weekly series ending at `last`, `weeks` long, flat unless overridden. */
const series = (weeks: number, fill: number, over: Record<number, number> = {}) =>
  Array.from({ length: weeks }, (_, i) => ({
    date: `w${i}`,
    normalizedCount: over[i] ?? fill,
  }));

test("reads the latest weekly point as the current search index", () => {
  const raw = [{ term: "fall bucket list", counts: series(53, 20, { 52: 86 }) }];
  const [t] = parseMetricsResponse(raw);
  assert.equal(t.term, "fall bucket list");
  assert.equal(t.searchCount, 86);
});

test("computes MoM from the point four weeks back, not from growth_rates", () => {
  const raw = [
    {
      term: "fall bucket list",
      counts: series(53, 20, { 48: 31, 52: 86 }),
      growth_rates: { mom_change: 2 }, // Pinterest's own figure — deliberately ignored
    },
  ];
  const [t] = parseMetricsResponse(raw);
  assert.equal(Math.round(t.momChange), 177); // 31 -> 86
});

test("computes YoY from the point 52 weeks back", () => {
  const raw = [{ term: "x", counts: series(53, 10, { 0: 50, 52: 100 }) }];
  const [t] = parseMetricsResponse(raw);
  assert.equal(Math.round(t.yoyChange), 100);
});

test("scores a spiky series as seasonal and a flat one as evergreen", () => {
  const spiky = parseMetricsResponse([{ term: "halloween", counts: series(53, 2, { 40: 100, 52: 5 }) }])[0];
  const flat = parseMetricsResponse([{ term: "morning routine", counts: series(53, 60) }])[0];
  assert.ok(spiky.seasonality > 0.8, `spiky was ${spiky.seasonality}`);
  assert.ok(flat.seasonality < 0.1, `flat was ${flat.seasonality}`);
});

test("caps a rise off a zero baseline instead of returning Infinity", () => {
  const [t] = parseMetricsResponse([{ term: "x", counts: series(53, 0, { 52: 90 }) }]);
  assert.ok(Number.isFinite(t.momChange));
  assert.equal(t.momChange, MAX_PCT);
});

test("a term with no movement from zero reports no change, not a fake rise", () => {
  const [t] = parseMetricsResponse([{ term: "dead", counts: series(53, 0) }]);
  assert.equal(t.momChange, 0);
  assert.equal(t.searchCount, 0);
});

test("tolerates short, empty and malformed entries rather than throwing", () => {
  const out = parseMetricsResponse([
    { term: "short", counts: series(2, 5) },
    { term: "empty", counts: [] },
    { term: "missing" },
    null,
    { counts: series(53, 5) }, // no term
  ]);
  assert.deepEqual(out.map((t) => t.term), ["short", "empty", "missing"]);
  assert.equal(out[0].searchCount, 5);
  assert.equal(out[1].searchCount, 0);
});

test("accepts a bare-number series, which is how the cache stores it", () => {
  const counts = Array.from({ length: 53 }, (_, i) => (i === 48 ? 40 : i === 52 ? 80 : 10));
  const [t] = parseMetricsResponse([{ term: "compact", counts }]);
  assert.equal(t.searchCount, 80);
  assert.equal(Math.round(t.momChange), 100); // 40 -> 80
});

test("accepts the object-keyed form too, since Pinterest has shipped both", () => {
  const out = parseMetricsResponse({ "0": { term: "a", counts: series(53, 7) } });
  assert.deepEqual(out.map((t) => t.term), ["a"]);
});

// --- cacheAgeDays / isStale --------------------------------------------------

test("cache age is measured from fetchedAt, in whole days", () => {
  assert.equal(cacheAgeDays(cache({ fetchedAt: "2026-09-17" }), "2026-09-17"), 0);
  assert.equal(cacheAgeDays(cache({ fetchedAt: "2026-09-10" }), "2026-09-17"), 7);
});

test("a cache goes stale only after the threshold, not on it", () => {
  const onThreshold = cache({ fetchedAt: "2026-08-18" }); // exactly 30 days before
  assert.equal(cacheAgeDays(onThreshold, "2026-09-17"), STALE_AFTER_DAYS);
  assert.equal(isStale(onThreshold, "2026-09-17"), false);

  const past = cache({ fetchedAt: "2026-08-17" });
  assert.equal(isStale(past, "2026-09-17"), true);
});

test("a missing cache counts as stale", () => {
  assert.equal(isStale(undefined, "2026-09-17"), true);
});

// --- classify ----------------------------------------------------------------

test("a big percentage on a tiny index is not called rising — it is noise", () => {
  const { rising, steady } = classify([
    term({ term: "noise", momChange: 300, searchCount: MIN_RISING_INDEX - 1 }),
    term({ term: "real", momChange: 300, searchCount: MIN_RISING_INDEX }),
  ]);
  assert.deepEqual(rising.map((t) => t.term), ["real"]);
  assert.deepEqual(steady.map((t) => t.term), ["noise"]);
});

test("the three momentum buckets stay exhaustive", () => {
  const terms = [
    term({ term: "a", momChange: 300, searchCount: 1 }),
    term({ term: "b", momChange: 300, searchCount: 90 }),
    term({ term: "c", momChange: 0 }),
    term({ term: "d", momChange: -80 }),
  ];
  const { rising, steady, fading } = classify(terms);
  assert.equal(rising.length + steady.length + fading.length, terms.length);
});

test("splits terms into rising, steady and fading on the MoM thresholds", () => {
  const { rising, steady, fading } = classify([
    term({ term: "up", momChange: RISING_MOM }),
    term({ term: "flat", momChange: 0 }),
    term({ term: "down", momChange: FADING_MOM }),
  ]);
  assert.deepEqual(rising.map((t) => t.term), ["up"]);
  assert.deepEqual(steady.map((t) => t.term), ["flat"]);
  assert.deepEqual(fading.map((t) => t.term), ["down"]);
});

test("rising is ordered by MoM change, biggest mover first", () => {
  const { rising } = classify([
    term({ term: "small", momChange: 20 }),
    term({ term: "huge", momChange: 300 }),
    term({ term: "mid", momChange: 90 }),
  ]);
  assert.deepEqual(rising.map((t) => t.term), ["huge", "mid", "small"]);
});

test("peaking picks up seasonal terms regardless of which bucket they fell in", () => {
  const { peaking } = classify([
    term({ term: "seasonal riser", momChange: 200, seasonality: PEAKING_SEASONALITY }),
    term({ term: "evergreen riser", momChange: 200, seasonality: 0.05 }),
  ]);
  assert.deepEqual(peaking.map((t) => t.term), ["seasonal riser"]);
});

// --- formatForPrompt ---------------------------------------------------------

test("returns an empty string with no cache, so the prompt simply loses the block", () => {
  assert.equal(formatForPrompt(undefined, "2026-09-17"), "");
});

test("names the data date and the pull date so the model can judge freshness", () => {
  const out = formatForPrompt(cache(), "2026-09-17");
  assert.match(out, /2026-09-09/);
  assert.match(out, /2026-09-17/);
});

test("lists rising terms with their index and MoM change", () => {
  const out = formatForPrompt(
    cache({ terms: [term({ term: "fall bucket list", searchCount: 82, momChange: 140 })] }),
    "2026-09-17",
  );
  assert.match(out, /fall bucket list/);
  assert.match(out, /82/);
  assert.match(out, /140/);
});

test("warns in the block itself when the data is stale", () => {
  const out = formatForPrompt(cache({ fetchedAt: "2026-06-01" }), "2026-09-17");
  assert.match(out, /stale/i);
});

test("omits a bucket that has no terms rather than printing an empty heading", () => {
  const out = formatForPrompt(
    cache({ terms: [term({ term: "only rising", momChange: 200 })] }),
    "2026-09-17",
  );
  assert.match(out, /Rising/);
  assert.doesNotMatch(out, /Fading/);
});
