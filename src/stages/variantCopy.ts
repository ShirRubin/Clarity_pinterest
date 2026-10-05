// src/stages/variantCopy.ts — `clarity variantcopy [limit]`: write the
// per-variant pin copy (src/variantCopy.ts) for rows that will be packed and
// still share one copy set across their templates, then rewrite any pending
// pack that was written with the base copy. `clarity ship` runs it before
// `pack`; scripts/backfill-variant-copy.ts runs it over the backlog.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateJSON } from "../claude.js";
import { ensureSchemaProperties, listAllPins, updatePin, type PinSummary } from "../notion.js";
import { BRAND_CONTEXT, SEO_RULES, VOICE_EXAMPLE } from "../prompts.js";
import { packCandidate } from "../packRows.js";
import { readPacks, type PackInfo } from "../packs.js";
import { rowForPack } from "../rowForPack.js";
import { replaceAlt, replaceDescription, replaceTitle } from "../packText.js";
import { acceptVariantCopy, copyFor, templatesMissingCopy, variantCopyPrompt, variantCopySchema, type VariantCopy, type VariantCopies } from "../variantCopy.js";

/** One list: ask, check, ask once more with the problems, keep what passed. */
export async function writeVariantCopy(row: PinSummary): Promise<{ written: string[]; problems: string[] }> {
  const templates = templatesMissingCopy(row);
  if (!templates.length) return { written: [], problems: [] };
  const system = `${BRAND_CONTEXT}\n\n${VOICE_EXAMPLE}\n\nYou are Clarity's pin copywriter. The list exists; you write the copy that makes each of its design variants a different pin.`;
  let problems: string[] = [];
  let copies: VariantCopies = {};
  for (let attempt = 0; attempt < 2 && Object.keys(copies).length < templates.length; attempt++) {
    const todo = templates.filter((t) => !copies[t]);
    const out = await generateJSON<Record<string, VariantCopy>>(system, variantCopyPrompt(row, todo, SEO_RULES, problems), variantCopySchema(todo));
    const accepted = acceptVariantCopy(out, { ...row, variantCopy: { ...row.variantCopy, ...copies } }, todo);
    copies = { ...copies, ...accepted.copies };
    problems = accepted.problems;
  }
  if (Object.keys(copies).length) {
    await updatePin(row.pageId, { variantCopy: copies });
    row.variantCopy = { ...row.variantCopy, ...copies };
  }
  return { written: Object.keys(copies), problems };
}

/**
 * Pending packs (not yet exported) whose post.txt still carries the base copy
 * although their row now has a set for that template: rewrite the three
 * sections in place. Posted and exported packs are left alone — Pinterest has
 * them. Returns how many files changed.
 */
export async function applyVariantCopyToPacks(rows: PinSummary[], packs?: PackInfo[]): Promise<number> {
  const pending = (packs ?? (await readPacks("packs"))).filter((p) => !p.text.exported);
  let changed = 0;
  for (const p of pending) {
    const row = rowForPack(p, rows);
    if (!row) continue;
    const c = copyFor(row, p.template);
    if (!c.own) continue;
    if (p.text.title === c.title && p.text.description === c.description && p.text.alt === c.alt) continue;
    const file = path.join(p.path, "post.txt");
    let txt = await readFile(file, "utf8");
    txt = replaceTitle(txt, c.title);
    txt = replaceDescription(txt, c.description);
    txt = replaceAlt(txt, c.alt);
    await writeFile(file, txt, "utf8");
    changed++;
  }
  return changed;
}

export interface VariantCopyOptions {
  limit?: number;
  /** Restrict to these rows (page ids); default: every packable row still missing a set. */
  pageIds?: Set<string>;
  rows?: PinSummary[];
}

export async function runVariantCopy(o: VariantCopyOptions = {}): Promise<{ rows: number; packsRewritten: number }> {
  await ensureSchemaProperties(); // the nine copy columns exist on the live DB from the first run on
  const all = o.rows ?? (await listAllPins());
  const limit = o.limit ?? 50;
  const todo = all.filter((r) => packCandidate(r) && templatesMissingCopy(r).length && (!o.pageIds || o.pageIds.has(r.pageId)));
  if (!todo.length) {
    console.log("Every packable row already has copy for each variant.");
    return { rows: 0, packsRewritten: 0 };
  }
  console.log(`Writing variant copy for ${Math.min(todo.length, limit)} of ${todo.length} rows…`);
  let done = 0;
  for (const row of todo.slice(0, limit)) {
    try {
      const { written, problems } = await writeVariantCopy(row);
      if (written.length) done++;
      console.log(`${written.length ? "✓" : "✗"} ${row.name.slice(0, 60)} → ${written.join(", ") || "nothing accepted"}${problems.length ? ` (${problems.length} problem(s): ${problems[0]})` : ""}`);
    } catch (err) {
      console.error(`✗ ${row.name.slice(0, 60)}: ${(err as Error).message}`);
    }
  }
  const packsRewritten = await applyVariantCopyToPacks(all);
  console.log(`Variant copy: ${done} row(s) written, ${packsRewritten} pending pack(s) rewritten.`);
  return { rows: done, packsRewritten };
}
