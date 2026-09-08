import { test } from "node:test";
import assert from "node:assert/strict";
import { assignDates, SLOT_TIMES, slotTime, localParts, PINS_PER_DAY } from "../src/schedule.js";

test("fills 3 slots per day before moving to the next day", () => {
  const q = ["a", "b", "c", "d"].map((id) => ({ id, destUrl: `https://x/${id}/` }));
  const r = assignDates([], q, "2026-09-01");
  assert.deepEqual(r.map((x) => x.date), ["2026-09-01", "2026-09-01", "2026-09-01", "2026-09-02"]);
});

test("pins sharing a destination URL sit at least 3 days apart", () => {
  const q = [
    { id: "v1", destUrl: "https://x/b/" },
    { id: "v2", destUrl: "https://x/b/" },
  ];
  const r = assignDates([], q, "2026-09-01");
  assert.equal(r[0].date, "2026-09-01");
  assert.equal(r[1].date, "2026-09-04");
});

test("respects already-scheduled pins for day capacity and URL gap", () => {
  const existing = [
    { date: "2026-09-01", destUrl: "https://x/a/" },
    { date: "2026-09-01", destUrl: "https://x/b/" },
    { date: "2026-09-01", destUrl: "https://x/c/" },
    { date: "2026-09-02", destUrl: "https://x/d/" },
  ];
  const r = assignDates(existing, [{ id: "n", destUrl: "https://x/d/" }], "2026-09-01");
  // Day 1 is full; days 2-4 are inside the 72h window of the existing /d/ pin.
  assert.equal(r[0].date, "2026-09-05");
});

test("never assigns before the start date", () => {
  const r = assignDates([], [{ id: "a", destUrl: "https://x/a/" }], "2026-09-10");
  assert.equal(r[0].date, "2026-09-10");
});

test("assigns slots 0,1,2 within a day and never a fourth", () => {
  const q = ["a", "b", "c", "d"].map((id) => ({ id, destUrl: `https://x/${id}/` }));
  const r = assignDates([], q, "2026-09-01");
  assert.deepEqual(r.map((x) => x.slot), [0, 1, 2, 0]);
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
