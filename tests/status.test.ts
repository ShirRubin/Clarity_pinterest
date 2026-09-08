import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readyToPublish,
  upcomingPins,
  blogDrift,
  relinkProgress,
  analyticsAge,
  openTasksFrom,
  attentionItems,
  severity,
  formatStatus,
  lastRunFrom,
  ANALYTICS_STALE_DAYS,
  type ClarityStatus,
} from "../src/status.js";

const pack = (date: string, n = "some-list--classic-checklist") => `${date}--${n}`;

// --- readyToPublish ----------------------------------------------------------
// Mirrors the queue publish.ts actually builds: Approved rows, plus Published
// rows that never got a date or a live URL (packed before scheduling existed).

test("counts Approved rows as ready to publish", () => {
  const rows = [
    { status: "Approved", source: "pipeline" },
    { status: "Approved", source: "pipeline" },
    { status: "Drafted", source: "pipeline" },
  ];
  assert.equal(readyToPublish(rows), 2);
});

test("counts date-less, URL-less Published rows as still needing a publish", () => {
  const rows = [
    { status: "Published", source: "pipeline" },
    { status: "Published", source: "pipeline", scheduledDate: "2026-09-08" },
    { status: "Published", source: "pipeline", pinUrl: "https://pin.it/x" },
  ];
  assert.equal(readyToPublish(rows), 1);
});

test("ignores backfill rows, which are imported history and never get packed", () => {
  const rows = [
    { status: "Approved", source: "backfill" },
    { status: "Published", source: "backfill" },
  ];
  assert.equal(readyToPublish(rows), 0);
});

// --- upcomingPins ------------------------------------------------------------

test("reports one entry per day in the window, including days with no pin", () => {
  const names = [pack("2026-09-07"), pack("2026-09-07"), pack("2026-09-09")];
  const days = upcomingPins(names, "2026-09-07", 3);
  assert.deepEqual(days, [
    { date: "2026-09-07", count: 2 },
    { date: "2026-09-08", count: 0 },
    { date: "2026-09-09", count: 1 },
  ]);
});

test("ignores packs dated before today and beyond the window", () => {
  const names = [pack("2026-09-06"), pack("2026-09-07"), pack("2026-09-20")];
  const days = upcomingPins(names, "2026-09-07", 2);
  assert.deepEqual(days, [
    { date: "2026-09-07", count: 1 },
    { date: "2026-09-08", count: 0 },
  ]);
});

test("ignores directory names that carry no date", () => {
  const days = upcomingPins(["README.md", pack("2026-09-07")], "2026-09-07", 1);
  assert.deepEqual(days, [{ date: "2026-09-07", count: 1 }]);
});

// --- blogDrift ---------------------------------------------------------------

test("posts written but never built count as unbuilt", () => {
  const d = blogDrift({ posts: 133, built: 129, newestPostMs: 500, buildMs: 400 });
  assert.equal(d.unbuilt, 4);
});

test("a post edited after the last build makes the build stale", () => {
  const d = blogDrift({ posts: 129, built: 129, newestPostMs: 900, buildMs: 400 });
  assert.equal(d.unbuilt, 0);
  assert.equal(d.stale, true);
});

test("a build newer than every post is neither stale nor short", () => {
  const d = blogDrift({ posts: 129, built: 129, newestPostMs: 100, buildMs: 400 });
  assert.deepEqual(d, { unbuilt: 0, stale: false });
});

test("never built at all: every post is unbuilt and the build is stale", () => {
  const d = blogDrift({ posts: 12, built: 0, newestPostMs: 100, buildMs: 0 });
  assert.deepEqual(d, { unbuilt: 12, stale: true });
});

// --- relinkProgress ----------------------------------------------------------

test("counts entries flagged done against the total", () => {
  const p = relinkProgress([{ done: true }, {}, {}, { done: true }]);
  assert.deepEqual(p, { done: 2, total: 4, remaining: 2 });
});

