// src/stages/copycheck.ts — `clarity copycheck [--fix]`: every waiting pack
// against the copy rules that `clarity csv` enforces (src/copyRules.ts), so a
// failing row is found before it blocks a file. `--fix` repairs the one rule
// that has a safe mechanical fix: a description that only says "save it" gets
// a click-through line naming the full list and the free printable, in the
// pack's post.txt and in the Notion row (so future packs carry it). A long dash
// (rule 4) is fixed too: mechanically in titles, and in descriptions by the
// pipeline's own Claude route, ten lists per call, checked before anything is
// written. A title without its keyword up front, or alt text of the wrong
// length, is listed for a rewrite in Notion.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listAllPins, updatePin } from "../notion.js";
import { readPacks, type PackInfo } from "../packs.js";
import { replaceDescription, replaceTitle } from "../packText.js";
import { rowForPack } from "../rowForPack.js";
import { suggestTopics } from "../topics.js";
import { generateJSON } from "../claude.js";
import { altProblem, ctaProblem, dashProblem, fixTitleDashes, titleKeywordProblem, withClickCta } from "../copyRules.js";

const LONG_DASH = /[\u2013\u2014]/;
const REWRITE_SYSTEM = `You edit Pinterest pin descriptions for Clarity Bucket Lists. House rule: the em dash and en dash never appear. You rewrite each description so that no such dash remains, changing as little as possible: keep every sentence, emoji, hashtag line and the final call to action; keep the meaning and the warm, playful second-person voice; replace each dash with a comma, a colon, a full stop plus a new sentence, or parentheses, whichever reads best. Never use a hyphen, a double hyphen or a semicolon in its place. Return the descriptions exactly as given otherwise.`;
const REWRITE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: { slug: { type: "string" }, description: { type: "string", maxLength: 500 } },
    required: ["slug", "description"],
    additionalProperties: false,
  },
};

