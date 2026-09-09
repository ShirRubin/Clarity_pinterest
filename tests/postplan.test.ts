import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPostPlan, formatPostPlan, SCHEDULER_WINDOW_DAYS } from "../src/postplan.js";
import type { PackInfo } from "../src/packs.js";

const pack = (date: string, template: string, extra: Partial<PackInfo["text"]> = {}): PackInfo => ({
  where: "packs",
  dir: `${date}--the-tea-bucket-list--${template}`,
  path: `exports/packs/${date}--the-tea-bucket-list--${template}`,
  date,
  slug: "the-tea-bucket-list",
  template,
  text: {
    date,
    image: `${template}.png`,
    title: "Tea Bucket List",
    description: "d",
    alt: "a",
    board: "Books · Learning & Culture",
    link: "https://clarity-lists.com/posts/the-tea-bucket-list",
    ...extra,
  },
});

test("orders by date then time, and maps the board to Pinterest's spelling", () => {
  const plan = buildPostPlan(
    [pack("2026-09-09", "bold-panel", { time: "01:00 PM" }), pack("2026-09-08", "classic-checklist", { time: "06:00 PM" }), pack("2026-09-08", "sticky-note", { time: "09:00 AM" })],
    "2026-09-08",
    () => ["tea"],
  );
  assert.deepEqual(plan.entries.map((e) => [e.date, e.time]), [
    ["2026-09-08", "09:00 AM"],
    ["2026-09-08", "06:00 PM"],
    ["2026-09-09", "01:00 PM"],
  ]);
  assert.equal(plan.entries[0].board, "Books, Learning & Culture");
  assert.equal(plan.entries[0].image, "exports/packs/2026-09-08--the-tea-bucket-list--sticky-note/sticky-note.png");
  assert.deepEqual(plan.entries.map((e) => e.n), [1, 2, 3]);
  assert.equal(plan.entries[0].total, 3);
});

test("packs beyond the scheduler window are deferred, not planned", () => {
  const plan = buildPostPlan([pack("2026-09-08", "a"), pack("2026-10-07", "b"), pack("2026-10-08", "c")], "2026-09-08", () => []);
  assert.equal(SCHEDULER_WINDOW_DAYS, 29);
  assert.deepEqual(plan.entries.map((e) => e.date), ["2026-09-08", "2026-10-07"]);
  assert.deepEqual(plan.deferred.map((p) => p.date), ["2026-10-08"]);
});

test("packs without POST AT get slot times by position within the day", () => {
  const plan = buildPostPlan([pack("2026-09-08", "a"), pack("2026-09-08", "b")], "2026-09-08", () => []);
  assert.deepEqual(plan.entries.map((e) => e.time), ["09:00 AM", "01:00 PM"]);
});

test("overdue packs (dated before today) come first and keep their date for the note", () => {
  const plan = buildPostPlan([pack("2026-09-08", "a"), pack("2026-09-06", "b")], "2026-09-08", () => []);
  assert.deepEqual(plan.entries.map((e) => e.date), ["2026-09-06", "2026-09-08"]);
});

test("formatPostPlan prints one block per entry and a deferred line", () => {
  const plan = buildPostPlan([pack("2026-09-08", "a", { time: "09:00 AM" }), pack("2026-10-20", "b")], "2026-09-08", () => ["tea", "baking"]);
  const s = formatPostPlan(plan);
  assert.match(s, /1\/1 {2}2026-09-08 {2}09:00 AM/);
  assert.match(s, /board: Books, Learning & Culture/);
  assert.match(s, /topics: tea \| baking/);
  assert.match(s, /1 more pack waiting for the 29-day window/);
});

test("mixed explicit and fallback times on same day don't collide", () => {
  const plan = buildPostPlan(
    [pack("2026-09-08", "aaa"), pack("2026-09-08", "bbb", { time: "06:00 PM" }), pack("2026-09-08", "ccc")],
    "2026-09-08",
    () => [],
  );
  // aaa gets slot 0 (09:00 AM), bbb has slot 2 (06:00 PM), ccc gets slot 1 (01:00 PM)
  // After sorting by time: aaa (09:00 AM), ccc (01:00 PM), bbb (06:00 PM)
  assert.deepEqual(plan.entries.map((e) => [e.pack.split("--")[2], e.time]), [
    ["aaa", "09:00 AM"],
    ["ccc", "01:00 PM"],
    ["bbb", "06:00 PM"],
  ]);
});

test("a posted pack's time reserves that day's slot, so a surviving untimed pending pack doesn't collide", () => {
  const posted = pack("2026-09-08", "classic-checklist", { time: "09:00 AM" });
  const plan = buildPostPlan([pack("2026-09-08", "bold-panel")], "2026-09-08", () => [], undefined, [posted]);
  assert.deepEqual(plan.entries.map((e) => e.time), ["01:00 PM"]);
});

test("an explicit time without a leading zero still reserves its slot by clock value", () => {
  const posted = pack("2026-09-08", "classic-checklist", { time: "9:00 AM" });
  const plan = buildPostPlan([pack("2026-09-08", "bold-panel")], "2026-09-08", () => [], undefined, [posted]);
  assert.deepEqual(plan.entries.map((e) => e.time), ["01:00 PM"]);
});

test("packs with unknown times sort after known times", () => {
  const plan = buildPostPlan(
    [pack("2026-09-08", "b", { time: "11:30 PM" }), pack("2026-09-08", "a", { time: "09:00 AM" })],
    "2026-09-08",
    () => [],
  );
  assert.deepEqual(plan.entries.map((e) => [e.pack.split("--")[2], e.time]), [
    ["a", "09:00 AM"],
    ["b", "11:30 PM"],
  ]);
});
