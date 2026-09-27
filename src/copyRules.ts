// src/copyRules.ts — the copy rules every pin has to pass before it can reach a
// CSV (AFFILIATE_PLAN.md, Phase 0.3). Pure: no I/O, so csv.ts, the copycheck
// command and the tests all call the same functions.
//
//   1. A target keyword appears inside the first 40 characters of the title
//      (mobile feeds clip titles around there).
//   2. Alt text is 80–140 characters (Pinterest cross-checks it against the image).
//   3. The description's last sentence, before the hashtags, is a call to
//      action that names what is on the post — the click has to be earned:
//      "Full list + free printable checklist on the blog", not just "Save it".
//   4. No long dash (em or en) anywhere in the title, description or alt text;
//      the house rule from the blog (Sep 27), extended to pin copy the same night.

export const TITLE_KEYWORD_WINDOW = 40;
export const ALT_MIN = 80;
export const ALT_MAX = 140;

const CTA_VERB = /\b(save|tap|click|grab|get|read|see|find|open|download|head|go|visit|check|print|browse|start)\b/i;
const DESTINATION = /\b(blog|post|printable|checklist|pdf|link|full list|article|site|website|guide)\b/i;
const ON_THE = /\bon the (blog|post|site)\b/i;

export interface PinCopy {
  title: string;
  description: string;
  alt: string;
  keywords: string[];
}

/**
 * Lower-case, letters and digits only, single spaces: how phrases are compared.
 * Apostrophes vanish ("year's" = "years") and "&" reads as "and", so a keyword
 * written the plain way still matches a styled title.
 */
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The description without its hashtag line(s), one paragraph. */
export function descriptionBody(description: string): string {
  return description
    .split("\n")
    .filter((l) => !/^\s*(#\S+\s*)+$/.test(l))
    .join(" ")
    .replace(/(^|\s)#\w+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The hashtag line(s) at the end of a description, "" when there are none. */
export function hashtagLine(description: string): string {
  return description
    .split("\n")
    .filter((l) => /^\s*(#\S+\s*)+$/.test(l))
    .join(" ")
    .trim();
}

/** Split on sentence ends; a trailing emoji counts as an end too. */
export function sentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|(?<=[☀-➿\u{1F300}-\u{1FAFF}])\s+(?=[A-Z])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function lastSentence(description: string): string {
  const s = sentences(descriptionBody(description));
  return s[s.length - 1] ?? "";
}

export function titleKeywordProblem(title: string, keywords: string[]): string | undefined {
  const kws = keywords.map(normalize).filter(Boolean);
  if (!kws.length) return "no keywords to check the title against";
  const head = normalize(title.slice(0, TITLE_KEYWORD_WINDOW));
  if (kws.some((k) => head.includes(k))) return undefined;
  return `no keyword in the first ${TITLE_KEYWORD_WINDOW} characters of the title ("${title.slice(0, TITLE_KEYWORD_WINDOW)}"; keywords: ${keywords.join(" | ")})`;
}

export function altProblem(alt: string): string | undefined {
  const n = alt.trim().length;
  if (n < ALT_MIN || n > ALT_MAX) return `alt text is ${n} chars (must be ${ALT_MIN}–${ALT_MAX})`;
  return undefined;
}

export function isClickCta(sentence: string): boolean {
  return DESTINATION.test(sentence) && (CTA_VERB.test(sentence) || ON_THE.test(sentence));
}

export function ctaProblem(description: string): string | undefined {
  const last = lastSentence(description);
  if (!last) return "description is empty";
  if (isClickCta(last)) return undefined;
  return `description does not end with a call to action that names what is on the post (last sentence: "${last}")`;
}

const LONG_DASH = /[–—]/;

/** Rule 4: the long dash never ships in pin copy. */
export function dashProblem(c: Pick<PinCopy, "title" | "description" | "alt">): string | undefined {
  const where = (["title", "description", "alt"] as const).filter((k) => LONG_DASH.test(c[k]));
  return where.length ? `long dash in the ${where.join(" and ")} (use a colon, comma or full stop)` : undefined;
}

/**
 * Titles are formulaic ("Name — 12 things"), so the dash has one safe mechanical
 * fix: a spaced dash becomes a colon, a dash between numbers becomes "to", any
 * other dash a comma. Descriptions are prose and get rewritten by the model.
 */
export function fixTitleDashes(title: string): string {
  return title
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2")
    .replace(/\s*[–—]\s*/g, ": ")
    .replace(/:\s*:/g, ":")
    .trim();
}

/** Every rule a pin's copy breaks, in one list; empty means it may ship. */
export function checkCopy(c: PinCopy): string[] {
  return [titleKeywordProblem(c.title, c.keywords), altProblem(c.alt), ctaProblem(c.description), dashProblem(c)].filter(
    (p): p is string => !!p,
  );
}

/**
 * Click-through lines for descriptions that only say "save it". Every post has
 * the full list and a free printable, so each variant is true of every pin.
 * Rotated by slug so the account does not repeat one sentence on every pin.
 */
export const CTA_VARIANTS = [
  "The full list and a free printable checklist are on the blog.",
  "Tap through for the full list and the free printable checklist.",
  "Every item plus a free printable checklist is waiting on the blog.",
  "Full list and free printable checklist on the blog, one tap away.",
];

export function ctaVariantFor(slug: string): string {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CTA_VARIANTS[h % CTA_VARIANTS.length];
}

/**
 * A description that already ends with a click CTA is returned unchanged;
 * otherwise the slug's variant is appended to the body, ahead of the hashtags.
 */
export function withClickCta(description: string, slug: string): string {
  if (!ctaProblem(description)) return description;
  const body = descriptionBody(description);
  const tags = hashtagLine(description);
  const joined = `${body} ${ctaVariantFor(slug)}`.trim();
  return tags ? `${joined}\n${tags}` : joined;
}
