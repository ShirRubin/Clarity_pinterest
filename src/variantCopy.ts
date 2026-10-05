// src/variantCopy.ts — one set of pin copy PER DESIGN VARIANT. Pure; the
// stage (src/stages/variantCopy.ts) talks to Claude and Notion.
//
// Growth review, Oct 5 2026 (plan §1): 113 of 135 lists shipped the same
// title, description, alt text and hashtags on all four variants, so the
// four "fresh pins" read as one pin posted four times (Pinterest's own board
// feeds show the description three times in a row, and the bulk-upload
// validator refuses repeated titles inside a file). A variant is only fresh
// when what it SAYS is new too. The first template keeps the row's base
// copy; every other template gets its own angle, stored in Notion columns
// named "<field> · <template>" (same pattern as the per-template date
// columns in src/variants.ts) so the row stays the single source of truth.
import { TEMPLATE_NAMES, type TemplateName } from "./templates.js";
import { checkCopy, normalize } from "./copyRules.js";

/** The template that uses the row's base "Pin title" / "Pin description" / "Alt text". */
export const PRIMARY_TEMPLATE: TemplateName = TEMPLATE_NAMES[0];
/** Templates that carry their own copy columns. */
export const SECONDARY_TEMPLATES: TemplateName[] = TEMPLATE_NAMES.slice(1);

export type CopyField = "Pin title" | "Pin description" | "Alt text";
export const COPY_FIELDS: CopyField[] = ["Pin title", "Pin description", "Alt text"];

/** Notion property name for one field of one secondary template. */
export const variantCopyColumn = (field: CopyField, template: string) => `${field} · ${template}`;

export interface VariantCopy {
  pinTitle?: string;
  pinDescription?: string;
  altText?: string;
}
/** template → its copy; only secondary templates ever appear here. */
export type VariantCopies = Partial<Record<string, VariantCopy>>;

type CopyRow = {
  name: string;
  pinTitle?: string;
  pinDescription?: string;
  altText?: string;
  keywords?: string[];
  variantCopy?: VariantCopies;
};

/** How each template looks, for alt text that describes THAT image. Mirrors DESIGN.md. */
export const VARIANT_LOOKS: Record<TemplateName, string> = {
  "classic-checklist": "a pastel gradient checklist graphic: big rounded uppercase title, a BUCKET LIST subtitle, hand-lettered items with round checkboxes, a faded emoji in the corner",
  "bold-panel": "a white card floating on a pastel gradient: left-aligned bold title, a solid BUCKET LIST pill chip, the checklist inside the card with filled checkboxes",
  "sticky-note": "a tilted warm-white paper note with a striped tape strip and a sticker emoji on its corner, centred uppercase title, wonky hand-drawn checkboxes",
  "big-numbers": "a two-column numbered list with large 01 to 14 numerals and no checkboxes, left-aligned title under a small BUCKET LIST kicker, a coloured rule",
};

/** The angle each secondary template's copy takes, so the four pins answer four searches, not one. */
export const VARIANT_ANGLES: Record<string, string> = {
  "bold-panel": "WHO or WHEN: the same list framed for a specific reader or moment (for couples, for teens, for college students, this weekend, before the year ends), with that phrase inside the first 40 characters",
  "sticky-note": "THE PAYOFF: lead with the outcome or feeling the list delivers and a different number phrasing (e.g. the count of items, or 'things to do', 'ideas', 'checklist'), using a secondary keyword as the opener",
  "big-numbers": "THE SEARCH PHRASE ITSELF: open with the head term people type (\"<topic> bucket list ideas\", \"<topic> things to do\", \"<topic> checklist\") then a concrete promise, so the title reads like a search result",
};

const complete = (c?: VariantCopy): c is Required<VariantCopy> => !!c?.pinTitle && !!c?.pinDescription && !!c?.altText;

/** Secondary templates on this row that still have no complete copy set. */
export function templatesMissingCopy(row: Pick<CopyRow, "variantCopy">): TemplateName[] {
  return SECONDARY_TEMPLATES.filter((t) => !complete(row.variantCopy?.[t]));
}

/** The copy a pack of `template` carries: the variant's own set, or the base copy as the fallback. */
export function copyFor(row: CopyRow, template: string): { title: string; description: string; alt: string; own: boolean } {
  const v = row.variantCopy?.[template];
  if (template !== PRIMARY_TEMPLATE && complete(v)) {
    return { title: v.pinTitle, description: v.pinDescription, alt: v.altText, own: true };
  }
  return { title: row.pinTitle ?? row.name, description: row.pinDescription ?? "", alt: row.altText ?? "", own: false };
}

