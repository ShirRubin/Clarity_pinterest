import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUSES, BOARDS, PINTEREST_BOARD_NAMES, DB_PROPERTIES } from "../src/schema.js";
import { TEMPLATE_NAMES } from "../src/templates.js";

test("every template has a date property of its own name in the database schema", () => {
  for (const t of TEMPLATE_NAMES) {
    assert.deepEqual((DB_PROPERTIES as Record<string, unknown>)[t], { date: {} }, `missing date column for ${t}`);
  }
});

test("Scheduled sits between Approved and Published", () => {
  const i = STATUSES.indexOf("Scheduled");
  assert.ok(i > 0);
  assert.equal(STATUSES[i - 1], "Approved");
  assert.equal(STATUSES[i + 1], "Published");
});

test("every Notion board has a Pinterest board title, and none contains the middle dot", () => {
  for (const b of BOARDS) {
    const name = PINTEREST_BOARD_NAMES[b];
    assert.ok(name, `missing Pinterest name for ${b}`);
    assert.ok(!name.includes("·"), `${name} still has the Notion-only separator`);
  }
  assert.equal(PINTEREST_BOARD_NAMES["Books · Learning & Culture"], "Books, Learning & Culture");
});
