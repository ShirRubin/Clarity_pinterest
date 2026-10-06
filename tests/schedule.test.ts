import { test } from "node:test";
import assert from "node:assert/strict";
import { assignDates, SLOT_TIMES, slotTime, localParts, PINS_PER_DAY, URL_GAP_DAYS, BOARD_WEEK_CAP, boardKey } from "../src/schedule.js";

test("fills PINS_PER_DAY slots before moving to the next day", () => {
  const q = ["a", "b", "c", "d"].map((id) => ({ id, destUrl: `https://x/${id}/` }));
  const r = assignDates([], q, "2026-09-01");
  assert.deepEqual(r.map((x) => x.date), ["2026-09-01", "2026-09-01", "2026-09-01", "2026-09-02"]);
});

test("pins sharing a destination URL sit at least URL_GAP_DAYS apart", () => {
  const q = [
    { id: "v1", destUrl: "https://x/b/" },
    { id: "v2", destUrl: "https://x/b/" },
  ];
  const r = assignDates([], q, "2026-09-01");
  assert.equal(r[0].date, "2026-09-01");
  assert.equal(r[1].date, "2026-09-08");
});

test("respects already-scheduled pins for day capacity and URL gap", () => {
  const existing = [
    { date: "2026-09-01", destUrl: "https://x/a/" },
    { date: "2026-09-01", destUrl: "https://x/b/" },
    { date: "2026-09-01", destUrl: "https://x/c/" },
    { date: "2026-09-02", destUrl: "https://x/d/" },
  ];
  const r = assignDates(existing, [{ id: "n", destUrl: "https://x/d/" }], "2026-09-01");
  // Every day through 09-08 is inside the 7-day window of the existing /d/ pin.
  assert.equal(r[0].date, "2026-09-09");
});

test("never assigns before the start date", () => {
  const r = assignDates([], [{ id: "a", destUrl: "https://x/a/" }], "2026-09-10");
  assert.equal(r[0].date, "2026-09-10");
});

test("assigns slots 0..2 within a day and never a fourth — 3 pins a day since 2026-10-05", () => {
  const q = ["a", "b", "c", "d"].map((id) => ({ id, destUrl: `https://x/${id}/` }));
  const r = assignDates([], q, "2026-09-01");
  assert.deepEqual(r.map((x) => x.slot), [0, 1, 2, 0]);
  assert.equal(PINS_PER_DAY, 3);
  assert.equal(SLOT_TIMES.length, PINS_PER_DAY);
});

test("existing pins on a day occupy the earliest slots", () => {
  const existing = [{ date: "2026-09-01", destUrl: "https://x/a/" }];
  const r = assignDates(existing, [{ id: "n", destUrl: "https://x/b/" }], "2026-09-01");
  assert.equal(r[0].date, "2026-09-01");
  assert.equal(r[0].slot, 1);
});

test("slot times are the real posting slots and never noon", () => {
  assert.deepEqual([...SLOT_TIMES], ["09:00 AM", "01:00 PM", "06:00 PM"]);
  assert.equal(slotTime(2), "06:00 PM");
  assert.ok(!SLOT_TIMES.some((t) => t.startsWith("12:")));
});

test("localParts reads the wall clock in Asia/Jerusalem", () => {
  // 2026-09-08 09:00 UTC = 12:00 in Jerusalem (UTC+3, summer time)
  const ts = Date.UTC(2026, 8, 8, 9, 0, 0) / 1000;
  assert.deepEqual(localParts(ts), { date: "2026-09-08", hour: 12 });
  // 2026-09-08 22:30 UTC = 01:30 next day in Jerusalem
  const late = Date.UTC(2026, 8, 8, 22, 30, 0) / 1000;
  assert.deepEqual(localParts(late), { date: "2026-09-09", hour: 1 });
});

test("the same-URL gap is a week — the 2026-09-22 research update, was 3 days", () => {
  assert.equal(URL_GAP_DAYS, 7);
});

test("an item with notBefore waits for that date, and takes the earliest slot from there", () => {
  const q = [
    { id: "now", destUrl: "https://x/a/" },
    { id: "later", destUrl: "https://x/b/", notBefore: "2026-11-02" },
    { id: "past", destUrl: "https://x/c/", notBefore: "2026-08-01" }, // a notBefore in the past is just the start date
  ];
  const r = assignDates([], q, "2026-10-05");
  assert.deepEqual(r.map((x) => x.date), ["2026-10-05", "2026-11-02", "2026-10-05"]);
});

test("a board gets at most BOARD_WEEK_CAP pins in any 7-day stretch; other boards fill the gaps", () => {
  const tv = Array.from({ length: 6 }, (_, i) => ({ id: `tv${i}`, destUrl: `https://x/tv${i}/`, board: "TV & Movie Bucket Lists" }));
  const fall = { id: "fall", destUrl: "https://x/fall/", board: "Fall Bucket Lists" };
  const r = assignDates([], [...tv, fall], "2026-10-05");
  const byId = Object.fromEntries(r.map((x) => [x.id, x.date]));
  assert.equal(BOARD_WEEK_CAP, 4);
  assert.deepEqual([byId.tv0, byId.tv1, byId.tv2, byId.tv3], ["2026-10-05", "2026-10-05", "2026-10-05", "2026-10-06"]);
  assert.equal(byId.tv4, "2026-10-12"); // the fifth waits until the first drops out of the window
  assert.equal(byId.fall, "2026-10-06"); // not blocked by the TV board's cap
});

test("existing pins on a board count toward its cap, and board names match loosely", () => {
  const existing = [
    { date: "2026-10-05", destUrl: "https://x/a/", board: "Books · Learning & Culture" },
    { date: "2026-10-06", destUrl: "https://x/b/", board: "Books, Learning & Culture" },
    { date: "2026-10-07", destUrl: "https://x/c/", board: "Books, Learning & Culture" },
    { date: "2026-10-08", destUrl: "https://x/d/", board: "books learning culture" },
  ];
  const r = assignDates(existing, [{ id: "e", destUrl: "https://x/e/", board: "Books, Learning & Culture" }], "2026-10-05");
  assert.equal(r[0].date, "2026-10-12");
  assert.equal(boardKey("Books · Learning & Culture"), boardKey("Books, Learning & Culture"));
});

test("an item without a board is never held by the board cap", () => {
  const r = assignDates([], [{ id: "n", destUrl: "https://x/n/" }], "2026-10-05");
  assert.equal(r[0].date, "2026-10-05");
});