export function variantCopySchema(templates: string[]): Record<string, unknown> {
  const one = {
    type: "object",
    properties: {
      pinTitle: { type: "string", maxLength: 100 },
      pinDescription: { type: "string", maxLength: 500 },
      altText: { type: "string", maxLength: 160 },
    },
    required: ["pinTitle", "pinDescription", "altText"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: Object.fromEntries(templates.map((t) => [t, one])),
    required: templates,
    additionalProperties: false,
  };
}

export function variantCopyPrompt(row: CopyRow, templates: TemplateName[], seoRules: string, problems: string[] = []): string {
  const looks = templates.map((t) => `- ${t}: ${VARIANT_LOOKS[t]}\n  angle: ${VARIANT_ANGLES[t] ?? "a clearly different angle from the base copy"}`).join("\n");
  return `This bucket list already has its pin copy (below). The SAME list is also pinned on ${templates.length} more design variant${templates.length > 1 ? "s" : ""}, and Pinterest treats identical copy on several pins as one pin posted again. Write a DIFFERENT title, description and alt text for each variant: a different search angle, a different opening sentence, a different secondary keyword, at least two different hashtags. Do NOT rewrite the list.

List: ${row.name}
Keywords the pins target (at least one must sit inside the first 40 characters of every title): ${(row.keywords ?? []).join(" | ") || "(none recorded: use the list's topic words)"}

BASE COPY (used by the first variant; every new title must start with different words than this one and than each other):
Title: ${row.pinTitle ?? row.name}
Description: ${row.pinDescription ?? ""}
Alt text: ${row.altText ?? ""}

The variants and what each one's copy should do:
${looks}

Rules for every set:
- Title 40-60 characters (hard cap 100), a target keyword inside the first 40, no emoji, and the first three words must differ from the base title and from the other variants.
- Description 2-3 natural sentences (150-300 characters before hashtags) that open differently from the base, then a LAST sentence that is a click call to action naming the full list and the free printable checklist at clarity-lists.com, then 3-5 hashtags on one line.
- Alt text 80-140 characters literally describing THAT variant's image (its look above) with the list title in it.
- Never an em dash or en dash anywhere (use a colon, comma or full stop). No keyword stuffing.
${seoRules}
${problems.length ? `\nYour previous answer was rejected for these reasons; fix every one:\n${problems.map((p) => `- ${p}`).join("\n")}` : ""}
Reply with ONLY a JSON object keyed by template name:
{${templates.map((t) => `"${t}": {"pinTitle": "...", "pinDescription": "... #tag #tag", "altText": "..."}`).join(", ")}}`;
}

const opener = (title: string) => normalize(title).split(" ").slice(0, 3).join(" ");

/**
 * Check the model's answer against the copy rules and the distinctness rule.
 * Returns the sets that passed and one problem line per failure, so a retry
 * can quote them back; a template with any problem is left out of `copies`.
 */
export function acceptVariantCopy(
  out: Record<string, VariantCopy>,
  row: CopyRow,
  templates: TemplateName[],
): { copies: VariantCopies; problems: string[] } {
  const copies: VariantCopies = {};
  const problems: string[] = [];
  const keywords = row.keywords ?? [];
  const openers = new Map<string, string>([["base title", opener(row.pinTitle ?? row.name)]]);
  for (const t of templates) {
    const c = out[t];
    if (!complete(c)) {
      problems.push(`${t}: missing a title, description or alt text`);
      continue;
    }
    const title = c.pinTitle.trim();
    const own: string[] = [];
    if (title.length > 100) own.push("title over 100 characters");
    for (const p of checkCopy({ title, description: c.pinDescription, alt: c.altText, keywords })) own.push(p);
    const o = opener(title);
    for (const [who, other] of openers) if (o === other) own.push(`title opens with the same words as the ${who} ("${title.slice(0, 40)}")`);
    if (normalize(c.pinDescription).startsWith(normalize(row.pinDescription ?? "").slice(0, 40)) && (row.pinDescription ?? "").length > 20) {
      own.push("description opens exactly like the base description");
    }
    if (own.length) {
      problems.push(...own.map((p) => `${t}: ${p}`));
      continue;
    }
    openers.set(`${t} title`, o);
    copies[t] = { pinTitle: title, pinDescription: c.pinDescription.trim(), altText: c.altText.trim() };
  }
  return { copies, problems };
}
