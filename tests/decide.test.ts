import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionPatch, appendNote, isDecision, STATUS_FOR } from "../src/approve/decide.js";

test("approve without a note only flips the status", () => {
  assert.deepEqual(decisionPatch("approve", undefined, "old", "2026-09-09"), { status: "Approved" });
});

test("approve with a note appends a review-tagged entry", () => {
  assert.deepEqual(decisionPatch("approve", "love it", "old", "2026-09-09"), {
    status: "Approved",
    notes: "old | review 2026-09-09: love it",
  });
});

test("revise appends a revise-tagged entry that clarity revise will read", () => {
  assert.deepEqual(decisionPatch("revise", "items 3 and 7 are vague", undefined, "2026-09-09"), {
    status: "Needs changes",
    notes: "revise 2026-09-09: items 3 and 7 are vague",
  });
});

test("revise without a note is refused", () => {
  assert.throws(() => decisionPatch("revise", "  ", "x", "2026-09-09"), /note/);
});

test("reject maps to Rejected", () => {
  assert.equal(decisionPatch("reject", undefined, undefined, "2026-09-09").status, "Rejected");
  assert.equal(STATUS_FOR.reject, "Rejected");
});

test("appendNote joins with a pipe and treats blank existing notes as empty", () => {
  assert.equal(appendNote(undefined, "a"), "a");
  assert.equal(appendNote("  ", "a"), "a");
  assert.equal(appendNote("a", "b"), "a | b");
});

test("isDecision accepts only the three verdicts", () => {
  assert.ok(isDecision("approve") && isDecision("reject") && isDecision("revise"));
  assert.ok(!isDecision("publish") && !isDecision(undefined));
});
