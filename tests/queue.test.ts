import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runwayFromPackNames,
  listsNeeded,
  MAX_LISTS_PER_RUN,
  TARGET_RUNWAY_DAYS,
  VARIANTS_PER_LIST,
} from "../src/queue.js";
import { TEMPLATE_NAMES } from "../src/render/renderPin.js";

const pack = (date: string, n = "some-list--classic-checklist") => `${date}--${n}`;

// --- runwayFromPackNames -----------------------------------------------------

test("splits packs into still-to-come and past-due, and measures runway to the last date", () => {
  const names = [
    pack("2026-08-27"), // past due
    pack("2026-08-28"), // past due
    pack("2026-08-30"), // today counts as still to come
    pack("2026-09-06"),
  ];
  const r = runwayFromPackNames(names, "2026-08-30");
  assert.equal(r.pastDue, 2);
  assert.equal(r.packsRemaining, 2);
  assert.equal(r.lastScheduledDate, "2026-09-06");
  assert.equal(r.daysOfRunway, 7);
});

test("no packs at all means no runway", () => {
  const r = runwayFromPackNames([], "2026-08-30");
  assert.equal(r.packsRemaining, 0);
  assert.equal(r.pastDue, 0);
  assert.equal(r.lastScheduledDate, undefined);
  assert.equal(r.daysOfRunway, 0);
});

test("a calendar entirely in the past has zero runway, not negative", () => {
  const r = runwayFromPackNames([pack("2026-08-01"), pack("2026-08-02")], "2026-08-30");
  assert.equal(r.pastDue, 2);
  assert.equal(r.packsRemaining, 0);
  assert.equal(r.daysOfRunway, 0);
});

test("ignores directory names that are not dated packs", () => {
  const r = runwayFromPackNames(["README.md", ".DS_Store", pack("2026-09-06")], "2026-08-30");
  assert.equal(r.packsRemaining, 1);
  assert.equal(r.daysOfRunway, 7);
});

// --- listsNeeded -------------------------------------------------------------

test("a queue already past the target runway needs nothing", () => {
  const r = runwayFromPackNames([pack("2026-09-20")], "2026-08-30"); // 21 days
  assert.equal(listsNeeded(r, 0), 0);
});

test("exactly at the target runway needs nothing", () => {
  const r = runwayFromPackNames([pack("2026-09-13")], "2026-08-30"); // 14 days
  assert.equal(r.daysOfRunway, TARGET_RUNWAY_DAYS);
  assert.equal(listsNeeded(r, 0), 0);
});

test("an empty queue is capped at the per-run maximum", () => {
  const r = runwayFromPackNames([], "2026-08-30");
  assert.equal(listsNeeded(r, 0), MAX_LISTS_PER_RUN);
});

test("a small gap asks for only what closes it", () => {
  // 12 days of runway, 2 days short: 2 days x 3 pins = 6 packs / 2 variants = 3 lists.
  const r = runwayFromPackNames([pack("2026-09-11")], "2026-08-30");
  assert.equal(r.daysOfRunway, 12);
  assert.equal(listsNeeded(r, 0), 3);
});

test("lists already in flight count against what the run needs to make", () => {
  const r = runwayFromPackNames([pack("2026-09-11")], "2026-08-30"); // needs 3
  assert.equal(listsNeeded(r, 2), 1);
});

test("more in flight than needed asks for nothing, never a negative", () => {
  const r = runwayFromPackNames([pack("2026-09-11")], "2026-08-30"); // needs 3
  assert.equal(listsNeeded(r, 9), 0);
});

test("past-due packs do not pad the runway", () => {
  // Same last date, but a pile of overdue packs must not make the queue look healthier.
  const withOverdue = runwayFromPackNames(
    [pack("2026-08-20"), pack("2026-08-21"), pack("2026-08-22"), pack("2026-09-11")],
    "2026-08-30",
  );
  const without = runwayFromPackNames([pack("2026-09-11")], "2026-08-30");
  assert.equal(listsNeeded(withOverdue, 0), listsNeeded(without, 0));
});

// --- drift guard -------------------------------------------------------------

test("VARIANTS_PER_LIST tracks the real template count", () => {
  assert.equal(VARIANTS_PER_LIST, TEMPLATE_NAMES.length);
});

// --- packs already submitted to Pinterest's native scheduler -----------------
// Posted packs move to exports/posted/ by hand, but a pack dated in the future
// is still holding that slot in Pinterest's scheduler. If the calendar ignores
// them the next publish run double-books those days.

test("submitted packs still count as forward cover", () => {
  const r = runwayFromPackNames([], "2026-09-06", [pack("2026-09-20")]);
  assert.equal(r.packsRemaining, 1);
  assert.equal(r.lastScheduledDate, "2026-09-20");
  assert.equal(r.daysOfRunway, 14);
});

test("submitted packs are never counted as past due", () => {
  // Already-published pins are done, not a backlog demanding action.
  const r = runwayFromPackNames([], "2026-09-06", [pack("2026-08-27"), pack("2026-09-01")]);
  assert.equal(r.pastDue, 0);
  assert.equal(r.packsRemaining, 0);
});

test("pending and submitted packs share one calendar", () => {
  const r = runwayFromPackNames(
    [pack("2026-09-04"), pack("2026-09-08")],
    "2026-09-06",
    [pack("2026-09-15")],
  );
  assert.equal(r.pastDue, 1);              // only the pending 09-04
  assert.equal(r.packsRemaining, 2);       // 09-08 + 09-15
  assert.equal(r.lastScheduledDate, "2026-09-15");
});
