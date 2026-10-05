// Per-variant copy for the backlog: every row that still has a pending
// (not yet exported) pack and shares one copy set across its templates gets
// its own title / description / alt per variant (src/variantCopy.ts), nearest
// post date first, and the pending packs are rewritten. Posted and exported
// packs are never touched. One Claude call per list (two on a retry).
//
//   npx tsx scripts/backfill-variant-copy.ts            # report what would run
//   npx tsx scripts/backfill-variant-copy.ts --apply 20 # write the 20 nearest lists
import "dotenv/config";
import { listAllPins } from "../src/notion.js";
import { readPacks } from "../src/packs.js";
import { rowForPack } from "../src/rowForPack.js";
import { templatesMissingCopy } from "../src/variantCopy.js";
import { runVariantCopy } from "../src/stages/variantCopy.js";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.filter((a) => /^\d+$/.test(a))[0];
const limit = limitArg ? parseInt(limitArg, 10) : 20;

const rows = await listAllPins();
const pending = (await readPacks("packs")).filter((p) => !p.text.exported).sort((a, b) => a.date.localeCompare(b.date));
const order: string[] = [];
const seen = new Set<string>();
for (const p of pending) {
  const row = rowForPack(p, rows);
  if (!row || seen.has(row.pageId)) continue;
  seen.add(row.pageId);
  if (templatesMissingCopy(row).length) order.push(row.pageId);
}
console.log(`${order.length} list(s) with pending packs still share one copy set across their variants.`);
const chosen = order.slice(0, limit);
for (const id of chosen) console.log(`  ${rows.find((r) => r.pageId === id)?.name.slice(0, 70)}`);
if (!apply) {
  console.log(`\nDry run — add --apply [n] to write the ${chosen.length} nearest (default 20).`);
  process.exit(0);
}
await runVariantCopy({ limit, pageIds: new Set(chosen), rows });
