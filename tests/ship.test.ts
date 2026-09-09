import { test } from "node:test";
import assert from "node:assert/strict";
import { deployBehind } from "../src/stages/ship.js";

test("drift alone (unbuilt posts) is behind, marker or not", () => {
  assert.equal(deployBehind({ unbuilt: 2, stale: false }, true, true), true);
});

test("stale drift is behind even with a marker present", () => {
  assert.equal(deployBehind({ unbuilt: 0, stale: true }, true, true), true);
});

test("a clean build with no marker is behind — the deploy step never confirmed", () => {
  assert.equal(deployBehind({ unbuilt: 0, stale: false }, true, false), true);
});

test("a clean build with its marker present is not behind", () => {
  assert.equal(deployBehind({ unbuilt: 0, stale: false }, true, true), false);
});

test("no built posts at all and no marker is covered by drift.stale, not double-counted", () => {
  assert.equal(deployBehind({ unbuilt: 0, stale: false }, false, false), false);
});
