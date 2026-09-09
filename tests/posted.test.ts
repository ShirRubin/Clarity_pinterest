import { test } from "node:test";
import assert from "node:assert/strict";
import { postedTransition, postedDerivation, applyStatusGuard, pinUrl } from "../src/posted.js";
import type { PackInfo } from "../src/packs.js";

const packAt = (date: string, template: string, pinId?: string): PackInfo => ({
  where: "posted",
  dir: `${date}--x--${template}`,
  path: `exports/posted/${date}--x--${template}`,
  date,
  slug: "x",
  template,
  text: {
    date,
    image: `${template}.png`,
    title: "t",
    description: "",
    alt: "",
    board: "b",
    link: "l",
    ...(pinId ? { posted: { at: "2026-09-08T00:00:00.000Z", pinId } } : {}),
  },
});

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

test("an existing pin id/URL on the row is kept over the derived first-pack pin", () => {
  const p = postedTransition({
    postedTemplates: ["a", "b", "c", "d"],
    totalTemplates: 4,
    firstPinId: "111",
    earliestPackDate: "2026-09-10",
    existingPinUrl: "https://www.pinterest.com/pin/999/",
    existingPinId: "999",
  });
  assert.deepEqual(p, {
    status: "Scheduled",
    pinUrl: "https://www.pinterest.com/pin/999/",
    pinterestPinId: "999",
    scheduledDate: "2026-09-10",
  });
});

test("only an existing Pin URL (no id on the row) is kept, and the id is parsed from it", () => {
  const p = postedTransition({
    postedTemplates: ["a", "b", "c", "d"],
    totalTemplates: 4,
    firstPinId: "111",
    earliestPackDate: "2026-09-10",
    existingPinUrl: "https://www.pinterest.com/pin/777/",
  });
  assert.deepEqual(p, {
    status: "Scheduled",
    pinUrl: "https://www.pinterest.com/pin/777/",
    pinterestPinId: "777",
    scheduledDate: "2026-09-10",
  });
});

test("only an existing pin id (no URL on the row) is kept, and the URL is derived from it", () => {
  const p = postedTransition({
    postedTemplates: ["a", "b", "c", "d"],
    totalTemplates: 4,
    firstPinId: "111",
    earliestPackDate: "2026-09-10",
    existingPinId: "555",
  });
  assert.deepEqual(p, {
    status: "Scheduled",
    pinUrl: "https://www.pinterest.com/pin/555/",
    pinterestPinId: "555",
    scheduledDate: "2026-09-10",
  });
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

// --- postedDerivation ---------------------------------------------------------

test("postedDerivation picks the earliest-dated known pin id among posted packs", () => {
  const d = postedDerivation([packAt("2026-09-09", "a", "20"), packAt("2026-09-08", "b", "10")], []);
  assert.equal(d.firstPinId, "10");
  assert.equal(d.earliestPackDate, "2026-09-08");
});

test("posted packs without a POSTED marker are ignored when picking the first pin id", () => {
  const d = postedDerivation([packAt("2026-09-08", "a"), packAt("2026-09-09", "b", "30")], []);
  assert.equal(d.firstPinId, "30");
});

test("the earliest date considers still-pending packs too", () => {
  const d = postedDerivation([packAt("2026-09-10", "a", "1")], [packAt("2026-09-08", "b")]);
  assert.equal(d.earliestPackDate, "2026-09-08");
});

test("no known pin id anywhere yields undefined, not a crash", () => {
  const d = postedDerivation([packAt("2026-09-08", "a")], []);
  assert.equal(d.firstPinId, undefined);
});

// --- applyStatusGuard ----------------------------------------------------------

test("applyStatusGuard withholds the status flip when the row isn't Approved or Scheduled", () => {
  const patch = { status: "Scheduled" as const, pinUrl: "u", pinterestPinId: "1", scheduledDate: "2026-09-08" };
  assert.deepEqual(applyStatusGuard(patch, "Rejected"), { pinUrl: "u", pinterestPinId: "1", scheduledDate: "2026-09-08" });
});

test("applyStatusGuard keeps the status flip when the row is Approved", () => {
  const patch = { status: "Scheduled" as const, pinUrl: "u" };
  assert.deepEqual(applyStatusGuard(patch, "Approved"), patch);
});

test("applyStatusGuard keeps the status flip when the row is already Scheduled", () => {
  const patch = { status: "Scheduled" as const };
  assert.deepEqual(applyStatusGuard(patch, "Scheduled"), patch);
});

test("a patch with no status change passes through untouched regardless of row status", () => {
  assert.deepEqual(applyStatusGuard({}, "Rejected"), {});
});
