import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, TEASER_SHOWN } from "../src/render/renderPin.js";

const items = [
  "1. **Name your winter arc** — one sentence.",
  "2. **Do a receipts review** — look back.",
  "3. **Pick three needle-movers** — drop the rest.",
  "4. **Build a 6pm shutdown ritual** — close the day.",
  "5. **Start a walk streak** — sunrise or sunset.",
  "6. #6 — your turn. What would you add?",
].join("\n");
const content = { name: "The Winter Arc Bucket List: 5 Rituals", listItems: items, theme: "Manifestation" };

test("a teaser shows the first three items, cuts the fourth and counts the rest", () => {
  const html = fillTemplate("{{TEASER_ITEMS}}|{{TEASER_CUT}}|{{REST_COUNT}}|{{SHOWN_COUNT}}|{{TOTAL_COUNT}}", content);
  const [shown, cut, rest, shownCount, total] = html.split("|");
  assert.equal(TEASER_SHOWN, 3);
  assert.equal((shown.match(/<li>/g) ?? []).length, 3);
  assert.match(shown, /Name your winter arc/);
  assert.doesNotMatch(shown, /shutdown ritual/);
  assert.equal(cut, "Build a 6pm shutdown ritual");
  assert.equal(rest, "2");
  assert.equal(shownCount, "3");
  assert.equal(total, "5");
});

test("the counter teaser numbers the shown items and ghosts the rest from the next number", () => {
  const html = fillTemplate("{{TEASER_COUNT_ITEMS}}|{{TEASER_GHOSTS}}", content);
  const [shown, ghosts] = html.split("|");
  assert.match(shown, /<span class="num">01<\/span>/);
  assert.match(shown, /<span class="num">03<\/span>/);
  assert.equal((ghosts.match(/class="ghost"/g) ?? []).length, 2);
  assert.match(ghosts, /<span class="num">04<\/span>/);
  assert.match(ghosts, /<span class="num">05<\/span>/);
});

test("a list shorter than the teaser window still renders, with nothing to cut and zero more", () => {
  const short = { ...content, listItems: "1. **Only one** — thing.\n2. #2 — your turn." };
  const html = fillTemplate("{{TEASER_ITEMS}}|{{TEASER_CUT}}|{{REST_COUNT}}", short);
  const [shown, cut, rest] = html.split("|");
  assert.equal((shown.match(/<li>/g) ?? []).length, 1);
  assert.equal(cut, "");
  assert.equal(rest, "0");
});

test("the full-list placeholders are untouched by the teaser ones", () => {
  const html = fillTemplate("{{ITEMS}}", content);
  assert.equal((html.match(/<li>/g) ?? []).length, 5);
  assert.match(html, /open-slot/);
});
