import { test } from "node:test";
import assert from "node:assert/strict";
import { seasonFor, seasonState, DEFAULT_LEAD_DAYS } from "../src/season.js";

test("an evergreen list has no season", () => {
  assert.equal(seasonFor("the-money-manifestation-bucket-list-12-rituals", "2026-10-05"), undefined);
  assert.equal(seasonFor("Brooklyn Nine-Nine Bucket List", "2026-10-05"), undefined);
});

test("a Halloween list opens 60 days before Oct 31 and closes a week before", () => {
  const s = seasonFor("halloween-movies-bucket-list", "2026-10-05")!;
  assert.equal(s.name, "Halloween");
  assert.equal(s.peak, "2026-10-31");
  assert.equal(s.open, "2026-09-01");
  assert.equal(s.deadline, "2026-10-24");
  assert.equal(seasonState(s, "2026-10-05"), "open");
});

test("once the deadline has passed the season rolls to next year", () => {
  const s = seasonFor("Halloween Movies Bucket List", "2026-11-19")!;
  assert.equal(s.peak, "2027-10-31");
  assert.equal(seasonState(s, "2026-11-19"), "early");
});

test("movable feasts use the dated list: Thanksgiving 2026 is Nov 26", () => {
  const s = seasonFor("the-thanksgiving-episode-bucket-list-12-sitcom-nights-in-nov", "2026-10-05")!;
  assert.equal(s.peak, "2026-11-26");
  assert.equal(s.open, `2026-09-27`);
  assert.equal(s.deadline, "2026-11-19");
  assert.equal(seasonFor("friendsgiving", "2026-11-25")!.peak, "2027-11-25");
});

test("the first matching rule wins: an advent calendar is Dec 1, not Christmas", () => {
  assert.equal(seasonFor("the-christmas-movie-advent-bucket-list-24-films-one-a-night", "2026-10-05")!.peak, "2026-12-01");
  assert.equal(seasonFor("the-christmas-market-bucket-list", "2026-10-05")!.peak, "2026-12-25");
});

test("New Year lists cover 2027 and vision boards; the window opens in early November", () => {
  const s = seasonFor("the-2027-vision-board-party-bucket-list", "2026-10-05")!;
  assert.equal(s.name, "New Year");
  assert.equal(s.peak, "2027-01-01");
  assert.equal(s.open, "2026-11-02");
  assert.equal(seasonState(s, "2026-10-05"), "early");
});

test("a whole-season list (fall) stays open well past its peak", () => {
  const s = seasonFor("the-cottage-witch-autumn-bucket-list", "2026-10-05")!;
  assert.equal(s.peak, "2026-10-15");
  assert.equal(s.deadline, "2026-11-14");
  assert.equal(seasonState(s, "2026-11-10"), "open");
  assert.equal(seasonFor("Slow October Bucket List", "2026-11-20")!.peak, "2027-10-15");
});

test("the winter arc opens 90 days ahead, plain winter 60", () => {
  assert.equal(seasonFor("the-winter-arc-bucket-list", "2026-10-05")!.open, "2026-09-22");
  const w = seasonFor("the-soup-season-bucket-list-12-pots-to-make-before-it-snows", "2026-10-05")!;
  assert.equal(w.name, "Winter");
  assert.equal(w.open, "2026-10-22");
  assert.equal(DEFAULT_LEAD_DAYS, 60);
});

test("dark academia is a fall aesthetic, not a back-to-school deadline", () => {
  assert.equal(seasonFor("the-dark-academia-bucket-list-15-ways-to-live-your-semester", "2026-10-05")!.name, "Fall");
});
