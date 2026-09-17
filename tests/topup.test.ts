import { test } from "node:test";
import assert from "node:assert/strict";
import { topUpCandidate } from "../src/topup.js";

const row = (o: Partial<{ source: string; status: string; listItems: string; destinationLink: string }>) => ({
  source: "pipeline",
  status: "Approved",
  listItems: "1. **A** — b",
  destinationLink: "https://clarity-lists.com/posts/the-a-list",
  ...o,
});

test("pipeline rows still on their way to Pinterest are candidates", () => {
  for (const status of ["Designed", "In Review", "Approved"]) assert.equal(topUpCandidate(row({ status })), true, status);
});

test("pipeline rows already scheduled or live are candidates too — their missing variants are fresh pins", () => {
  for (const status of ["Scheduled", "Published"]) assert.equal(topUpCandidate(row({ status })), true, status);
});

test("rows that will be re-rendered anyway, or never posted, are not candidates", () => {
  for (const status of ["Idea", "Drafted", "Needs changes", "Rejected", "Archived"]) assert.equal(topUpCandidate(row({ status })), false, status);
});

test("a backfill row with transcribed items and a blog post is a candidate", () => {
  assert.equal(topUpCandidate(row({ source: "backfill", status: "Published" })), true);
});

test("a backfill row is not a candidate without list items or without a post to link to", () => {
  assert.equal(topUpCandidate(row({ source: "backfill", status: "Published", listItems: "" })), false);
  assert.equal(topUpCandidate(row({ source: "backfill", status: "Published", destinationLink: "https://www.pinterest.com/ClarityBucketLists/movie-bucket-lists/" })), false);
});

test("no list items means nothing to render, whatever the status", () => {
  assert.equal(topUpCandidate(row({ listItems: "" })), false);
});
