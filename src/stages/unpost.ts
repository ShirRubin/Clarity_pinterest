// src/stages/unpost.ts — `clarity unpost <scheduled.json> <created.json> [--apply]`
// The reverse of `clarity uploaded`. A CSV bulk upload marks every pack in the
// file as posted before Pinterest confirms anything; when Pinterest takes only
// part of the file (it caps how many pins may sit in the scheduler) the rest
// stay in exports/posted/ claiming a place on the calendar they never got.
// This puts those packs back in exports/packs/ so `csv`/`post-plan` can offer
// them again, and reverses the Notion row the same way `uploaded` set it.
//
// Dry run by default. The two JSON files are the same ones `clarity reconcile`
// reads — Pinterest's own ScheduledPinsResource / UserActivityPinsResource data.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { listAllPins, updatePin, ensureStatusOptions, ensureSchemaProperties, type PinSummary } from "../notion.js";
import { readPacks } from "../packs.js";
import { parsePinterestPins, type PinterestPin } from "../reconcile.js";
import { planUnpost, clearPostedMarks, unpostTransition, pullLooksFailed } from "../unpost.js";
import { rowForPack } from "../rowForPack.js";
import { appendNote } from "../approve/decide.js";
import { TEMPLATE_NAMES } from "../templates.js";

async function readPins(file: string, kind: PinterestPin["kind"]): Promise<PinterestPin[]> {
  const raw = JSON.parse(await readFile(file, "utf8")) as Partial<PinterestPin>[];
  return parsePinterestPins(raw, kind, file);
}

export async function runUnpost(scheduledFile: string, createdFile: string, apply = false): Promise<void> {
  const scheduled = await readPins(scheduledFile, "scheduled");
  const created = await readPins(createdFile, "published");
  console.log(`read ${scheduled.length} scheduled + ${created.length} created pins`);
  if (pullLooksFailed(scheduled.length, created.length)) {
    throw new Error("Both pin lists are empty — that is a failed pull, not an empty scheduler. Re-pull before unposting.");
  }

  const posted = await readPacks("posted");
  const today = new Date().toISOString().slice(0, 10);
  const plan = planUnpost([...scheduled, ...created], posted, today);

  for (const pack of plan) console.log(`back to packs/  ${pack.dir}  ("${pack.text.title}")`);
  const kept = posted.filter((p) => p.date > today).length - plan.length;
  console.log(
    `\n${plan.length} pack(s) dated after today are not in Pinterest's lists; ${kept} are (or carry a recorded pin id) and stay put.`,
  );
  if (!plan.length) return;
  if (!apply) {
    console.log("Dry run — re-run with --apply to move them back to exports/packs/.");
    return;
  }

  await ensureStatusOptions();
  await ensureSchemaProperties(); // the per-template date columns
  const rows = await listAllPins();

  // Rows are resolved BEFORE the move: rowForPack reads the pack's PAGE: line,
  // which survives, but resolving first keeps the mapping if a rename fails.
  const affected = new Map<string, PinSummary>();
  for (const pack of plan) {
    const row = rowForPack(pack, rows);
    if (row) affected.set(row.pageId, row);
    else console.log(`⚠ ${pack.dir}: no Notion row — the pack still moves, the row is left alone`);
  }

  await mkdir(path.join("exports", "packs"), { recursive: true });
  let moved = 0;
  for (const pack of plan) {
    const postTxt = path.join(pack.path, "post.txt");
    // Clear the markers before the rename, so a crash leaves a pack that is
    // still in posted/ and still marked posted rather than a half-reverted one.
    await writeFile(postTxt, clearPostedMarks(await readFile(postTxt, "utf8")), "utf8");
    await rename(pack.path, path.join("exports", "packs", pack.dir));
    moved++;
  }
  console.log(`\n✓ moved ${moved} pack(s) back to exports/packs/`);

  // One Notion write per affected row, derived from what is left in posted/.
  const stillPosted = await readPacks("posted");
  for (const row of affected.values()) {
    const mine = stillPosted.filter((p) => rowForPack(p, rows)?.pageId === row.pageId);
    const patch = unpostTransition({
      stillPostedDates: Object.fromEntries(mine.map((p) => [p.template, p.date])),
      allTemplates: [...TEMPLATE_NAMES],
      currentStatus: row.status,
    });
    await updatePin(row.pageId, { notes: appendNote(row.notes, `unposted ${today}: not in Pinterest's lists`), ...patch });
    console.log(
      patch.status
        ? `✓ ${row.name.slice(0, 60)} → Approved (${mine.length}/${TEMPLATE_NAMES.length} variants still on Pinterest)`
        : `  ${row.name.slice(0, 60)}: stays ${row.status} (${mine.length}/${TEMPLATE_NAMES.length} on Pinterest)`,
    );
  }
  console.log(`\n${affected.size} row(s) updated. Re-run \`clarity csv\` to offer these packs to Pinterest again.`);
}
