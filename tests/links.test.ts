import { test } from "node:test";
import assert from "node:assert/strict";
import { auditLinks } from "../src/links.js";
import type { ApiPin } from "../src/report.js";

const pin = (id: string, link: string | null, parentPinId: string | null = null): ApiPin => ({
  id,
  createdAt: "2026-09-01T06:00:00",
  title: `Pin ${id}`,
  link,
  parentPinId,
  metrics: { impression: 0, save: 0, pinClick: 0, outboundClick: 0 },
});

const SLUGS = new Set(["tea-bucket-list", "mother-daughter-bucket-list"]);

test("a link to an existing blog post is fine, with or without www, trailing slash or UTM tags", () => {
  const r = auditLinks(
    [
      pin("1", "https://clarity-lists.com/posts/tea-bucket-list"),
      pin("2", "https://www.clarity-lists.com/posts/tea-bucket-list/"),
      pin("3", "https://clarity-lists.com/posts/mother-daughter-bucket-list?utm_source=pinterest"),
    ],
    SLUGS,
  );
  assert.equal(r.ok, 3);
  assert.deepEqual([...r.noLink, ...r.offSite, ...r.deadPost, ...r.notAPost], []);
});

test("a post slug the blog does not have is a dead link", () => {
  const r = auditLinks([pin("1", "https://clarity-lists.com/posts/gone-bucket-list")], SLUGS);
  assert.deepEqual(r.deadPost.map((p) => p.id), ["1"]);
});

test("links elsewhere on the site, off the site, and missing links are each reported", () => {
  const r = auditLinks(
    [
      pin("home", "https://clarity-lists.com/"),
      pin("board", "https://www.pinterest.com/ClarityBucketLists/travel/"),
      pin("none", null),
      pin("empty", ""),
    ],
    SLUGS,
  );
  assert.deepEqual(r.notAPost.map((p) => p.id), ["home"]);
  assert.deepEqual(r.offSite.map((p) => p.id), ["board"]);
  assert.deepEqual(r.noLink.map((p) => p.id), ["none", "empty"]);
});

test("a repin of one of our own pins is skipped — it has no link of its own to fix", () => {
  const r = auditLinks(
    [pin("orig", "https://clarity-lists.com/posts/tea-bucket-list"), pin("copy", null, "orig")],
    SLUGS,
  );
  assert.equal(r.repins, 1);
  assert.equal(r.ok, 1);
  assert.deepEqual(r.noLink, []);
});

test("a malformed link counts as off-site rather than crashing the audit", () => {
  const r = auditLinks([pin("1", "not a url")], SLUGS);
  assert.deepEqual(r.offSite.map((p) => p.id), ["1"]);
});
