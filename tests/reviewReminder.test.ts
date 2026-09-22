import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planReminder,
  reminderTime,
  reminderTitle,
  reminderBody,
  localHHMM,
  localToUtcISO,
  REVIEW_URL,
} from "../src/reviewReminder.js";

const names = (n: number) => Array.from({ length: n }, (_, i) => `The Test Bucket List ${i + 1}`);

// --- planReminder: the four states -------------------------------------------------

test("first night with lists waiting creates the task", () => {
  const plan = planReminder({}, names(5), "2026-09-23", "02:00");
  assert.equal(plan.kind, "create");
  assert.equal(plan.kind === "create" && plan.dueLocal, "2026-09-23T09:00:00");
});

test("a later night with a task already open updates it instead of creating a second one", () => {
  const plan = planReminder({ taskId: "t1" }, names(3), "2026-09-24", "02:00");
  assert.equal(plan.kind, "update");
  assert.equal(plan.kind === "update" && plan.taskId, "t1");
  assert.equal(plan.kind === "update" && plan.dueLocal, "2026-09-24T09:00:00");
});

test("an empty queue with a task open closes it", () => {
  assert.deepEqual(planReminder({ taskId: "t1" }, [], "2026-09-25", "02:00"), { kind: "close", taskId: "t1" });
});

test("an empty queue with nothing open does nothing", () => {
  assert.deepEqual(planReminder({}, [], "2026-09-25", "02:00"), { kind: "none" });
});

// --- reminderTime: a deferred run must still get a reminder that can fire ------------

test("a 02:00 run is reminded at 09:00 the same morning", () => {
  assert.equal(reminderTime("2026-09-23", "02:00"), "2026-09-23T09:00:00");
});

test("a run at 08:59 still gets the 09:00 slot", () => {
  assert.equal(reminderTime("2026-09-23", "08:59"), "2026-09-23T09:00:00");
});

test("a run deferred past 09:00 is reminded 10 minutes from now, not silently skipped", () => {
  assert.equal(reminderTime("2026-09-23", "09:59"), "2026-09-23T10:09:00");
});

test("09:00 exactly counts as past, so the reminder moves forward", () => {
  assert.equal(reminderTime("2026-09-23", "09:00"), "2026-09-23T09:10:00");
});

test("the +10 minutes carries into the next hour", () => {
  assert.equal(reminderTime("2026-09-23", "13:55"), "2026-09-23T14:05:00");
});

test("a late-night run is clamped to 23:59 rather than rolling into tomorrow", () => {
  assert.equal(reminderTime("2026-09-23", "23:55"), "2026-09-23T23:59:00");
});

// --- the task's text ----------------------------------------------------------------

test("the title carries the count and is singular for one list", () => {
  assert.equal(reminderTitle(5), "Review 5 Clarity lists");
  assert.equal(reminderTitle(1), "Review 1 Clarity list");
});

test("the body leads with the review link", () => {
  const body = reminderBody(names(2));
  assert.ok(body.includes(REVIEW_URL), "review link missing from the task body");
});

test("the body lists every title when there are few", () => {
  const body = reminderBody(names(3));
  for (const n of names(3)) assert.ok(body.includes(n), `missing ${n}`);
});

test("a long queue is capped at 8 titles plus a count of the rest", () => {
  const body = reminderBody(names(11));
  assert.ok(body.includes("The Test Bucket List 8"), "8th title should still be listed");
  assert.ok(!body.includes("The Test Bucket List 9"), "9th title should be summarised away");
  assert.ok(body.includes("3 more"), "the remaining 3 should be counted");
});

// --- local time helpers --------------------------------------------------------------

test("localHHMM reads the wall clock in the posting zone, not UTC", () => {
  // 2026-09-23T06:00:00Z is 09:00 in Asia/Jerusalem (UTC+3, summer time).
  assert.equal(localHHMM(new Date("2026-09-23T06:00:00Z"), "Asia/Jerusalem"), "09:00");
});

test("localHHMM handles the midnight hour (ICU can report hour 24)", () => {
  assert.equal(localHHMM(new Date("2026-09-22T21:30:00Z"), "Asia/Jerusalem"), "00:30");
});

test("localToUtcISO converts a summer-time local reminder to the right instant", () => {
  assert.equal(localToUtcISO("2026-09-23T09:00:00", "Asia/Jerusalem"), "2026-09-23T06:00:00.000Z");
});

test("localToUtcISO converts a winter-time local reminder to the right instant", () => {
  // Israel is UTC+2 in December.
  assert.equal(localToUtcISO("2026-12-23T09:00:00", "Asia/Jerusalem"), "2026-12-23T07:00:00.000Z");
});
