import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseDestination, postUrlForName, SITE, pinLink, linkKey } from "../src/destination.js";

test("post URL is the blog site + slug of the name's short title", () => {
  assert.equal(
    postUrlForName("The Winter Arc Bucket List: 12 Rituals to Close Out 2026"),
    `${SITE}/posts/the-winter-arc-bucket-list`,
  );
});

test("a Notion destination that already points at the blog wins", () => {
  const d = chooseDestination(
    { name: "The Winter Arc Bucket List: 12 rituals", board: "Aesthetic Life Lists", destinationLink: `${SITE}/posts/winter-arc` },
    false,
  );
  assert.deepEqual(d, { url: `${SITE}/posts/winter-arc`, source: "notion" });
});

test("a Notion destination pointing at a board is ignored — the post on disk wins", () => {
  const d = chooseDestination(
    {
      name: "The Winter Arc Bucket List: 12 rituals",
      board: "Aesthetic Life Lists",
      destinationLink: "https://www.pinterest.com/ClarityBucketLists/aesthetic-life-lists/",
    },
    true,
  );
  assert.deepEqual(d, { url: `${SITE}/posts/the-winter-arc-bucket-list`, source: "blog" });
});

test("no post yet falls back to the board URL", () => {
  const d = chooseDestination({ name: "The Winter Arc Bucket List", board: "Aesthetic Life Lists" }, false);
  assert.deepEqual(d, { url: "https://www.pinterest.com/ClarityBucketLists/aesthetic-life-bucket-lists/", source: "board" });
});

test("no post and an unknown board falls back to the profile", () => {
  const d = chooseDestination({ name: "Some List", board: "Not A Real Board" }, false);
  assert.deepEqual(d, { url: "https://www.pinterest.com/ClarityBucketLists/", source: "board" });
});

// --- UTM tags on the link a pin carries (CLARITY_PLAN §3.4) ---

test("a post link sent to Pinterest carries utm tags naming the design and the post", () => {
  assert.equal(
    pinLink(`${SITE}/posts/the-tea-bucket-list`, "sticky-note"),
    `${SITE}/posts/the-tea-bucket-list/?utm_source=pinterest&utm_medium=pin&utm_campaign=sticky-note&utm_content=the-tea-bucket-list`,
  );
});

test("only blog post links are tagged, and never twice", () => {
  const board = "https://www.pinterest.com/ClarityBucketLists/fall-bucket-lists/";
  assert.equal(pinLink(board, "sticky-note"), board);
  const tagged = pinLink(`${SITE}/posts/tea`, "bold-panel");
  assert.equal(pinLink(tagged, "sticky-note"), tagged);
});

test("linkKey drops the tags, so a list's four tagged variants are still one URL", () => {
  const a = pinLink(`${SITE}/posts/tea`, "sticky-note");
  const b = pinLink(`${SITE}/posts/tea`, "big-numbers");
  assert.notEqual(a, b);
  assert.equal(linkKey(a), linkKey(b));
  assert.equal(linkKey(`${SITE}/posts/tea/`), `${SITE}/posts/tea`);
});
