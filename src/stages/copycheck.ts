// src/stages/copycheck.ts — `clarity copycheck [--fix]`: every waiting pack
// against the copy rules that `clarity csv` enforces (src/copyRules.ts), so a
// failing row is found before it blocks a file. `--fix` repairs the one rule
// that has a safe mechanical fix: a description that only says "save it" gets
// a click-through line naming the full list and the free printable, in the
// pack's post.txt and in the Notion row (so future packs carry it). A title
// without its keyword up front, or alt text of the wrong length, is listed for
// a rewrite in Notion.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listAllPins, updatePin } from "../notion.js";
import { readPacks, type PackInfo } from "../packs.js";
import { replaceDescription } from "../packText.js";
import { rowForPack } from "../rowForPack.js";
import { suggestTopics } from "../topics.js";
import { altProblem, ctaProblem, titleKeywordProblem, withClickCta } from "../copyRules.js";

export interface CopyCheckResult {
  packs: number;
  lists: number;
  titleFails: string[];
  altFails: string[];
  ctaFails: string[];
  fixedPacks: number;
  fixedRows: number;
}

export async function runCopyCheck(fix = false): Promise<CopyCheckResult> {
  const [packs, rows] = await Promise.all([readPacks("packs"), listAllPins()]);
  // Packs already written into a csv went out with their copy; leave them.
  const waiting = packs.filter((p) => !p.text.exported);
  const result: CopyCheckResult = { packs: waiting.length, lists: 0, titleFails: [], altFails: [], ctaFails: [], fixedPacks: 0, fixedRows: 0 };

  const bySlug = new Map<string, PackInfo[]>();
  for (const p of waiting) bySlug.set(p.slug, [...(bySlug.get(p.slug) ?? []), p]);
  result.lists = bySlug.size;

  const fixedRowIds = new Set<string>();
  for (const [slug, group] of bySlug) {
    const first = group[0];
    const row = rowForPack(first, rows);
    const keywords = row?.keywords?.length ? row.keywords : suggestTopics(row?.listItems ?? "", row?.theme);

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
  if (fix) {
    console.log(`\n✓ appended a click CTA to ${result.fixedPacks} pack(s) and ${result.fixedRows} Notion row(s)`);
  } else if (result.ctaFails.length) {
    console.log(`\nRun \`clarity copycheck --fix\` to append a click CTA to those ${result.ctaFails.length} list(s) (packs + Notion).`);
  }
  return result;
}