/** Descriptions rewritten without long dashes, ten at a time; a bad answer is rejected, never applied. */
async function rewriteWithoutDashes(items: { slug: string; description: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    const user =
      `Rewrite these ${batch.length} descriptions without any em dash or en dash. Reply as a JSON array of {"slug","description"} in the same order.\n\n` +
      batch.map((b) => `slug: ${b.slug}\ndescription:\n${b.description}`).join("\n\n---\n\n");
    const res = await generateJSON<{ slug: string; description: string }[]>(REWRITE_SYSTEM, user, REWRITE_SCHEMA);
    for (const b of batch) {
      const r = Array.isArray(res) ? res.find((x) => x.slug === b.slug) : undefined;
      const next = r?.description?.trim() ?? "";
      const tags = (t: string) => (t.match(/#\w+/g) ?? []).join(" ");
      const why = !next ? "no answer" : LONG_DASH.test(next) ? "dash left" : ctaProblem(next) ? "lost the CTA" : next.length > 500 ? "over 500" : tags(next) !== tags(b.description) ? "hashtags changed" : next.length < b.description.length * 0.8 ? "text shrank" : "";
      if (!why) out.set(b.slug, next);
      else console.warn(`  ? ${b.slug}: rewrite rejected (${why})`);
    }
  }
  return out;
}

export interface CopyCheckResult {
  packs: number;
  lists: number;
  titleFails: string[];
  altFails: string[];
  ctaFails: string[];
  dashFails: string[];
  fixedPacks: number;
  fixedRows: number;
}

export async function runCopyCheck(fix = false): Promise<CopyCheckResult> {
  const [packs, rows] = await Promise.all([readPacks("packs"), listAllPins()]);
  // Packs already written into a csv went out with their copy; leave them.
  const waiting = packs.filter((p) => !p.text.exported);
  const result: CopyCheckResult = { packs: waiting.length, lists: 0, titleFails: [], altFails: [], ctaFails: [], dashFails: [], fixedPacks: 0, fixedRows: 0 };

  const bySlug = new Map<string, PackInfo[]>();
  for (const p of waiting) bySlug.set(p.slug, [...(bySlug.get(p.slug) ?? []), p]);
  result.lists = bySlug.size;

  // Rule 4 first: the dash rewrites (titles now, descriptions in batches) feed the
  // text the other rules are judged on, so one pass sees the final copy.
  const copyOf = (g: PackInfo[]) => ({ title: g[0].text.title, description: g[0].text.description, alt: g[0].text.alt });
  const dashed = [...bySlug].filter(([, g]) => dashProblem(copyOf(g)));
  for (const [slug, g] of dashed) result.dashFails.push(`${slug}: ${dashProblem(copyOf(g))}`);
  const newTitles = new Map<string, string>();
  let newDescs = new Map<string, string>();
  if (fix && dashed.length) {
    for (const [slug, g] of dashed) {
      if (LONG_DASH.test(g[0].text.title)) newTitles.set(slug, fixTitleDashes(g[0].text.title));
    }
    const descItems = dashed.filter(([, g]) => LONG_DASH.test(g[0].text.description)).map(([slug, g]) => ({ slug, description: g[0].text.description }));
    if (descItems.length) {
      console.log(`rewriting ${descItems.length} description(s) without the long dash (${Math.ceil(descItems.length / 10)} model call(s))...`);
      newDescs = await rewriteWithoutDashes(descItems);
    }
  }

  const fixedRowIds = new Set<string>();
  for (const [slug, group] of bySlug) {
    const first = group[0];
    const row = rowForPack(first, rows);
    const keywords = row?.keywords?.length ? row.keywords : suggestTopics(row?.listItems ?? "", row?.theme);
    const patch: Record<string, string> = {};
    if (newTitles.has(slug)) {
      const t = newTitles.get(slug)!;
      for (const p of group) {
        const file = path.join(p.path, "post.txt");
        await writeFile(file, replaceTitle(await readFile(file, "utf8"), t), "utf8");
        p.text.title = t;
      }
      patch.pinTitle = t;
    }
    if (newDescs.has(slug)) {
      const d = newDescs.get(slug)!;
      for (const p of group) {
        const file = path.join(p.path, "post.txt");
        await writeFile(file, replaceDescription(await readFile(file, "utf8"), d), "utf8");
        p.text.description = d;
      }
      patch.pinDescription = d;
    }
    if (Object.keys(patch).length) {
      result.fixedPacks += group.length;
      const pageId = first.text.pageId ?? row?.pageId;
      if (pageId && !fixedRowIds.has(pageId)) { await updatePin(pageId, patch); fixedRowIds.add(pageId); result.fixedRows++; }
    }

    const t = titleKeywordProblem(first.text.title, keywords);
    if (t) result.titleFails.push(`${slug}: ${t}`);
    const a = altProblem(first.text.alt);
    if (a) result.altFails.push(`${slug}: ${a}`);
    const c = ctaProblem(first.text.description);
    if (c) {
      result.ctaFails.push(`${slug}: ${c}`);
      if (fix) {
        const next = withClickCta(first.text.description, slug);
        for (const p of group) {
          const file = path.join(p.path, "post.txt");
          await writeFile(file, replaceDescription(await readFile(file, "utf8"), next), "utf8");
          result.fixedPacks++;
        }
        const pageId = first.text.pageId ?? row?.pageId;
        if (pageId && !fixedRowIds.has(pageId)) {
          await updatePin(pageId, { pinDescription: next });
          fixedRowIds.add(pageId);
          result.fixedRows++;
        }
      }
    }
  }

  const say = (label: string, fails: string[]) => {
    console.log(`\n${label}: ${fails.length ? `${fails.length} failing` : "all pass"}`);
    for (const f of fails) console.log(`  ✗ ${f}`);
  };
  console.log(`Copy rules over ${result.packs} waiting pack(s), ${result.lists} list(s)`);
  say("1. keyword in the first 40 title characters (rewrite the title or keywords in Notion, then re-pack)", result.titleFails);
  say("2. alt text 80–140 characters (rewrite in Notion, then re-pack)", result.altFails);
  say(fix ? "3. click CTA naming the post (fixed below)" : "3. click CTA naming the post (run with --fix to append one)", result.ctaFails);
  say(fix ? "4. no long dash in title, description or alt (fixed below where the rewrite passed)" : "4. no long dash in title, description or alt (run with --fix: titles mechanically, descriptions via the model)", result.dashFails);
  if (fix) {
    console.log(`\n✓ fixed copy on ${result.fixedPacks} pack(s) and ${result.fixedRows} Notion row(s); run \`clarity copycheck\` again to confirm all pass`);
  } else if (result.ctaFails.length) {
    console.log(`\nRun \`clarity copycheck --fix\` to append a click CTA to those ${result.ctaFails.length} list(s) (packs + Notion).`);
  }
  return result;
}
