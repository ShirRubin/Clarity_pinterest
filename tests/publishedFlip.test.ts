import { test } from "node:test";
import assert from "node:assert/strict";
import { publishedFlip, localToday } from "../src/publishedFlip.js";

const row = (pageId: string, status: string | undefined, scheduledDate?: string, publishedDate?: string) => ({
  pageId,
  name: `row ${pageId}`,
  status,
  scheduledDate,
  publishedDate,
});

test("a Scheduled row dated before today flips, and gets publishedDate = scheduledDate", () => {
  const out = publishedFlip([row("a", "Scheduled", "2026-09-16")], "2026-09-17");
  assert.deepEqual(out, [{ pageId: "a", publishedDate: "2026-09-16" }]);
});

test("date boundary: a row dated today does NOT flip (its pins go live later today)", () => {
  assert.deepEqual(publishedFlip([row("a", "Scheduled", "2026-09-17")], "2026-09-17"), []);
});

test("a row dated after today does not flip", () => {
  assert.deepEqual(publishedFlip([row("a", "Scheduled", "2026-09-18")], "2026-09-17"), []);
});

test("only Scheduled rows are considered — Approved and Published rows are ignored", () => {
  const rows = [row("a", "Approved", "2026-09-01"), row("b", "Published", "2026-09-01"), row("c", undefined, "2026-09-01")];
  assert.deepEqual(publishedFlip(rows, "2026-09-17"), []);
});

test("a Scheduled row with no scheduledDate is skipped, never flipped blind", () => {
  assert.deepEqual(publishedFlip([row("a", "Scheduled")], "2026-09-17"), []);
});

test("an existing publishedDate is kept, not overwritten", () => {
  const out = publishedFlip([row("a", "Scheduled", "2026-09-10", "2026-09-12")], "2026-09-17");
  assert.deepEqual(out, [{ pageId: "a", publishedDate: "2026-09-12" }]);
});

test("output keeps input order and covers every qualifying row", () => {
  const rows = [row("a", "Scheduled", "2026-09-01"), row("b", "Scheduled", "2026-09-30"), row("c", "Scheduled", "2026-09-02")];
  assert.deepEqual(
    publishedFlip(rows, "2026-09-17").map((d) => d.pageId),
    ["a", "c"],
  );
});

test("variant columns win over Scheduled date: flips once the earliest variant has passed", () => {
  const r = { ...row("a", "Scheduled", "2026-09-30"), variants: { "classic-checklist": "2026-09-16", "bold-panel": "2026-09-25" } };
  assert.deepEqual(publishedFlip([r], "2026-09-17"), [{ pageId: "a", publishedDate: "2026-09-16" }]);
});

test("variant columns win over Scheduled date: no flip while every variant is still ahead", () => {
  const r = { ...row("a", "Scheduled", "2026-09-01"), variants: { "classic-checklist": "2026-09-18" } };
  assert.deepEqual(publishedFlip([r], "2026-09-17"), []);
});

test("a row with empty variant columns falls back to the Scheduled date", () => {
  const r = { ...row("a", "Scheduled", "2026-09-16"), variants: {} };
  assert.deepEqual(publishedFlip([r], "2026-09-17"), [{ pageId: "a", publishedDate: "2026-09-16" }]);
});

test("localToday: the calendar date in the posting zone, not UTC", () => {
  // 2026-09-16T23:30:00Z is already 2026-09-17 02:30 in Asia/Jerusalem (UTC+3 in September).
  assert.equal(localToday(new Date("2026-09-16T23:30:00Z"), "Asia/Jerusalem"), "2026-09-17");
  // and 2026-09-16T20:00:00Z is still the 16th there.
  assert.equal(localToday(new Date("2026-09-16T20:00:00Z"), "Asia/Jerusalem"), "2026-09-16");
});
