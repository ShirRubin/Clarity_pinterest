import { test } from "node:test";
import assert from "node:assert/strict";
import {
  altProblem,
  checkCopy,
  ctaProblem,
  ctaVariantFor,
  CTA_VARIANTS,
  dashProblem,
  fixTitleDashes,
  descriptionBody,
  hashtagLine,
  lastSentence,
  titleKeywordProblem,
  withClickCta,
} from "../src/copyRules.js";

const GOOD_ALT = "Pastel checklist graphic titled Winter Arc Bucket List with 14 rituals for a cozy, focused winter";

// --- rule 1: keyword in the first 40 characters of the title ---

test("a keyword phrase inside the first 40 title characters passes, punctuation and case aside", () => {
  assert.equal(titleKeywordProblem("Christmas Movie Advent Bucket List: 24 Films", ["christmas movie advent bucket list"]), undefined);
  assert.equal(titleKeywordProblem("Tea Bucket List: 12 Brews", ["cozy tea", "TEA BUCKET LIST"]), undefined);
});

test("apostrophes and ampersands in the title do not hide a plainly written keyword", () => {
  assert.equal(titleKeywordProblem("New Year's Eve Bucket List: 12 Glam Ways", ["new years eve bucket list"]), undefined);
  assert.equal(titleKeywordProblem("Lilo & Stitch Bucket List: 12 Ohana Days", ["lilo and stitch bucket list"]), undefined);
});

test("a keyword that only appears after character 40 fails, and so does a title with no keywords", () => {
  const p = titleKeywordProblem("Twelve Sweet Things to Do Together This Autumn: Mother-Daughter Bucket List", ["mother-daughter bucket list"]);
  assert.match(p ?? "", /first 40/);
  assert.match(titleKeywordProblem("Anything", []) ?? "", /no keywords/);
});

// --- rule 2: alt text 80–140 ---

test("alt text between 80 and 140 characters passes; shorter or longer fails with the count", () => {
  assert.equal(altProblem(GOOD_ALT), undefined);
  assert.match(altProblem("a checklist") ?? "", /11 chars/);
  assert.match(altProblem("x".repeat(141)) ?? "", /141 chars/);
});

// --- rule 3: the description ends with a click CTA that names what is on the post ---

test("the hashtag line is set aside and the last sentence of the body is what gets judged", () => {
  const d = "Cozy rituals for December 🎄 Save it before the month starts.\n#bucketlist #cozywinter";
  assert.equal(hashtagLine(d), "#bucketlist #cozywinter");
  assert.equal(descriptionBody(d), "Cozy rituals for December 🎄 Save it before the month starts.");
  assert.equal(lastSentence(d), "Save it before the month starts.");
});

test("'Save it' alone is not a click CTA; naming the blog, the full list or the printable is", () => {
  assert.match(ctaProblem("Twelve films for December. Save it before December starts ✨\n#tags") ?? "", /call to action/);
  assert.equal(ctaProblem("Twelve films for December. Save it, the full list and a free printable checklist are on the blog.\n#tags"), undefined);
  assert.equal(ctaProblem("Twelve films for December. Tap through for the free printable."), undefined);
  assert.equal(ctaProblem("Twelve films for December. Every item plus the printable is on the blog."), undefined);
});

test("a description whose last sentence is only an emoji is judged on the sentence before it", () => {
  assert.match(ctaProblem("Save it for later 🌌") ?? "", /call to action/);
  assert.equal(ctaProblem("Grab the full list on the blog 🌌"), undefined);
});

// --- the fix ---

test("withClickCta leaves a passing description alone", () => {
  const d = "Full list and free printable checklist on the blog.\n#a #b";
  assert.equal(withClickCta(d, "any-slug"), d);
});

test("withClickCta appends the slug's variant to the body, ahead of the hashtags", () => {
  const d = "Cozy rituals for December 🎄 Save it before the month starts.\n#bucketlist #cozywinter";
  const out = withClickCta(d, "the-winter-arc-bucket-list");
  const variant = ctaVariantFor("the-winter-arc-bucket-list");
  assert.ok(CTA_VARIANTS.includes(variant));
  assert.equal(out, `Cozy rituals for December 🎄 Save it before the month starts. ${variant}\n#bucketlist #cozywinter`);
  assert.equal(ctaProblem(out), undefined);
});

test("the variant is stable per slug and differs across slugs", () => {
  assert.equal(ctaVariantFor("a-list"), ctaVariantFor("a-list"));
  const picks = new Set(["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "g-list", "h-list"].map(ctaVariantFor));
  assert.ok(picks.size > 1);
});

// --- rule 4: no long dash in pin copy ---

test("a long dash anywhere in the title, description or alt fails and says where", () => {
  assert.match(dashProblem({ title: "Lilo & Stitch Bucket List — 12 Ohana Days", description: "Fine.", alt: "Fine" }) ?? "", /title/);
  assert.match(dashProblem({ title: "Fine", description: "Twelve films — one a night.", alt: "Fine" }) ?? "", /description/);
  assert.match(dashProblem({ title: "Fine", description: "Fine.", alt: "5–10 vials" }) ?? "", /alt/);
  assert.equal(dashProblem({ title: "Fine: yes", description: "Fine, yes.", alt: "Fine" }), undefined);
});

test("fixTitleDashes turns the title's dash into a colon, or 'to' between numbers", () => {
  assert.equal(fixTitleDashes("Lilo & Stitch Bucket List — 12 Ohana Days"), "Lilo & Stitch Bucket List: 12 Ohana Days");
  assert.equal(fixTitleDashes("Movement Bucket List – 10–15 Minute Wins"), "Movement Bucket List: 10 to 15 Minute Wins");
  assert.equal(fixTitleDashes("Plain Title: No Dash"), "Plain Title: No Dash");
});

// --- all four at once ---

test("checkCopy lists every broken rule and is empty for good copy", () => {
  const bad = checkCopy({ title: "Nice — list", description: "Save it.", alt: "short", keywords: ["tea bucket list"] });
  assert.equal(bad.length, 4);
  const good = checkCopy({
    title: "Tea Bucket List: 12 Brews to Try",
    description: "Twelve brews. Full list and free printable checklist on the blog.\n#tea",
    alt: GOOD_ALT,
    keywords: ["tea bucket list"],
  });
  assert.deepEqual(good, []);
});
