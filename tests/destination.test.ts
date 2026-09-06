import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseDestination, postUrlForName, SITE } from "../src/destination.js";

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
  assert.deepEqual(d, { url: "https://www.pinterest.com/ClarityBucketLists/aesthetic-life-lists/", source: "board" });
});

test("no post and an unknown board falls back to the profile", () => {
  const d = chooseDestination({ name: "Some List", board: "Not A Real Board" }, false);
  assert.deepEqual(d, { url: "https://www.pinterest.com/ClarityBucketLists/", source: "board" });
});
