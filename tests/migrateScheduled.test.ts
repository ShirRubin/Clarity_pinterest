import { test } from "node:test";
import assert from "node:assert/strict";
import { migrationDecisions } from "../src/migrateScheduled.js";
import type { PackInfo } from "../src/packs.js";

const pack = (date: string, slug: string, template: string, pageId?: string, where: "posted" | "packs" = "posted"): PackInfo => ({
  where,
  dir: `${date}--${slug}--${template}`,
  path: `exports/${where}/${date}--${slug}--${template}`,
  date,
  slug,
  template,
  text: { date, image: `${template}.png`, title: "t", description: "", alt: "", board: "b", link: "l", ...(pageId ? { pageId } : {}) },
});
const row = (pageId: string, name: string, status: string, scheduledDate?: string, publishedDate?: string) => ({
  pageId,
  name,
  status,
  scheduledDate,
  publishedDate,
  source: "pipeline" as const,
});

test("Published, all 4 variants posted, earliest 2026-09-18, today 2026-09-16 → Scheduled", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  const posted = [
    pack("2026-09-18", "tea-bucket-list", "bold-panel", "p1"),
    pack("2026-09-20", "tea-bucket-list", "classic-checklist", "p1"),
    pack("2026-09-22", "tea-bucket-list", "sticky-note", "p1"),
    pack("2026-09-19", "tea-bucket-list", "big-numbers", "p1"),
  ];
  const out = migrationDecisions(rows, posted, [], "2026-09-16");
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { pageId: "p1", name: "Tea Bucket List", from: "Published", status: "Scheduled", scheduledDate: "2026-09-18", posted: 4, total: 4 });
});

test("Published, 1 posted (2026-09-17) + 3 pending, today 2026-09-16 → Approved", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  const posted = [pack("2026-09-17", "tea-bucket-list", "bold-panel", "p1")];
  const pending = [
    pack("2026-09-20", "tea-bucket-list", "classic-checklist", "p1", "packs"),
    pack("2026-09-21", "tea-bucket-list", "sticky-note", "p1", "packs"),
    pack("2026-09-23", "tea-bucket-list", "big-numbers", "p1", "packs"),
  ];
  const out = migrationDecisions(rows, posted, pending, "2026-09-16");
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { pageId: "p1", name: "Tea Bucket List", from: "Published", status: "Approved", scheduledDate: "2026-09-17", posted: 1, total: 4 });
});

test("Published, earliest posted 2026-09-01 + pending 2026-09-25, row.scheduledDate 2026-09-01 → no decision", () => {
  const rows = [row("p1", "Tea Bucket List", "Published", "2026-09-01")];
  const posted = [pack("2026-09-01", "tea-bucket-list", "bold-panel", "p1")];
  const pending = [pack("2026-09-25", "tea-bucket-list", "classic-checklist", "p1", "packs")];
  const out = migrationDecisions(rows, posted, pending, "2026-09-16");
  assert.equal(out.length, 0);
});

test("Published, earliest posted 2026-09-01, row.scheduledDate 2026-08-28 (stale) → corrected date", () => {
  const rows = [row("p1", "Tea Bucket List", "Published", "2026-08-28")];
  const posted = [pack("2026-09-01", "tea-bucket-list", "bold-panel", "p1")];
  const out = migrationDecisions(rows, posted, [], "2026-09-16");
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "Published");
  assert.equal(out[0].scheduledDate, "2026-09-01");
  assert.equal(out[0].publishedDate, "2026-09-01");
});

test("Scheduled row, all 4 posted, earliest 2026-09-20, row.scheduledDate 2026-09-14 (stale) → corrected date", () => {
  const rows = [row("p1", "Tea Bucket List", "Scheduled", "2026-09-14")];
  const posted = [
    pack("2026-09-20", "tea-bucket-list", "bold-panel", "p1"),
    pack("2026-09-21", "tea-bucket-list", "classic-checklist", "p1"),
    pack("2026-09-22", "tea-bucket-list", "sticky-note", "p1"),
    pack("2026-09-23", "tea-bucket-list", "big-numbers", "p1"),
  ];
  const out = migrationDecisions(rows, posted, [], "2026-09-16");
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "Scheduled");
  assert.equal(out[0].scheduledDate, "2026-09-20");
});

