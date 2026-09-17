// One-off (2026-09-17): fill the per-template date columns on every Notion row
// from the packs already in exports/posted/ — each pack directory is
// <date>--<slug>--<template>, so the date column for that template is the
// pack date. Empty columns only; a value already on the row wins. Dry run by
// default, `--apply` writes. Safe to re-run.
//
//   npx tsx scripts/backfill-variants.ts            # report
//   npx tsx scripts/backfill-variants.ts --apply    # write
import "dotenv/config";
import { listAllPins, updatePin, ensureSchemaProperties } from "../src/notion.js";
import { readPacks } from "../src/packs.js";
import { rowForPack } from "../src/rowForPack.js";
import { VARIANT_COLUMNS } from "../src/variants.js";

const apply = process.argv.includes("--apply");

await ensureSchemaProperties(); // adds the four date properties on first run
const rows = await listAllPins();
const posted = await readPacks("posted");

const byRow = new Map<string, Record<string, string>>();
let orphans = 0;
for (const pack of posted) {
  if (!(VARIANT_COLUMNS as readonly string[]).includes(pack.template)) continue;
  const row = rowForPack(pack, rows);
  if (!row) {
    orphans++;
    console.log(`  ? no row for ${pack.dir}`);
    continue;
  }
  if (row.variants[pack.template]) continue; // already recorded
  const cur = byRow.get(row.pageId) ?? {};
  // Two packs for the same template (a re-dated duplicate) — keep the earliest.
  if (!cur[pack.template] || pack.date < cur[pack.template]) cur[pack.template] = pack.date;
  byRow.set(row.pageId, cur);
}

const names = new Map(rows.map((r) => [r.pageId, r.name]));
let cols = 0;
for (const [pageId, variants] of byRow) {
  cols += Object.keys(variants).length;
  console.log(`${apply ? "✓" : "·"} ${(names.get(pageId) ?? pageId).slice(0, 55).padEnd(55)} ${Object.entries(variants).map(([t, d]) => `${t}=${d}`).join("  ")}`);
  if (apply) await updatePin(pageId, { variants });
}
console.log(
  `\n${posted.length} posted packs → ${cols} column(s) on ${byRow.size} row(s)${orphans ? `, ${orphans} pack(s) without a row` : ""}` +
    (apply ? " — written." : " — dry run, add --apply to write."),
);
