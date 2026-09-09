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

test("a leading imperative verb and article are dropped from the head", () => {
  assert.deepEqual(suggestTopics("1. **Start a candle collection** — one a month."), ["candle collection"]);
});

test("vibes are reachable: a 12-item list reserves the theme's vibe words instead of losing them past 10 heads", () => {
  const items = [
    "1. **Morning walk** — before the day starts.",
    "2. **Pumpkin spice** — the first of the season.",
    "3. **Warm cider** — mulled, by the fire.",
    "4. **Wool blanket** — the good one, off the shelf.",
    "5. **Leaf pile** — jump in, don't just look.",
    "6. **Board game night** — pick a classic.",
    "7. **Apple orchard** — a whole afternoon.",
    "8. **Pie baking** — from scratch, not a box.",
    "9. **Candle scents** — rotate the seasonal ones.",
    "10. **Flannel shirts** — the softest one wins.",
    "11. **Hot cocoa** — with all the toppings.",
    "12. **Your turn** — what would you add?",
  ].join("\n");
  const t = suggestTopics(items, "Seasonal");
  assert.equal(t.length, 10);
  assert.deepEqual(t.slice(-3), ["cozy living", "autumn day", "holiday season"]);
});