test("Approved row, all 4 posted, earliest 2026-09-20 → Scheduled", () => {
  const rows = [row("p1", "Tea Bucket List", "Approved")];
  const posted = [
    pack("2026-09-20", "tea-bucket-list", "bold-panel", "p1"),
    pack("2026-09-21", "tea-bucket-list", "classic-checklist", "p1"),
    pack("2026-09-22", "tea-bucket-list", "sticky-note", "p1"),
    pack("2026-09-23", "tea-bucket-list", "big-numbers", "p1"),
  ];
  const out = migrationDecisions(rows, posted, [], "2026-09-16");
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "Scheduled");
});

test("Earliest posted pack dated today → Scheduled (not live yet)", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  const posted = [
    pack("2026-09-16", "tea-bucket-list", "bold-panel", "p1"),
    pack("2026-09-17", "tea-bucket-list", "classic-checklist", "p1"),
    pack("2026-09-18", "tea-bucket-list", "sticky-note", "p1"),
    pack("2026-09-19", "tea-bucket-list", "big-numbers", "p1"),
  ];
  const out = migrationDecisions(rows, posted, [], "2026-09-16");
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "Scheduled");
});

test("Rows in other statuses are ignored even with packs", () => {
  const rows = [
    row("p1", "No packs", "Published"),
    row("p2", "Rejected row", "Rejected"),
    row("p3", "In Review row", "In Review"),
  ];
  // Rejected row has a future posted pack (would produce decision if status allowed), In Review has pending
  const posted = [pack("2026-09-25", "rejected-row", "bold-panel", "p2")];
  const pending = [pack("2026-09-20", "in-review-row", "sticky-note", "p3", "packs")];
  const out = migrationDecisions(rows, posted, pending, "2026-09-16");
  // Status guard filters out Rejected and In Review; p1 skipped due to no packs
  assert.equal(out.length, 0);
});

test("Pending-only pack without PAGE id matches by slug → decision", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  const pending = [pack("2026-09-20", "tea-bucket-list", "bold-panel", undefined, "packs")];
  const out = migrationDecisions(rows, [], pending, "2026-09-16");
  // Slug match must succeed; if it fails, row has no packs and is skipped (test would fail)
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    pageId: "p1",
    name: "Tea Bucket List",
    from: "Published",
    status: "Approved",
    scheduledDate: "2026-09-20",
    posted: 0,
    total: 1,
  });
});

test("Published decision fills publishedDate from earliest posted pack when missing, but keeps an existing publishedDate unchanged", () => {
  // Scheduled row, no publishedDate on file, earliest posted 2026-09-01, today 2026-09-17 → Published, publishedDate filled in
  const rowsA = [row("p1", "Tea Bucket List", "Scheduled")];
  const postedA = [pack("2026-09-01", "tea-bucket-list", "bold-panel", "p1")];
  const outA = migrationDecisions(rowsA, postedA, [], "2026-09-17");
  assert.equal(outA.length, 1);
  assert.deepEqual(outA[0], {
    pageId: "p1",
    name: "Tea Bucket List",
    from: "Scheduled",
    status: "Published",
    scheduledDate: "2026-09-01",
    publishedDate: "2026-09-01",
    posted: 1,
    total: 1,
  });

  // Scheduled row that already carries a publishedDate must keep it, not overwrite with earliestPosted
  const rowsB = [row("p2", "Coffee Bucket List", "Scheduled", undefined, "2026-08-20")];
  const postedB = [pack("2026-09-01", "coffee-bucket-list", "bold-panel", "p2")];
  const outB = migrationDecisions(rowsB, postedB, [], "2026-09-17");
  assert.equal(outB.length, 1);
  assert.equal(outB[0].status, "Published");
  assert.equal(outB[0].publishedDate, "2026-08-20");
});
