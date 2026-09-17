import { test } from "node:test";
import assert from "node:assert/strict";
import { pageToSummary, imageUrlsOf, type NotionPage } from "../src/notionPage.js";

const rt = (s: string) => [{ plain_text: s }];
const page: NotionPage = {
  id: "3d337600-24be-8127-8084-ffaa92f54ecd",
  properties: {
    Name: { title: rt("The Tea Bucket List: 12 Brews") },
    Status: { select: { name: "In Review" } },
    Board: { select: { name: "Books · Learning & Culture" } },
    Theme: { select: { name: "Books & Learning" } },
    Source: { select: { name: "pipeline" } },
    "Pin title": { rich_text: rt("Tea Bucket List: 12 Brews") },
    "Pin description": { rich_text: [{ plain_text: "Part one. " }, { plain_text: "Part two." }] },
    "Alt text": { rich_text: rt("Checklist graphic") },
    "List items": { rich_text: rt("1. **Matcha** — whisk it") },
    Notes: { rich_text: rt("review 2026-09-01: ok") },
    "Pin URL": { url: null },
    "Scheduled date": { date: { start: "2026-09-12" } },
    Impressions: { number: 0 },
    "Pin image": { files: [{ file: { url: "https://s3/a.png?sig=1" } }, { external: { url: "https://x/b.png" } }] },
  },
};

test("maps every field the pipeline reads, joining rich-text chunks", () => {
  const s = pageToSummary(page);
  assert.equal(s.pageId, page.id);
  assert.equal(s.name, "The Tea Bucket List: 12 Brews");
  assert.equal(s.status, "In Review");
  assert.equal(s.board, "Books · Learning & Culture");
  assert.equal(s.pinTitle, "Tea Bucket List: 12 Brews");
  assert.equal(s.pinDescription, "Part one. Part two.");
  assert.equal(s.altText, "Checklist graphic");
  assert.equal(s.listItems, "1. **Matcha** — whisk it");
  assert.equal(s.notes, "review 2026-09-01: ok");
  assert.equal(s.pinUrl, undefined);
  assert.equal(s.scheduledDate, "2026-09-12");
  assert.equal(s.impressions, 0); // 0 is meaningful, must not become undefined
  assert.deepEqual(s.imageUrls, ["https://s3/a.png?sig=1", "https://x/b.png"]);
});

test("missing properties map to undefined / empty, never throw", () => {
  const s = pageToSummary({ id: "x", properties: { Name: { title: rt("n") } } });
  assert.equal(s.name, "n");
  assert.equal(s.board, undefined);
  assert.equal(s.pinTitle, "");
  assert.deepEqual(s.imageUrls, []);
});

test("imageUrlsOf prefers Notion-hosted file URLs and skips empty entries", () => {
  assert.deepEqual(imageUrlsOf(page), ["https://s3/a.png?sig=1", "https://x/b.png"]);
  assert.deepEqual(imageUrlsOf({ id: "y", properties: { "Pin image": { files: [{}] } } }), []);
});

test("Keywords multi-select maps to a string list, absent → undefined", () => {
  const withKw: NotionPage = {
    id: "k",
    properties: { Name: { title: rt("n") }, Keywords: { multi_select: [{ name: "tea" }, { name: "cozy living" }] } },
  };
  assert.deepEqual(pageToSummary(withKw).keywords, ["tea", "cozy living"]);
  assert.equal(pageToSummary({ id: "x", properties: { Name: { title: rt("n") } } }).keywords, undefined);
});
