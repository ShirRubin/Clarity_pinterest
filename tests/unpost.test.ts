import { test } from "node:test";
import assert from "node:assert/strict";
import { planUnpost, clearPostedMarks, unpostTransition, pullLooksFailed } from "../src/unpost.js";
import { toNotionProperties } from "../src/notion.js";
import { postText, parsePostText } from "../src/packText.js";
import type { PinterestPin } from "../src/reconcile.js";
import type { PackInfo } from "../src/packs.js";

// 2026-09-10 09:00 Jerusalem = 06:00 UTC
const at = (date: string, hourLocal: number) => Date.parse(`${date}T${String(hourLocal - 3).padStart(2, "0")}:00:00Z`) / 1000;

const pack = (date: string, title: string, posted?: PackInfo["text"]["posted"]): PackInfo => ({
  where: "posted",
  dir: `${date}--${title.toLowerCase().replace(/\W+/g, "-")}--classic-checklist`,
  path: `exports/posted/${date}--x--classic-checklist`,
  date,
  slug: title.toLowerCase().replace(/\W+/g, "-"),
  template: "classic-checklist",
  text: {
    date,
    image: "classic-checklist.png",
    title,
    description: "",
    alt: "",
    board: "Travel & Festivals",
    link: "https://clarity-lists.com/posts/x",
    ...(posted ? { posted } : {}),
  },
});

const pin = (id: string, title: string, ts: number): PinterestPin => ({ id, title, ts, kind: "scheduled" });

test("a posted pack Pinterest does not have is planned for unposting", () => {
  const plan = planUnpost([], [pack("2026-09-20", "Gone")], "2026-09-18");
  assert.deepEqual(plan.map((p) => p.text.title), ["Gone"]);
});

test("a posted pack Pinterest still has is left alone", () => {
  const plan = planUnpost([pin("1", "Live", at("2026-09-20", 9))], [pack("2026-09-20", "Live")], "2026-09-18");
  assert.deepEqual(plan, []);
});

test("a pack with a recorded pin id is never unposted, even when absent from the pulled lists", () => {
  // A short page from Pinterest must never cost us a pin we know went live.
  const plan = planUnpost([], [pack("2026-09-20", "HasId", { at: "2026-09-17T00:00:00Z", pinId: "123" })], "2026-09-18");
  assert.deepEqual(plan, []);
});

test("a posted pack dated in the past is left alone — it can no longer be scheduled", () => {
  const plan = planUnpost([], [pack("2026-09-01", "Past")], "2026-09-18");
  assert.deepEqual(plan, []);
});

test("clearPostedMarks makes a csv-uploaded pack parse as pending again", () => {
  const base = postText({
    date: "2026-09-20",
    time: "09:00 AM",
    image: "classic-checklist.png",
    title: "Tea Bucket List",
    description: "d",
    alt: "a",
    board: "Travel & Festivals",
    link: "https://clarity-lists.com/posts/x",
  });
  const marked = `${base}\nEXPORTED: 2026-09-17T10:00:00Z pins.csv\n\nPOSTED: 2026-09-17T10:05:00Z csv pins.csv\n`;
  assert.ok(parsePostText(marked).posted, "fixture should start out marked posted");

  const cleared = parsePostText(clearPostedMarks(marked));

  assert.equal(cleared.posted, undefined);
  assert.equal(cleared.exported, undefined);
  assert.equal(cleared.title, "Tea Bucket List");
  assert.equal(cleared.board, "Travel & Festivals");
  assert.equal(cleared.time, "09:00 AM");
});

// --- the Notion half: reversing what `uploaded` wrote to the row ---

test("a Scheduled row that no longer has every variant on Pinterest goes back to Approved", () => {
  const patch = unpostTransition({
    stillPostedDates: { "classic-checklist": "2026-09-20" },
    allTemplates: ["classic-checklist", "bold-panel", "sticky-note", "big-numbers"],
    currentStatus: "Scheduled",
  });
  assert.equal(patch.status, "Approved");
});

test("a row whose variants are all still on Pinterest is not un-flipped", () => {
  const all = ["classic-checklist", "bold-panel"];
  const patch = unpostTransition({
    stillPostedDates: { "classic-checklist": "2026-09-20", "bold-panel": "2026-09-23" },
    allTemplates: all,
    currentStatus: "Scheduled",
  });
  assert.equal(patch.status, undefined);
});

test("a Published row is never un-flipped — its pins are already live", () => {
  const patch = unpostTransition({
    stillPostedDates: {},
    allTemplates: ["classic-checklist", "bold-panel"],
    currentStatus: "Published",
  });
  assert.equal(patch.status, undefined);
});

test("templates no longer on Pinterest are cleared from the row's date columns", () => {
  const patch = unpostTransition({
    stillPostedDates: { "classic-checklist": "2026-09-20" },
    allTemplates: ["classic-checklist", "bold-panel"],
    currentStatus: "Scheduled",
  });
  assert.deepEqual(patch.variants, { "classic-checklist": "2026-09-20", "bold-panel": null });
});

test("a null variant date clears that column in Notion rather than being skipped", () => {
  const p = toNotionProperties({ name: "x", status: "Idea", variants: { "bold-panel": null } });
  assert.deepEqual(p["bold-panel"], { date: null });
});

test("a pull that returned nothing is treated as a failed pull, not an empty scheduler", () => {
  assert.equal(pullLooksFailed(0, 0), true);
  assert.equal(pullLooksFailed(85, 0), false);
  assert.equal(pullLooksFailed(0, 57), false);
});
