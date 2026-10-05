import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptVariantCopy,
  copyFor,
  templatesMissingCopy,
  variantCopyColumn,
  variantCopyPrompt,
  variantCopySchema,
  PRIMARY_TEMPLATE,
  SECONDARY_TEMPLATES,
} from "../src/variantCopy.js";
import { TEMPLATE_NAMES } from "../src/templates.js";

const row = {
  name: "The Winter Arc Bucket List: 12 Rituals for a Year-End Reset",
  pinTitle: "Winter Arc Bucket List: 12 Rituals for a Year-End Reset",
  pinDescription:
    "Your winter arc is less about hustle and more about finishing the year on purpose. These 12 rituals cover reflection, cozy self-care and money. Tap the pin for the full list and a free printable checklist at clarity-lists.com.\n#winterarc #bucketlist #selfcare",
  altText: "Pastel checklist graphic titled Winter Arc Bucket List with 12 rituals for a year-end reset and round checkboxes",
  keywords: ["winter arc bucket list", "winter arc", "year end reset", "winter self care ideas"],
};

const good = {
  "bold-panel": {
    pinTitle: "Winter Arc Ideas for College Students: 12 Reset Rituals",
    pinDescription:
      "Finals week is the wrong time to start a winter arc, so start the week before. Twelve small rituals for students who want a calmer December. Tap the pin: the full list and the free printable checklist are at clarity-lists.com.\n#winterarc #collegelife #studentlife",
    altText: "White card on a pastel gradient titled Winter Arc Bucket List with 12 reset rituals and filled checkboxes",
  },
  "sticky-note": {
    pinTitle: "Year End Reset Checklist: 12 Winter Arc Habits That Stick",
    pinDescription:
      "A reset that lasts past January starts with habits you can actually keep. These twelve winter arc habits are small enough to do tonight. Every item plus a free printable checklist is one tap away at clarity-lists.com.\n#yearendreset #winterarc #habits",
    altText: "Tilted paper note with tape strip titled Winter Arc Bucket List listing 12 habits with hand-drawn checkboxes",
  },
  "big-numbers": {
    pinTitle: "Winter Self Care Ideas: 12 Winter Arc Things to Do",
    pinDescription:
      "Twelve winter self care ideas, numbered so you can pick one a week until the year ends. No hustle, just a quieter December. Tap the pin for the whole list and the free printable at clarity-lists.com.\n#winterselfcare #winterarc #cozyseason",
    altText: "Two-column numbered list 01 to 12 titled Winter Arc Bucket List with large numerals and a coloured rule",
  },
};

test("the first template keeps the base copy and every other template has its own columns", () => {
  assert.equal(PRIMARY_TEMPLATE, TEMPLATE_NAMES[0]);
  assert.deepEqual(SECONDARY_TEMPLATES, TEMPLATE_NAMES.slice(1));
  assert.equal(variantCopyColumn("Pin title", "sticky-note"), "Pin title · sticky-note");
});

test("copyFor falls back to the base copy until a variant has a complete set of its own", () => {
  const base = copyFor(row, "sticky-note");
  assert.equal(base.own, false);
  assert.equal(base.title, row.pinTitle);
  const withOwn = copyFor({ ...row, variantCopy: { "sticky-note": good["sticky-note"] } }, "sticky-note");
  assert.equal(withOwn.own, true);
  assert.equal(withOwn.title, good["sticky-note"].pinTitle);
  // A half-filled set is not a set.
  const half = copyFor({ ...row, variantCopy: { "sticky-note": { pinTitle: "x" } } }, "sticky-note");
  assert.equal(half.own, false);
  // The primary template never reads a variant column.
  assert.equal(copyFor({ ...row, variantCopy: { "classic-checklist": good["bold-panel"] } }, "classic-checklist").own, false);
});

test("templatesMissingCopy lists the secondary templates without a complete set", () => {
  assert.deepEqual(templatesMissingCopy(row), ["bold-panel", "sticky-note", "big-numbers"]);
  assert.deepEqual(templatesMissingCopy({ variantCopy: { "bold-panel": good["bold-panel"], "sticky-note": good["sticky-note"] } }), ["big-numbers"]);
});

test("acceptVariantCopy keeps sets that pass the copy rules and differ from the base and each other", () => {
  const { copies, problems } = acceptVariantCopy(good, row, ["bold-panel", "sticky-note", "big-numbers"]);
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(copies), ["bold-panel", "sticky-note", "big-numbers"]);
});

test("a variant that opens with the base title's words, or breaks a copy rule, is rejected with a reason", () => {
  const bad = {
    "bold-panel": { ...good["bold-panel"], pinTitle: "Winter Arc Bucket List for College Students: 12 Rituals" }, // same first three words as the base
    "sticky-note": { ...good["sticky-note"], pinDescription: "Twelve habits. Save it!\n#winterarc" }, // no click CTA
    "big-numbers": { ...good["big-numbers"], altText: "Too short" },
  };
  const { copies, problems } = acceptVariantCopy(bad, row, ["bold-panel", "sticky-note", "big-numbers"]);
  assert.deepEqual(Object.keys(copies), []);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /bold-panel: title opens with the same words as the base title/);
  assert.match(problems[1], /sticky-note: description does not end with a call to action/);
  assert.match(problems[2], /big-numbers: alt text is 9 chars/);
});

test("two variants that open the same way: the second is rejected", () => {
  const dup = { ...good, "sticky-note": { ...good["sticky-note"], pinTitle: "Winter Arc Ideas for Teens: 12 Reset Rituals" } };
  const { copies, problems } = acceptVariantCopy(dup, row, ["bold-panel", "sticky-note"]);
  assert.deepEqual(Object.keys(copies), ["bold-panel"]);
  assert.match(problems[0], /sticky-note: title opens with the same words as the bold-panel title/);
});

test("a long dash anywhere in a set rejects it", () => {
  const dashed = { "bold-panel": { ...good["bold-panel"], pinDescription: good["bold-panel"].pinDescription.replace("so start", "so — start") } };
  const { problems } = acceptVariantCopy(dashed, row, ["bold-panel"]);
  assert.match(problems[0], /long dash/);
});

test("the prompt names each variant's look and angle, the base copy, and the problems of a rejected answer", () => {
  const p = variantCopyPrompt(row, ["sticky-note", "big-numbers"], "RULES", ["sticky-note: alt text is 9 chars (must be 80–140)"]);
  assert.match(p, /sticky-note: a tilted warm-white paper note/);
  assert.match(p, /big-numbers: a two-column numbered list/);
  assert.match(p, /THE PAYOFF/);
  assert.match(p, new RegExp(`Title: ${row.pinTitle}`));
  assert.match(p, /previous answer was rejected/);
  assert.match(p, /"sticky-note": \{"pinTitle"/);
  assert.ok(!p.includes('"bold-panel": {'));
});

test("the schema requires exactly the requested templates", () => {
  const s = variantCopySchema(["sticky-note"]) as { required: string[]; properties: Record<string, unknown> };
  assert.deepEqual(s.required, ["sticky-note"]);
  assert.deepEqual(Object.keys(s.properties), ["sticky-note"]);
});
