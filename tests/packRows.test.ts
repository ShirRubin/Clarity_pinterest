import { test } from "node:test";
import assert from "node:assert/strict";
import { packCandidate, needsCopy, unpackedTemplates } from "../src/packRows.js";

const row = (o: Partial<{ source: string; status: string; listItems: string; pinTitle: string; altText: string; variants: Record<string, string> }>) => ({
  name: "The Tea Bucket List",
  source: "pipeline",
  status: "Approved",
  listItems: "1. **A** — b",
  pinTitle: "Tea Bucket List: 12 Brews",
  altText: "Pastel checklist graphic titled Tea Bucket List listing 12 brews to try",
  variants: {},
  ...o,
});

// --- packCandidate -----------------------------------------------------------

test("an approved pipeline row with copy is packable", () => {
  assert.equal(packCandidate(row({})), true);
});

test("scheduled and live rows are packable — their missing variants are fresh pins", () => {
  for (const status of ["Scheduled", "Published"]) assert.equal(packCandidate(row({ status })), true, status);
});

test("a backfill row is packable once it has items and pin copy", () => {
  assert.equal(packCandidate(row({ source: "backfill", status: "Published" })), true);
  assert.equal(packCandidate(row({ source: "backfill", status: "Published", pinTitle: "" })), false);
});

test("rows before approval, or rejected, are never packed", () => {
  for (const status of ["Idea", "Drafted", "Designed", "In Review", "Needs changes", "Rejected", "Archived"]) {
    assert.equal(packCandidate(row({ status })), false, status);
  }
});

test("no pin copy means no pack, whatever the status", () => {
  assert.equal(packCandidate(row({ pinTitle: "" })), false);
});

// --- unpackedTemplates -------------------------------------------------------

test("a variant counts as packed when a pack exists on disk OR the row's column carries a date", () => {
  const onDisk = new Set(["the-tea-bucket-list--classic-checklist"]);
  const r = row({ variants: { "bold-panel": "2026-09-01" } });
  assert.deepEqual(unpackedTemplates(r, onDisk), ["sticky-note", "big-numbers"]);
});

test("a fully packed row has nothing left", () => {
  const onDisk = new Set(["the-tea-bucket-list--classic-checklist", "the-tea-bucket-list--bold-panel", "the-tea-bucket-list--sticky-note", "the-tea-bucket-list--big-numbers"]);
  assert.deepEqual(unpackedTemplates(row({}), onDisk), []);
});

// --- needsCopy ---------------------------------------------------------------

test("a row with a list but no pin title needs copy", () => {
  assert.equal(needsCopy(row({ pinTitle: "" })), true);
});

test("a row with 2025-era copy and no alt text needs copy too — fresh pin, fresh copy", () => {
  assert.equal(needsCopy(row({ altText: "" })), true);
});

test("rows with copy, without a list, or rejected/archived do not", () => {
  assert.equal(needsCopy(row({})), false);
  assert.equal(needsCopy(row({ pinTitle: "", listItems: "" })), false);
  assert.equal(needsCopy(row({ pinTitle: "", status: "Rejected" })), false);
  assert.equal(needsCopy(row({ pinTitle: "", status: "Archived" })), false);
});
