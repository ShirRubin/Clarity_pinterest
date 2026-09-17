import { test } from "node:test";
import assert from "node:assert/strict";
import { variantSummary, listStatusFromVariants, variantGaps, VARIANT_COLUMNS } from "../src/variants.js";
import { TEMPLATE_NAMES } from "../src/templates.js";

test("the variant columns are exactly the template names, in template order", () => {
  assert.deepEqual([...VARIANT_COLUMNS], [...TEMPLATE_NAMES]);
});

// --- variantSummary ----------------------------------------------------------

test("an empty row has nothing posted and no earliest date", () => {
  assert.deepEqual(variantSummary({}, "2026-09-17"), { posted: 0, total: 4, scheduled: false, live: false, earliest: undefined });
});

test("a future date is scheduled, a past date is live, and earliest is the minimum", () => {
  const s = variantSummary({ "classic-checklist": "2026-09-20", "bold-panel": "2026-09-15" }, "2026-09-17");
  assert.deepEqual(s, { posted: 2, total: 4, scheduled: true, live: true, earliest: "2026-09-15" });
});

test("a variant dated today counts as scheduled, not live — its slots have not all passed", () => {
  const s = variantSummary({ "sticky-note": "2026-09-17" }, "2026-09-17");
  assert.equal(s.scheduled, true);
  assert.equal(s.live, false);
});

test("a column outside the template set is ignored, not counted", () => {
  const s = variantSummary({ "classic-checklist": "2026-09-20", video: "2026-09-21" }, "2026-09-17");
  assert.equal(s.posted, 1);
});

// --- listStatusFromVariants --------------------------------------------------

test("no status until every variant column is filled", () => {
  assert.equal(listStatusFromVariants({ "classic-checklist": "2026-09-01" }, "2026-09-17"), undefined);
});

test("all filled and none past → Scheduled", () => {
  const v = { "classic-checklist": "2026-09-18", "bold-panel": "2026-09-19", "sticky-note": "2026-09-20", "big-numbers": "2026-09-21" };
  assert.equal(listStatusFromVariants(v, "2026-09-17"), "Scheduled");
});

test("all filled and the earliest has passed → Published", () => {
  const v = { "classic-checklist": "2026-09-16", "bold-panel": "2026-09-19", "sticky-note": "2026-09-20", "big-numbers": "2026-09-21" };
  assert.equal(listStatusFromVariants(v, "2026-09-17"), "Published");
});

// --- variantGaps -------------------------------------------------------------

const pack = (date: string, template: string, pageId: string) => ({
  dir: `${date}--the-tea-bucket-list--${template}`,
  date,
  slug: "the-tea-bucket-list",
  template,
  text: { pageId },
});
const row = (pageId: string, variants: Record<string, string>) => ({ pageId, name: "The Tea Bucket List", source: "pipeline", variants });

test("a posted pack whose row has no date for that variant is a gap", () => {
  const gaps = variantGaps([pack("2026-09-20", "bold-panel", "p1")], [row("p1", { "classic-checklist": "2026-09-19" })], "2026-09-17");
  assert.deepEqual(gaps.map((g) => g.dir), ["2026-09-20--the-tea-bucket-list--bold-panel"]);
});

test("a pack whose row already carries that variant's date is not a gap, even if the date differs", () => {
  const gaps = variantGaps([pack("2026-09-20", "bold-panel", "p1")], [row("p1", { "bold-panel": "2026-09-21" })], "2026-09-17");
  assert.deepEqual(gaps, []);
});

test("packs dated before today are ignored — old bookkeeping is not worth a warning", () => {
  const gaps = variantGaps([pack("2026-09-01", "bold-panel", "p1")], [row("p1", {})], "2026-09-17");
  assert.deepEqual(gaps, []);
});

test("a pack with no Notion row at all is a gap too", () => {
  const gaps = variantGaps([pack("2026-09-20", "bold-panel", "nope")], [row("p1", {})], "2026-09-17");
  assert.equal(gaps.length, 1);
});
