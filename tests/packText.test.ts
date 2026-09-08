// tests/packText.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { postText, parsePostText } from "../src/packText.js";
import { splitPackName } from "../src/packs.js";

const sample = {
  date: "2026-09-08",
  time: "09:00 AM",
  pageId: "26b23760-024b-81e5-938d-e19a4e93f97c",
  image: "classic-checklist.png",
  title: "Handmade Gift Bucket List: 12 Presents to Start Making",
  description: "Line one.\nLine two with #hashtag",
  alt: "Checklist graphic titled Handmade Gift",
  board: "Books · Learning & Culture",
  link: "https://clarity-lists.com/posts/the-handmade-gift-bucket-list",
};

test("postText → parsePostText round-trips every field", () => {
  assert.deepEqual(parsePostText(postText(sample)), sample);
});

test("parses a pre-milestone pack (no POST AT, no PAGE)", () => {
  const legacy = [
    `POST ON: 2026-08-27   (native scheduler: toggle "Publish at a later date")`,
    ``,
    `IMAGE: classic-checklist.png`,
    ``,
    `TITLE (paste as pin title):`,
    `Bridgerton Bucket List: 20 Ways to Live Your Diamond Era`,
    ``,
    `DESCRIPTION (paste as pin description):`,
    `Your Bridgerton era ✨`,
    `#bucketlist #regencycore`,
    ``,
    `ALT TEXT (paste into the pin's alt-text field):`,
    `Pastel checklist graphic`,
    ``,
    `BOARD: TV & Movie Bucket Lists`,
    `DESTINATION LINK: https://clarity-lists.com/posts/the-bridgerton-bucket-list`,
    ``,
    `TAGGED TOPICS: always add 10 (the max) in the pin builder. The taxonomy has no`,
    `"bucket list"/"self care" topics — search concrete nouns from the list items`,
    ``,
    `After posting: paste the live pin's URL into the row's "Pin URL" in Notion.`,
  ].join("\n");
  const p = parsePostText(legacy);
  assert.equal(p.date, "2026-08-27");
  assert.equal(p.time, undefined);
  assert.equal(p.pageId, undefined);
  assert.equal(p.title, "Bridgerton Bucket List: 20 Ways to Live Your Diamond Era");
  assert.equal(p.description, "Your Bridgerton era ✨\n#bucketlist #regencycore");
  assert.equal(p.alt, "Pastel checklist graphic");
  assert.equal(p.board, "TV & Movie Bucket Lists");
  assert.equal(p.link, "https://clarity-lists.com/posts/the-bridgerton-bucket-list");
});

test("reads a POSTED line appended by clarity posted", () => {
  const txt = postText(sample) + `\nPOSTED: 2026-09-08T10:12:00.000Z pin 3826344098274829184\n`;
  assert.deepEqual(parsePostText(txt).posted, { at: "2026-09-08T10:12:00.000Z", pinId: "3826344098274829184" });
});

test("splitPackName reads date, slug and template; rejects legacy two-part names", () => {
  assert.deepEqual(
    splitPackName("2026-09-08--the-handmade-gift-bucket-list-12-presents--classic-checklist"),
    { date: "2026-09-08", slug: "the-handmade-gift-bucket-list-12-presents", template: "classic-checklist" },
  );
  assert.equal(splitPackName("2026-08-01--old-style-pack"), undefined);
  assert.equal(splitPackName("not-a-pack"), undefined);
});

test("round-trips multi-paragraph description with embedded blank line", () => {
  const multiPara = {
    date: "2026-09-08",
    time: "09:00 AM",
    pageId: "26b23760-024b-81e5-938d-e19a4e93f97c",
    image: "classic-checklist.png",
    title: "Multi Paragraph Test",
    description: "Paragraph one.\n\nParagraph two.",
    alt: "Test graphic",
    board: "Test Board",
    link: "https://clarity-lists.com/posts/test",
  };
  assert.deepEqual(parsePostText(postText(multiPara)), multiPara);
});

test("round-trips description containing marker-like content without blank line separator", () => {
  const markerLike = {
    date: "2026-09-08",
    time: "09:00 AM",
    pageId: "26b23760-024b-81e5-938d-e19a4e93f97c",
    image: "classic-checklist.png",
    title: "Marker Test",
    description: "BOARD: chalkboard style\nAfter posting: relax",
    alt: "Test graphic",
    board: "Test Board",
    link: "https://clarity-lists.com/posts/test",
  };
  assert.deepEqual(parsePostText(postText(markerLike)), markerLike);
});
