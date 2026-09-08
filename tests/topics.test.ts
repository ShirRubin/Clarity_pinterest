import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestTopics } from "../src/topics.js";

const items = [
  "1. **Hand-poured candles** — melt, scent, pour.",
  "2. **Sourdough starter** — feed it daily.",
  "3. **Knitted scarf** — one skein, one weekend.",
  "4. **Your turn** — what would you add?",
].join("\n");

test("takes the bold heads of the list items, first two words, lower-case", () => {
  const t = suggestTopics(items);
  assert.deepEqual(t.slice(0, 3), ["hand-poured candles", "sourdough starter", "knitted scarf"]);
});

test("drops the open 'your turn' slot and appends the theme's vibe words", () => {
  const t = suggestTopics(items, "Seasonal");
  assert.ok(!t.includes("your turn"));
  assert.ok(t.includes("cozy living"));
});

test("never more than 10, never duplicates", () => {
  const many = Array.from({ length: 15 }, (_, i) => `${i + 1}. **Thing ${i % 5}** — x`).join("\n");
  const t = suggestTopics(many, "Travel");
  assert.ok(t.length <= 10);
  assert.equal(new Set(t).size, t.length);
});

test("plain lines without bold still yield something", () => {
  assert.deepEqual(suggestTopics("1. Tea tasting at home\n2. Baking bread"), ["tea tasting", "baking bread"]);
});
