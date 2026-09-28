import { test } from "node:test";
import assert from "node:assert/strict";
import { branchProblem, deployBehind, deployModeFrom } from "../src/stages/ship.js";

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


test("deploy mode defaults to wrangler, so the nightly job keeps deploying directly", () => {
  assert.equal(deployModeFrom(undefined), "wrangler");
  assert.equal(deployModeFrom(""), "wrangler");
  assert.equal(deployModeFrom("wrangler"), "wrangler");
});

test("deploy mode git is opt-in and case-insensitive", () => {
  assert.equal(deployModeFrom("git"), "git");
  assert.equal(deployModeFrom(" GIT "), "git");
});

test("an unknown deploy mode is an error, not a silent fallback", () => {
  assert.throws(() => deployModeFrom("pages"), /CLARITY_BLOG_DEPLOY/);
});

test("only main may deploy to production", () => {
  assert.equal(branchProblem("main"), undefined);
  assert.match(branchProblem("affiliates") ?? "", /refusing to deploy/);
  assert.match(branchProblem("HEAD") ?? "", /refusing to deploy/); // detached checkout
});
