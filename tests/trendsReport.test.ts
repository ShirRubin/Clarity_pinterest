import { test } from "node:test";
import assert from "node:assert/strict";
import { coverage, pct, toRow } from "../src/trendsReport.js";

const SLUGS = ["couples-bucket-list", "winter-bucket-list", "the-hot-springs-bucket-list-12-thermal-soaks-to-book-this-wi", "travel-bucket-list"];

test("a post covers a search when its slug holds every meaningful word", () => {
  assert.equal(coverage("couples bucket list ideas", SLUGS), "couples-bucket-list");
  assert.equal(coverage("winter bucket list", SLUGS), "winter-bucket-list");
  assert.equal(coverage("hot springs", SLUGS), "the-hot-springs-bucket-list-12-thermal-soaks-to-book-this-wi");
});

test("a search with a word no slug has is a gap — spring is not hot springs", () => {
  assert.equal(coverage("senior year bucket list", SLUGS), undefined);
  assert.equal(coverage("october bucket list", SLUGS), undefined);
  assert.equal(coverage("spring bucket list", SLUGS), undefined);
});

test("a search made only of filler is answered by the whole site", () => {
  assert.equal(coverage("bucket list ideas", SLUGS), "(the whole site)");
  assert.equal(coverage("2026 bucket list aesthetic", SLUGS), "(the whole site)");
});

test("the shortest covering slug wins", () => {
  assert.equal(coverage("travel bucket list", [...SLUGS, "travel-bucket-list-for-couples-in-europe"]), "travel-bucket-list");
});

test("toRow reads the latest week and the peak month from the weekly series, in date order", () => {
  const r = toRow(
    {
      keyword: "winter bucket list",
      pct_growth_wow: 10,
      pct_growth_mom: 300,
      pct_growth_yoy: 20,
      time_series: { "2026-09-24": 12, "2025-12-18": 100, "2026-01-08": 80, "2026-09-17": 9 },
    },
    SLUGS,
  );
  assert.equal(r.now, 12);
  assert.equal(r.peakMonth, "Dec");
  assert.equal(r.coveredBy, "winter-bucket-list");
});

test("pct marks Pinterest's 10001% cap as new", () => {
  assert.equal(pct(10001), "new");
  assert.equal(pct(500), "+500%");
  assert.equal(pct(-40), "-40%");
  assert.equal(pct(0), "0%");
});
