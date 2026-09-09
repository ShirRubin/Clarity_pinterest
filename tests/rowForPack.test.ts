import { test } from "node:test";
import assert from "node:assert/strict";
import { rowForPack } from "../src/rowForPack.js";

const row = (pageId: string, name: string, source?: string) => ({ pageId, name, source });

test("a PAGE id on the pack wins over any slug match", () => {
  const rows = [row("p1", "Totally Different Name"), row("p2", "The Tea Bucket List")];
  const pack = { text: { pageId: "p1" }, slug: "the-tea-bucket-list" };
  assert.equal(rowForPack(pack, rows)?.pageId, "p1");
});

test("falls back to matching the slug against non-backfill rows when there's no PAGE id", () => {
  const rows = [row("p1", "The Tea Bucket List")];
  const pack = { text: {}, slug: "the-tea-bucket-list" };
  assert.equal(rowForPack(pack, rows)?.pageId, "p1");
});

test("a backfill row is never matched by slug", () => {
  const rows = [row("p1", "The Tea Bucket List", "backfill")];
  const pack = { text: {}, slug: "the-tea-bucket-list" };
  assert.equal(rowForPack(pack, rows), undefined);
});

test("no PAGE id and no slug match returns undefined", () => {
  const rows = [row("p1", "Something Else")];
  const pack = { text: {}, slug: "the-tea-bucket-list" };
  assert.equal(rowForPack(pack, rows), undefined);
});
