import { test } from "node:test";
import assert from "node:assert/strict";
import { staleExports } from "../src/stats.js";

test("keeps the newest overview and the newest audience export, flags the rest", () => {
  const files = [
    "Pinterest Analytics overview 20260805-20260904.csv",
    "Pinterest Analytics overview 20260823-20260922.csv",
    "audience-insights-total-audience-2026-09-04.csv",
    "audience-insights-total-audience-2026-09-20.csv",
  ];
  assert.deepEqual(staleExports(files), [
    "Pinterest Analytics overview 20260805-20260904.csv",
    "audience-insights-total-audience-2026-09-04.csv",
  ]);
});

test("the overview window END decides, not the start", () => {
  const files = [
    "Pinterest Analytics overview 20260901-20260910.csv",
    "Pinterest Analytics overview 20260820-20260920.csv",
  ];
  assert.deepEqual(staleExports(files), ["Pinterest Analytics overview 20260901-20260910.csv"]);
});

test("a single export of each kind is never stale; unknown files are left alone", () => {
  const files = ["Pinterest Analytics overview 20260823-20260922.csv", "notes.csv", "readme.txt"];
  assert.deepEqual(staleExports(files), []);
});

test("audience views are compared per view, not across views", () => {
  const files = [
    "audience-insights-total-audience-2026-09-20.csv",
    "audience-insights-engaged-audience-2026-09-04.csv",
  ];
  assert.deepEqual(staleExports(files), []);
});
