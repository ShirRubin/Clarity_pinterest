import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDemandTargets, pickTargets, MAX_TARGETS } from "../src/demandTargets.js";
import type { TrendRow } from "../src/trendsReport.js";

const row = (keyword: string, now: number, mom: number, coveredBy?: string): TrendRow => ({
  keyword,
  wow: 0,
  mom,
  yoy: 0,
  now,
  peakMonth: "Dec",
  ...(coveredBy ? { coveredBy } : {}),
});

test("pickTargets keeps only the searches with no post, biggest first then fastest-growing", () => {
  const rows = [
    row("fall bucket list", 100, 90, "fall-bucket-list"),
    row("christmas bucket list", 60, 300),
    row("couples bucket list", 80, 10),
    row("bucket list for seniors", 80, 40),
  ];
  assert.deepEqual(
    pickTargets(rows).map((r) => r.keyword),
    ["bucket list for seniors", "couples bucket list", "christmas bucket list"],
  );
});

test("pickTargets caps the list", () => {
  const rows = Array.from({ length: 40 }, (_, i) => row(`search ${i}`, 40 - i, 0));
  assert.equal(pickTargets(rows).length, MAX_TARGETS);
  assert.equal(pickTargets(rows, 3).length, 3);
});

test("formatDemandTargets names each search with its numbers and sets the minimum the run must cover", () => {
  const block = formatDemandTargets([row("christmas bucket list", 60, 300), row("couples bucket list", 80, 10)], 5);
  assert.match(block, /DOES NOT ANSWER YET/);
  assert.match(block, /"christmas bucket list" \(this week 60\/100 of its yearly peak, \+300% month on month, peaks in Dec\)/);
  assert.match(block, /At least 2 of the 5 ideas MUST/);
});

test("the minimum never exceeds the run size", () => {
  const block = formatDemandTargets(Array.from({ length: 9 }, (_, i) => row(`s${i}`, 1, 0)), 3);
  assert.match(block, /At least 3 of the 3 ideas MUST/);
});

test("no targets means no block, so the prompt loses the heading rather than carrying an empty one", () => {
  assert.equal(formatDemandTargets([], 5), "");
});
