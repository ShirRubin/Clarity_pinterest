import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingRequest, markApplied } from "../src/stages/revise.js";
import { appendNote } from "../src/stages/approve.js";

test("pendingRequest finds the note left by the review page", () => {
  assert.equal(
    pendingRequest("revise 2026-09-02: items 3 and 7 are vague"),
    "items 3 and 7 are vague",
  );
});

test("pendingRequest ignores unrelated history and takes the newest request", () => {
  const notes = appendNote(
    appendNote("rides the winter arc trend", "revise 2026-09-01: too long"),
    "revise 2026-09-02: cut the last two items",
  );
  assert.equal(pendingRequest(notes), "cut the last two items");
});

test("pendingRequest stops at the next history entry, not the end of the field", () => {
  const notes = appendNote(
    appendNote("seed", "revise 2026-09-01: make it punchier"),
    "review 2026-09-02: approved on the second pass",
  );
  assert.equal(pendingRequest(notes), "make it punchier");
});

test("an applied request is not picked up twice", () => {
  const notes = appendNote("seed", "revise 2026-09-02: make it punchier");
  const after = markApplied(notes, "make it punchier");
  assert.match(after, /revised 2026-09-02: make it punchier/);
  assert.equal(pendingRequest(after), undefined);
});

test("feedback written after a rewrite is picked up again", () => {
  const first = appendNote("seed", "revise 2026-09-02: make it punchier");
  const applied = markApplied(first, "make it punchier");
  const second = appendNote(applied, "revise 2026-09-03: now the title is too short");
  assert.equal(pendingRequest(second), "now the title is too short");
});

test("no revision note means nothing to do", () => {
  assert.equal(pendingRequest(undefined), undefined);
  assert.equal(pendingRequest("review 2026-09-02: approved"), undefined);
});
