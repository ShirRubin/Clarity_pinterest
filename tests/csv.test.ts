import { test } from "node:test";
import assert from "node:assert/strict";
import { toUtcStamp, mediaUrl, buildCsv, CSV_HEADER } from "../src/csv.js";
import type { PlanEntry } from "../src/postplan.js";

const entry = (over: Partial<PlanEntry> = {}): PlanEntry => ({
  n: 1,
  total: 1,
  pack: "2026-09-17--the-tea-bucket-list--sticky-note",
  date: "2026-09-17",
  time: "09:00 AM",
  image: "exports/packs/2026-09-17--the-tea-bucket-list--sticky-note/sticky-note.png",
  board: "Travel & Festivals",
  link: "https://clarity-lists.com/posts/the-tea-bucket-list",
  title: "Tea Bucket List: 12 Brews",
  description: "Line one.\n#tea #bucketlist",
  alt: "a",
  topics: ["tea", "cozy living"],
  ...over,
});

test("toUtcStamp converts a Jerusalem slot to UTC during summer time", () => {
  assert.equal(toUtcStamp("2026-09-17", "09:00 AM"), "2026-09-17T06:00:00");
});

test("toUtcStamp converts a Jerusalem slot to UTC during winter time", () => {
  assert.equal(toUtcStamp("2026-11-01", "06:00 PM"), "2026-11-01T16:00:00");
});

test("mediaUrl points at the blog's public pin image", () => {
  assert.equal(
    mediaUrl("the-tea-bucket-list", "sticky-note"),
    "https://clarity-lists.com/pins/the-tea-bucket-list/sticky-note.png",
  );
});

test("buildCsv writes Pinterest's header and one row per entry", () => {
  const csv = buildCsv([entry()], () => ["tea", "cozy living"]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], CSV_HEADER);
  assert.equal(
    lines[1],
    [
      "Tea Bucket List: 12 Brews",
      "https://clarity-lists.com/pins/the-tea-bucket-list/sticky-note.png",
      "Travel & Festivals",
      "",
      "Line one. #tea #bucketlist",
      "https://clarity-lists.com/posts/the-tea-bucket-list",
      "2026-09-17T06:00:00",
      '"tea, cozy living"',
    ].join(","),
  );
});

test("buildCsv quotes fields with commas or quotes", () => {
  const csv = buildCsv(
    [entry({ board: "Books, Learning & Culture", title: 'The "Cozy" List' })],
    () => [],
  );
  const row = csv.split("\r\n")[1];
  assert.ok(row.startsWith('"The ""Cozy"" List",'));
  assert.ok(row.includes(',"Books, Learning & Culture",'));
});

test("buildCsv refuses a board Pinterest does not already have", () => {
  assert.throws(
    () => buildCsv([entry({ board: "Travel and Festivals" })], () => []),
    /Travel and Festivals/,
  );
});

test("buildCsv refuses a title over 100 or a description over 500 characters", () => {
  assert.throws(() => buildCsv([entry({ title: "x".repeat(101) })], () => []), /title/);
  assert.throws(() => buildCsv([entry({ description: "x".repeat(501) })], () => []), /description/);
});

test("buildCsv reports every problem in the batch, not just the first", () => {
  assert.throws(
    () => buildCsv([entry({ board: "Nope" }), entry({ pack: "2026-09-18--the-tea-bucket-list--bold-panel", title: "x".repeat(101) })], () => []),
    (err: Error) => /Nope/.test(err.message) && /title/.test(err.message),
  );
});