test("a file with no done flags anywhere reports nothing done yet", () => {
  const p = relinkProgress([{}, {}, {}]);
  assert.deepEqual(p, { done: 0, total: 3, remaining: 3 });
});

// --- analyticsAge ------------------------------------------------------------

test("picks the newest snapshot and measures its age in days", () => {
  const a = analyticsAge(
    ["snapshot-2026-08-20.json", "snapshot-2026-09-04.json", "pin-lookup.json"],
    "2026-09-07",
  );
  assert.equal(a.latest, "2026-09-04");
  assert.equal(a.daysOld, 3);
  assert.equal(a.stale, false);
});

test("a snapshot older than the stale threshold is flagged", () => {
  const a = analyticsAge(["snapshot-2026-08-20.json"], "2026-09-07");
  assert.equal(a.daysOld, 18);
  assert.equal(a.stale, true);
});

test("exactly at the threshold is not yet stale", () => {
  assert.equal(ANALYTICS_STALE_DAYS, 7); // the date below is this many days on
  const a = analyticsAge(["snapshot-2026-09-01.json"], "2026-09-08");
  assert.equal(a.daysOld, ANALYTICS_STALE_DAYS);
  assert.equal(a.stale, false);
});

test("no snapshots at all is stale with no date", () => {
  const a = analyticsAge([], "2026-09-07");
  assert.equal(a.latest, undefined);
  assert.equal(a.daysOld, undefined);
  assert.equal(a.stale, true);
});

// --- openTasksFrom -----------------------------------------------------------

test("pulls the headline out of each OPEN TASK callout in the plan", () => {
  const md = [
    "## Status",
    "Phase C done.",
    "> **⏳ OPEN TASK — relink the remaining pins on Pinterest (user).** 130 pins still send readers to a board URL.",
    "Some prose.",
    "> **⏳ OPEN TASK — export fresh analytics CSVs.** Overview + audience.",
  ].join("\n");
  assert.deepEqual(openTasksFrom(md), [
    "relink the remaining pins on Pinterest (user)",
    "export fresh analytics CSVs",
  ]);
});

test("a plan with no open tasks yields none", () => {
  assert.deepEqual(openTasksFrom("## Status\nEverything done."), []);
});

// --- attentionItems / severity ----------------------------------------------

const clear: ClarityStatus = {
  today: "2026-09-07",
  inReview: 0,
  needsChanges: 0,
  readyToPublish: 0,
  packsWaiting: 0,
  packsOverdue: 0,
  scheduledOnPinterest: 40,
  runwayDays: 26,
  lastScheduledDate: "2026-10-03",
  upcoming: [{ date: "2026-09-07", count: 3 }],
  idea: 0,
  drafted: 0,
  designed: 0,
  listsToGenerate: 0,
  blog: { posts: 133, built: 133, unbuilt: 0, stale: false },
  relink: { done: 10, total: 140, remaining: 130 },
  openTasks: [],
  analytics: { latest: "2026-09-04", daysOld: 3, stale: false },
};

test("a clear board has no attention items and reads green", () => {
  assert.deepEqual(attentionItems(clear), []);
  assert.equal(severity(clear), "ok");
});

test("lists waiting on review raise an attention item and read amber", () => {
  const s = { ...clear, inReview: 4 };
  assert.deepEqual(attentionItems(s), ["4 lists in review"]);
  assert.equal(severity(s), "attention");
});

test("overdue packs read red even when nothing else is pending", () => {
  const s = { ...clear, packsOverdue: 2 };
  assert.equal(severity(s), "urgent");
});

test("every acute queue contributes its own attention item", () => {
  const s = { ...clear, inReview: 4, needsChanges: 1, readyToPublish: 2, packsWaiting: 6 };
  assert.deepEqual(attentionItems(s), [
    "4 lists in review",
    "1 list needing changes",
    "2 lists ready to publish",
    "6 packs to post",
  ]);
});

