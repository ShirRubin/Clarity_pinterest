import { test } from "node:test";
import assert from "node:assert/strict";
import { migrationDecisions } from "../src/migrateScheduled.js";
import type { PackInfo } from "../src/packs.js";

const pack = (date: string, slug: string, template: string, pageId?: string): PackInfo => ({
  where: "posted",
  dir: `${date}--${slug}--${template}`,
  path: `exports/posted/${date}--${slug}--${template}`,
  date,
  slug,
  template,
  text: { date, image: `${template}.png`, title: "t", description: "", alt: "", board: "b", link: "l", ...(pageId ? { pageId } : {}) },
});
const row = (pageId: string, name: string, status: string, scheduledDate?: string) => ({ pageId, name, status, scheduledDate, source: "pipeline" as const });

test("Published row whose earliest posted pack is in the future → Scheduled, scheduledDate = earliest pack date", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  const packs = [pack("2026-09-20", "tea-bucket-list", "bold-panel", "p1"), pack("2026-09-18", "tea-bucket-list", "classic-checklist", "p1")];
  assert.deepEqual(migrationDecisions(rows, packs, "2026-09-16"), [
    { pageId: "p1", name: "Tea Bucket List", status: "Scheduled", scheduledDate: "2026-09-18" },
  ]);
});

test("earliest pack dated today counts as not yet live → Scheduled", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  assert.equal(migrationDecisions(rows, [pack("2026-09-16", "tea-bucket-list", "bold-panel", "p1")], "2026-09-16").length, 1);
});

test("Published row whose earliest posted pack is in the past stays Published", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  const packs = [pack("2026-09-01", "tea-bucket-list", "bold-panel", "p1"), pack("2026-09-25", "tea-bucket-list", "classic-checklist", "p1")];
  assert.deepEqual(migrationDecisions(rows, packs, "2026-09-16"), []);
});

test("rows with no posted pack are left alone; non-Published rows are ignored", () => {
  const rows = [row("p1", "No packs", "Published"), row("p2", "Already", "Scheduled"), row("p3", "Approved one", "Approved")];
  const packs = [pack("2026-09-30", "already", "bold-panel", "p2"), pack("2026-09-30", "approved-one", "bold-panel", "p3")];
  assert.deepEqual(migrationDecisions(rows, packs, "2026-09-16"), []);
});

test("an existing scheduledDate on the row is kept", () => {
  const rows = [row("p1", "Tea Bucket List", "Published", "2026-09-19")];
  const out = migrationDecisions(rows, [pack("2026-09-20", "tea-bucket-list", "bold-panel", "p1")], "2026-09-16");
  assert.equal(out[0].scheduledDate, "2026-09-19");
});

test("packs without a PAGE id match by slug (pre-milestone-1 packs)", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  const out = migrationDecisions(rows, [pack("2026-09-20", "tea-bucket-list", "bold-panel")], "2026-09-16");
  assert.deepEqual(out.map((d) => d.pageId), ["p1"]);
});
