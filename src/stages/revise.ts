// Revise stage — "Needs changes" → Drafted → (design → review) → In Review.
//
// The review page's third verdict ("Needs changes") parks a row here with the
// reviewer's notes appended to Notes as `revise <date>: <what to fix>`. This
// stage feeds the CURRENT list plus that feedback back to the model, asks for a
// targeted rewrite rather than a fresh list, and returns the row to Drafted so
// the existing design + review stages re-render it and put it back in the queue.
//
// The applied request is retagged `revised <date>:` so a second pass only ever
// acts on feedback written since the last rewrite.
import { generateJSON } from "../claude.js";
import { pinsByStatus, updatePin } from "../notion.js";
import { BRAND_CONTEXT, SEO_RULES, VOICE_EXAMPLE } from "../prompts.js";
import { DRAFT_SCHEMA, type DraftOut } from "./draft.js";
import { runDesign } from "./design.js";
import { runReview } from "./review.js";

// `revise 2026-09-02: ...` but never `revised 2026-09-02: ...` — the space
// after "revise" is what keeps an already-applied entry from matching again.
const PENDING = /revise (\d{4}-\d{2}-\d{2}): /g;

/** The newest not-yet-applied revision request in a row's Notes, if any. */
export function pendingRequest(notes?: string): string | undefined {
  if (!notes) return undefined;
  let last: RegExpExecArray | null = null;
  for (let m = PENDING.exec(notes); m; m = PENDING.exec(notes)) last = m;
  PENDING.lastIndex = 0;
  if (!last) return undefined;
  const rest = notes.slice(last.index + last[0].length);
  const end = rest.indexOf(" | ");
  return (end === -1 ? rest : rest.slice(0, end)).trim() || undefined;
}

/** Retag the applied request so the next run doesn't act on it a second time. */
export function markApplied(notes: string, request: string): string {
  const at = notes.lastIndexOf(`: ${request}`);
  if (at === -1) return notes;
  const head = notes.slice(0, at);
  const marker = head.lastIndexOf("revise ");
  if (marker === -1) return notes;
  return `${notes.slice(0, marker)}revised ${notes.slice(marker + "revise ".length)}`;
}

export async function runRevise(limit = 10, chain = true): Promise<void> {
  const rows = await pinsByStatus("Needs changes");
  if (!rows.length) {
    console.log('No rows in status "Needs changes" — nothing to revise.');
    return;
  }
  console.log(`Revising ${Math.min(rows.length, limit)} of ${rows.length} lists…`);

  const system = `${BRAND_CONTEXT}\n\n${VOICE_EXAMPLE}\n\nYou are Clarity's list editor. A human reviewer read this list and asked for specific changes. Make exactly those changes and leave everything else alone — this is an edit, not a rewrite from scratch.`;

  let revised = 0;
  for (const row of rows.slice(0, limit)) {
    const request = pendingRequest(row.notes);
    if (!request) {
      console.warn(`⚠ Skipping "${row.name}" — no \`revise <date>:\` note to act on.`);
      continue;
    }

    const user = `Revise this bucket list according to the reviewer's notes.

CURRENT TITLE: ${row.name}
CURRENT PIN TITLE: ${row.pinTitle ?? "-"}
CURRENT PIN DESCRIPTION: ${row.pinDescription ?? "-"}
CURRENT ALT TEXT: ${row.altText ?? "-"}
CURRENT LIST:
${row.listItems ?? "(none)"}

REVIEWER'S NOTES — what to change:
${request}

Rules:
- Address every point in the reviewer's notes. Keep the items and copy they did not complain about as close to the current version as possible.
- Keep 10-15 items in the Clarity voice: "**Short bold action** — one or two specific, doable sentences."
- The FINAL item stays the open slot: "#<n> — your turn. What would you add?"
- If the notes only concern the copy (title/description/alt), keep the list items unchanged.
${SEO_RULES}

The pin image is a pastel checklist graphic showing the list title and the bold action heads — altText describes THAT image.

Reply with ONLY a JSON object:
{"listItems": ["**...** — ...", ...], "pinTitle": "40-60 chars, keyword in first 40", "pinDescription": "2-3 sentences + CTA, then 3-5 hashtags at the end", "altText": "80-140 chars describing the pin image", "keywords": ["...", ...]}`;

    try {
      const draft = await generateJSON<DraftOut>(system, user, DRAFT_SCHEMA);
      await updatePin(row.pageId, {
        status: "Drafted",
        listItems: draft.listItems.map((item, i) => `${i + 1}. ${item}`).join("\n"),
        pinTitle: draft.pinTitle?.slice(0, 100) ?? row.pinTitle,
        pinDescription: draft.pinDescription,
        altText: draft.altText?.slice(0, 160),
        keywords: (draft.keywords ?? []).slice(0, 8).map((k) => k.slice(0, 100)),
        notes: markApplied(row.notes ?? "", request),
      });
      revised++;
      console.log(`✓ Revised: ${row.name}\n    asked: ${request.slice(0, 90)}`);
    } catch (err) {
      console.error(`✗ Failed to revise "${row.name}": ${(err as Error).message}`);
    }
  }

  if (!revised) {
    console.log("Nothing revised.");
    return;
  }
  if (!chain) {
    console.log(`${revised} back in Drafted — run \`clarity design\` then \`clarity review\`.`);
    return;
  }
  console.log(`\nRe-rendering ${revised} revised list(s)…`);
  await runDesign(revised);
  await runReview(revised);
  console.log("\nRevised lists are back In Review — run `clarity approve` to look again.");
}