test("the long-running relink task does not by itself make the board amber", () => {
  assert.equal(severity({ ...clear, relink: { done: 0, total: 140, remaining: 140 } }), "ok");
});

// --- formatStatus ------------------------------------------------------------

test("a clear board is announced as all clear", () => {
  const out = formatStatus(clear);
  assert.match(out, /🟢/);
  assert.match(out, /all clear/i);
});

test("the card leads with the count of things waiting on you", () => {
  const out = formatStatus({ ...clear, inReview: 4, readyToPublish: 2 });
  assert.match(out, /🟡/);
  assert.match(out, /2 things need you/);
});

test("each waiting queue names the command that clears it", () => {
  const out = formatStatus({ ...clear, inReview: 4, needsChanges: 1, readyToPublish: 2 });
  assert.match(out, /clarity approve/);
  assert.match(out, /clarity revise/);
  assert.match(out, /clarity publish/);
});

test("unbuilt blog posts are reported with the redeploy command", () => {
  const out = formatStatus({ ...clear, blog: { posts: 133, built: 129, unbuilt: 4, stale: true } });
  assert.match(out, /4 post/);
  assert.match(out, /wrangler deploy/);
});

test("open tasks from the plan are listed", () => {
  const out = formatStatus({ ...clear, openTasks: ["claim the domain on Pinterest"] });
  assert.match(out, /claim the domain on Pinterest/);
});

test("the end of the calendar carries its month, since it is weeks away", () => {
  const out = formatStatus({ ...clear, lastScheduledDate: "2026-10-03" });
  assert.match(out, /through Sat 3 Oct/);
});

test("both waiting-list queues are labelled as lists", () => {
  const out = formatStatus({ ...clear, inReview: 6, needsChanges: 4 });
  assert.match(out, /lists in review/);
  assert.match(out, /lists needing changes/);
});

test("the relink counter reports a total only once some are recorded done", () => {
  const none = formatStatus({ ...clear, relink: { done: 0, total: 130, remaining: 130 } });
  assert.match(none, /130 still point at a board/);
  assert.doesNotMatch(none, /130 of 130/);

  const some = formatStatus({ ...clear, relink: { done: 10, total: 140, remaining: 130 } });
  assert.match(some, /130 of 140/);
});

test("the plan's own relink callout is not repeated beside the relink counter", () => {
  const out = formatStatus({
    ...clear,
    relink: { done: 0, total: 130, remaining: 130 },
    openTasks: ["relink the remaining pins on Pinterest (user)", "claim the domain"],
  });
  assert.equal(out.match(/relink/gi)?.length, 1);
  assert.match(out, /claim the domain/);
});

test("a stale analytics snapshot is called out with its age", () => {
  const out = formatStatus({
    ...clear,
    analytics: { latest: "2026-08-20", daysOld: 18, stale: true },
  });
  assert.match(out, /18 day/);
});

// --- lastRunFrom -------------------------------------------------------------
// The unattended job runs Mon + Thu, so more than MISSED_RUN_DAYS of silence
// means a run did not fire (laptop on battery, or the task got unregistered).

test("picks the newest scheduled-run log as the last unattended run", () => {
  const r = lastRunFrom(
    ["scheduled-run-2026-08-30.log", "scheduled-run-2026-09-06.log", "approve-2026-09-06.log"],
    "2026-09-07",
  );
  assert.equal(r.date, "2026-09-06");
  assert.equal(r.daysAgo, 1);
  assert.equal(r.missed, false);
});

test("silence for longer than the Mon/Thu gap counts as a missed run", () => {
  const r = lastRunFrom(["scheduled-run-2026-08-30.log"], "2026-09-07");
  assert.equal(r.daysAgo, 8);
  assert.equal(r.missed, true);
});

test("no scheduled-run log at all counts as missed with no date", () => {
  const r = lastRunFrom(["approve-2026-09-06.log"], "2026-09-07");
  assert.equal(r.date, undefined);
  assert.equal(r.missed, true);
});
