import { test } from "node:test";
import assert from "node:assert/strict";
import { freshLists, neverPostedSlugs, orderForCalendar, type CalendarPack } from "../src/freshness.js";

const pack = (date: string, slug: string, template = "classic-checklist"): CalendarPack => ({
  dir: `${date}--${slug}--${template}`,
  date,
  slug,
  template,
});

const allNew = () => true;

test("a list is never-posted when no pack of it sits in posted/", () => {
  const never = neverPostedSlugs([pack("2026-11-05", "new-list"), pack("2026-11-06", "old-list")], [pack("2026-09-20", "old-list")]);
  assert.deepEqual([...never], ["new-list"]);
});

test("fresh lists are new lists whose first pin lands inside the horizon", () => {
  const pending = [
    pack("2026-10-06", "a"), // opens this week
    pack("2026-10-13", "a", "bold-panel"), // sibling, not a second fresh list
    pack("2026-10-11", "b"), // opens this week
    pack("2026-10-20", "c"), // next week
    pack("2026-10-07", "old"), // fourth skin of a posted list
  ];
  const fresh = freshLists(pending, [pack("2026-09-01", "old")], "2026-10-05", 7, allNew);
  assert.deepEqual(fresh, ["a", "b"]);
});

test("a backfill list (Pinterest already knows the URL) is never fresh, whatever its date", () => {
  const pending = [pack("2026-10-06", "friends-bucket-list"), pack("2026-10-06", "brand-new")];
  const fresh = freshLists(pending, [], "2026-10-05", 7, (slug) => slug === "brand-new");
  assert.deepEqual(fresh, ["brand-new"]);
});

test("a never-posted list dated before today is not fresh cover — it is overdue", () => {
  const fresh = freshLists([pack("2026-10-01", "late")], [], "2026-10-05", 7, allNew);
  assert.deepEqual(fresh, []);
});

test("orderForCalendar puts one opener per new list first, then everything else in date order", () => {
  const pending = [
    pack("2026-12-10", "new-b"),
    pack("2026-12-17", "new-b", "bold-panel"),
    pack("2026-10-20", "old", "sticky-note"),
    pack("2026-11-05", "new-a"),
    pack("2026-10-21", "old", "big-numbers"),
    pack("2026-11-12", "new-a", "bold-panel"),
  ];
  const posted = [pack("2026-09-01", "old")];
  const order = orderForCalendar(pending, posted, allNew).map((p) => p.dir);
  assert.deepEqual(order, [
    "2026-11-05--new-a--classic-checklist",
    "2026-12-10--new-b--classic-checklist",
    "2026-10-20--old--sticky-note",
    "2026-10-21--old--big-numbers",
    "2026-11-12--new-a--bold-panel",
    "2026-12-17--new-b--bold-panel",
  ]);
});

test("orderForCalendar leaves a backfill list's packs in the backlog", () => {
  const pending = [pack("2026-11-10", "friends-bucket-list"), pack("2026-12-01", "brand-new")];
  const order = orderForCalendar(pending, [], (slug) => slug === "brand-new").map((p) => p.slug);
  assert.deepEqual(order, ["brand-new", "friends-bucket-list"]);
});

test("with a date, seasonal packs in their window go first by deadline and out-of-window ones are parked", () => {
  const pending = [
    pack("2026-11-19", "halloween-movies-bucket-list"), // open until Oct 24 → first
    pack("2026-12-13", "the-thanksgiving-episode-bucket-list-12-sitcom-nights-in-nov"), // open until Nov 19
    pack("2026-11-05", "the-2027-vision-board-party-bucket-list-12-steps-to-host-it-"), // window opens Nov 2 → parked until then
    pack("2026-10-20", "slow-october", "sticky-note"), // fall: open until Nov 14, but rank 1 only if it is a first variant… it is
    pack("2026-10-21", "brand-new-list"),
    pack("2026-10-22", "old", "big-numbers"),
    pack("2026-11-20", "halloween-movies-bucket-list", "bold-panel"), // second Halloween variant: after every list's first
  ];
  const posted = [pack("2026-09-01", "old"), pack("2026-09-02", "halloween-movies-bucket-list", "sticky-note")];
  const order = orderForCalendar(pending, posted, (slug) => slug === "brand-new-list", "2026-10-05");
  assert.deepEqual(
    order.map((p) => `${p.tier}:${p.slug.slice(0, 16)}${p.notBefore ? "@" + p.notBefore : ""}`),
    [
      "season:halloween-movies",
      "season:slow-october",
      "season:the-thanksgiving",
      "season:halloween-movies",
      "opener:brand-new-list",
      "backlog:old",
      "parked:the-2027-vision-@2026-11-02",
    ],
  );
});

test("a seasonal pack past its deadline is parked for next year's window", () => {
  const order = orderForCalendar([pack("2026-11-19", "halloween-movies-bucket-list")], [], () => false, "2026-11-19");
  assert.equal(order[0].tier, "parked");
  assert.equal(order[0].notBefore, "2027-09-01");
});

test("without a date the order is season-blind, as before", () => {
  const order = orderForCalendar([pack("2026-11-19", "halloween-movies-bucket-list"), pack("2026-10-21", "brand-new-list")], [], () => true);
  assert.deepEqual(order.map((p) => p.tier), ["opener", "opener"]);
});
