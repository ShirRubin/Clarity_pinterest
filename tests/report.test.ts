import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, type ApiPin, type PinOrigin } from "../src/report.js";

const TODAY = "2026-09-26";

function pin(id: string, created: string, m: Partial<ApiPin["metrics"]> = {}): ApiPin {
  return {
    id,
    createdAt: `${created}T06:00:00`,
    title: `Pin ${id}`,
    link: `https://clarity-lists.com/posts/${id}`,
    metrics: { impression: 0, save: 0, pinClick: 0, outboundClick: 0, ...m },
  };
}

const ACCOUNT = { impression: 728125, save: 9182, pinClick: 38039, outboundClick: 20 };

const origin = (template: string): PinOrigin => ({ template, slug: "x" });

test("groups mature pins by template from the posted packs and sums their metrics", () => {
  const pins = [
    pin("a", "2026-09-01", { impression: 1000, save: 20, pinClick: 50, outboundClick: 1 }),
    pin("b", "2026-09-02", { impression: 3000, save: 10, pinClick: 30, outboundClick: 0 }),
    pin("c", "2026-09-03", { impression: 500, save: 5, pinClick: 10, outboundClick: 2 }),
  ];
  const origins = new Map([["a", origin("sticky-note")], ["b", origin("sticky-note")], ["c", origin("big-numbers")]]);
  const r = buildReport(pins, origins, ACCOUNT, TODAY, 14);
  const sticky = r.templates.find((t) => t.template === "sticky-note")!;
  assert.equal(sticky.pins, 2);
  assert.equal(sticky.impression, 4000);
  assert.equal(sticky.save, 30);
  assert.equal(sticky.savesPer1k, 7.5);
  assert.equal(r.templates.find((t) => t.template === "big-numbers")!.outboundClick, 2);
});

test("pins younger than the maturity window are counted as too new, not compared", () => {
  const pins = [
    pin("old", "2026-09-01", { impression: 1000 }),
    pin("new", "2026-09-20", { impression: 10 }),
  ];
  const origins = new Map([["old", origin("bold-panel")], ["new", origin("bold-panel")]]);
  const r = buildReport(pins, origins, ACCOUNT, TODAY, 14);
  assert.equal(r.templates.find((t) => t.template === "bold-panel")!.pins, 1);
  assert.equal(r.tooNew, 1);
});

test("pins with no posted pack are reported as untracked; totals are the account's, not a sum of pins", () => {
  const pins = [
    pin("legacy", "2025-06-01", { impression: 48000, save: 578, pinClick: 1859, outboundClick: 1 }),
    pin("a", "2026-09-01", { impression: 1000, outboundClick: 1 }),
  ];
  const r = buildReport(pins, new Map([["a", origin("sticky-note")]]), ACCOUNT, TODAY, 14);
  assert.equal(r.untracked, 1);
  assert.equal(r.totals.impression, 728125);
  assert.equal(r.totals.outboundClick, 20);
  assert.equal(r.totals.pins, 2);
});

test("a repin of one of our own pins echoes the original's metrics, so it is counted once and left out", () => {
  const pins = [
    pin("orig", "2025-04-17", { save: 3412, outboundClick: 4 }),
    { ...pin("copy", "2025-06-15", { save: 3412, outboundClick: 4 }), parentPinId: "orig" },
    { ...pin("foreign", "2025-06-15", { save: 9 }), parentPinId: "someone-elses-pin" },
  ];
  const r = buildReport(pins, new Map(), ACCOUNT, TODAY, 14);
  assert.equal(r.repins, 1);
  assert.equal(r.totals.pins, 2);
  assert.deepEqual(r.topSaves.map((p) => p.id), ["orig", "foreign"]);
});

test("every template appears in the table even with no pins, in registry order", () => {
  const r = buildReport([], new Map(), ACCOUNT, TODAY, 14);
  assert.deepEqual(
    r.templates.map((t) => t.template),
    ["classic-checklist", "bold-panel", "sticky-note", "big-numbers"],
  );
  assert.equal(r.templates[0].savesPer1k, 0);
});

test("top lists rank by outbound clicks and by saves, ignoring pins with zero of that metric", () => {
  const pins = [
    pin("a", "2026-09-01", { save: 5, outboundClick: 3 }),
    pin("b", "2026-09-01", { save: 50, outboundClick: 0 }),
    pin("c", "2026-09-01", { save: 20, outboundClick: 1 }),
  ];
  const r = buildReport(pins, new Map(), ACCOUNT, TODAY, 14, 2);
  assert.deepEqual(r.topOutbound.map((p) => p.id), ["a", "c"]);
  assert.deepEqual(r.topSaves.map((p) => p.id), ["b", "c"]);
});

test("the outbound warning fires when fewer than 1 in 100 pin clicks reach the site", () => {
  const low = buildReport([], new Map(), ACCOUNT, TODAY, 14);
  assert.match(low.outboundWarning ?? "", /Only 20 of 38,039/);
  const fine = buildReport([], new Map(), { ...ACCOUNT, pinClick: 1000, outboundClick: 50 }, TODAY, 14);
  assert.equal(fine.outboundWarning, undefined);
});
