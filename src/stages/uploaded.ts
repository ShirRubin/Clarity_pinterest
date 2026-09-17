// src/stages/uploaded.ts — `clarity uploaded <csv-file>`: the bookkeeping for a
// whole bulk-upload batch, run once the file is in Pinterest's importer. Every
// pack that `clarity csv` wrote into that file moves to exports/posted/ with a
// POSTED: … csv line, and its row flips to Scheduled when all variants are in.
// Pinterest does not report pin ids for an upload; `clarity reconcile --apply`
// backfills them (and the row's Pin URL) once the pins show up in its lists.
import { appendFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { listAllPins, ensureStatusOptions, ensureSchemaProperties } from "../notion.js";
import { readPacks } from "../packs.js";
import { rowForPack } from "../rowForPack.js";
import { settleRow } from "./posted.js";

export async function runUploaded(csvFile: string): Promise<void> {
  const file = path.basename(csvFile);
  const pending = await readPacks("packs");
  const batch = pending.filter((p) => p.text.exported?.file === file);
  if (!batch.length) {
    throw new Error(`No pack in exports/packs/ was exported to ${file} — run \`clarity csv\` first, or was this batch already recorded?`);
  }

  await ensureStatusOptions();
  await ensureSchemaProperties(); // the per-template date columns
  const rows = await listAllPins();
  const today = new Date().toISOString().slice(0, 10);

  await mkdir(path.join("exports", "posted"), { recursive: true });
  const stamp = new Date().toISOString();
  for (const pack of batch) {
    const dest = path.join("exports", "posted", pack.dir);
    await rename(pack.path, dest);
    await appendFile(path.join(dest, "post.txt"), `\nPOSTED: ${stamp} csv ${file}\n`, "utf8");
    console.log(`✓ moved to exports/posted/${pack.dir}`);
  }

  // One Notion write per row, after every pack of the batch is on disk.
  const moved = new Set(batch.map((p) => p.dir));
  const stillPending = pending.filter((p) => !moved.has(p.dir));
  const rowIds = new Set<string>();
  let unmatched = 0;
  for (const pack of batch) {
    const row = rowForPack(pack, rows);
    if (!row) {
      unmatched++;
      console.log(`⚠ ${pack.dir}: no Notion row — add a PAGE: line to its post.txt and rerun`);
      continue;
    }
    if (rowIds.has(row.pageId)) continue;
    rowIds.add(row.pageId);
    const templates = batch.filter((p) => rowForPack(p, rows)?.pageId === row.pageId).map((p) => p.template);
    await settleRow(row, rows, stillPending, `uploaded ${today}: ${templates.join(", ")} via ${file}`);
  }
  console.log(
    `\n${batch.length} pack(s) recorded from ${file}${unmatched ? ` (${unmatched} without a row)` : ""}. ` +
      `Pin URLs arrive with the next \`clarity reconcile … --apply\`.`,
  );
}
