import { test } from "node:test";
import assert from "node:assert/strict";
import { postedTransition, pinUrl } from "../src/posted.js";

test("fewer than all variants posted → nothing changes on the row", () => {
  const p = postedTransition({
    postedTemplates: ["classic-checklist", "bold-panel", "sticky-note"],
    totalTemplates: 4,
    firstPinId: "1",
    earliestPackDate: "2026-09-08",
  });
  assert.deepEqual(p, {});
});

test("all variants posted → Scheduled with the first pin's URL and the earliest date", () => {
  const p = postedTransition({
    postedTemplates: ["classic-checklist", "bold-panel", "sticky-note", "big-numbers"],
    totalTemplates: 4,
    firstPinId: "3826344098274829184",
    earliestPackDate: "2026-09-08",
  });
  assert.deepEqual(p, {
    status: "Scheduled",
    pinUrl: "https://www.pinterest.com/pin/3826344098274829184/",
    pinterestPinId: "3826344098274829184",
    scheduledDate: "2026-09-08",
  });
});

test("an existing Scheduled date is kept", () => {
  const p = postedTransition({
    postedTemplates: ["a", "b", "c", "d"],
    totalTemplates: 4,
    firstPinId: "9",
    earliestPackDate: "2026-09-10",
    existingScheduledDate: "2026-09-08",
  });
  assert.equal(p.scheduledDate, "2026-09-08");
});

test("duplicate template names do not count twice", () => {
  const p = postedTransition({
    postedTemplates: ["a", "a", "b", "c"],
    totalTemplates: 4,
    firstPinId: "9",
    earliestPackDate: "2026-09-10",
  });
  assert.deepEqual(p, {});
});

test("pinUrl formats Pinterest's canonical pin URL", () => {
  assert.equal(pinUrl("42"), "https://www.pinterest.com/pin/42/");
});
