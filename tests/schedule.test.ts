import { test } from "node:test";
import assert from "node:assert/strict";
import { assignDates } from "../src/schedule.js";

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
