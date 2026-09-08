import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, formatReconcile, type PinterestPin } from "../src/reconcile.js";
import type { PackInfo } from "../src/packs.js";

// 2026-09-10 09:00 Jerusalem = 06:00 UTC
const at = (date: string, hourLocal: number) => Date.parse(`${date}T${String(hourLocal - 3).padStart(2, "0")}:00:00Z`) / 1000;

const pack = (where: "packs" | "posted", date: string, title: string, template = "classic-checklist"): PackInfo => ({
  where,
  dir: `${date}--${title.toLowerCase().replace(/\W+/g, "-")}--${template}`,
  path: `exports/${where}/x`,
  date,
  slug: title.toLowerCase().replace(/\W+/g, "-"),
  template,
  text: { date, image: `${template}.png`, title, description: "", alt: "", board: "Travel & Festivals", link: "https://clarity-lists.com/posts/x" },
});

const pin = (id: string, title: string, ts: number, kind: PinterestPin["kind"] = "scheduled"): PinterestPin => ({ id, title, ts, kind });

test("a pending pack whose title+date already exists on Pinterest is 'already live'", () => {
  const r = reconcile([pin("1", "Tea Bucket List", at("2026-09-10", 9))], [pack("packs", "2026-09-10", "Tea Bucket List")], [], "2026-09-08");
  assert.equal(r.alreadyLive.length, 1);
  assert.equal(r.alreadyLive[0].pin.id, "1");
  assert.deepEqual(r.missing, []);
});

test("a pin scheduled at 12:00 local is flagged as a noon duplicate", () => {
  const r = reconcile([pin("1", "A", at("2026-09-10", 9)), pin("2", "A", at("2026-09-10", 12))], [], [], "2026-09-08");
  assert.deepEqual(r.noon.map((p) => p.id), ["2"]);
  assert.deepEqual(r.sameDay, [{ date: "2026-09-10", title: "A", ids: ["1", "2"] }]);
});

test("a posted pack dated today or later with no pin on Pinterest is missing; past ones are not", () => {
  const r = reconcile([], [], [pack("posted", "2026-09-06", "Old"), pack("posted", "2026-09-09", "Gone")], "2026-09-08");
  assert.deepEqual(r.missing.map((p) => p.text.title), ["Gone"]);
});

test("a pending pack is never 'missing' — it has not been posted yet", () => {
  const r = reconcile([], [pack("packs", "2026-09-09", "Soon")], [], "2026-09-08");
  assert.deepEqual(r.missing, []);
});

test("matching ignores case and surrounding whitespace", () => {
  const r = reconcile([pin("1", "  tea bucket list ", at("2026-09-10", 13))], [], [pack("posted", "2026-09-10", "Tea Bucket List")], "2026-09-08");
  assert.deepEqual(r.missing, []);
});

test("formatReconcile names every problem with the URL to act on", () => {
  const r = reconcile(
    [pin("7", "A", at("2026-09-10", 12))],
    [pack("packs", "2026-09-10", "A")],
    [pack("posted", "2026-09-11", "B")],
    "2026-09-08",
  );
  const s = formatReconcile(r);
  assert.match(s, /already on Pinterest/);
  assert.match(s, /12:00 PM duplicate.*\/ClarityBucketLists\/scheduled-pin\/7\//);
  assert.match(s, /missing.*B/);
});

test("a clean state prints a clean line", () => {
  assert.match(formatReconcile(reconcile([], [], [], "2026-09-08")), /nothing to fix/);
});
