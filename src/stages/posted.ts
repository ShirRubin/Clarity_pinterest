// src/stages/posted.ts — bookkeeping after one pin is in Pinterest's scheduler:
//   clarity posted <pack-dir-name> <pin-id>
// Moves the pack to exports/posted/, appends a POSTED line, notes the row, and
// flips it to Scheduled when all variants are there. Claude runs this after every
// pin so no file or Notion row is ever edited by hand.
import { appendFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { listAllPins, updatePin, ensureStatusOptions, type PinSummary } from "../notion.js";
import { readPacks, splitPackName, type PackInfo } from "../packs.js";
import { postedTransition, postedDerivation, applyStatusGuard, pinUrl } from "../posted.js";
import { appendNote } from "../approve/decide.js";
import { TEMPLATE_NAMES } from "../render/renderPin.js";
import { rowForPack as rowFor } from "../rowForPack.js";

export async function runPosted(packDir: string, pinId: string): Promise<void> {
  const dir = path.basename(packDir); // accept "exports/packs/<dir>" or "<dir>"
  if (!splitPackName(dir)) throw new Error(`Not a pack directory name: ${dir}`);
  if (!/^\d+$/.test(pinId)) throw new Error(`Pin id must be numeric, got: ${pinId}`);

  const pending = await readPacks("packs");
  let pack = pending.find((p) => p.dir === dir);

  // Repair path: the pack is already in posted/ — either a previous run died
  // after the rename but before the append/Notion write below, or `clarity
  // uploaded` moved it with no pin id and the reconcile backfill is now
  // supplying one. Don't fail, just pick up where that left off.
  let repairing = false;
  if (!pack) {
    pack = (await readPacks("posted")).find((p) => p.dir === dir);
    if (!pack) throw new Error(`No such pack in exports/packs/: ${dir}`);
    repairing = true;
  }

  await ensureStatusOptions();
  const rows = await listAllPins();
  const row = rowFor(pack, rows);
  if (!row) throw new Error(`No Notion row for pack ${dir} — add a PAGE: line to its post.txt`);

  if (repairing) {
    console.log(pack.text.posted?.csv ? `↻ recording pin id for csv-uploaded pack` : `↻ pack already in posted/ — repairing Notion`);
    // Append the id marker unless one is already there (csv markers carry none).
    if (!pack.text.posted?.pinId) {
      await appendFile(path.join(pack.path, "post.txt"), `\nPOSTED: ${new Date().toISOString()} pin ${pinId}\n`, "utf8");
    }
  } else {
    // 1. Move the pack and stamp it.
    await mkdir(path.join("exports", "posted"), { recursive: true });
    const dest = path.join("exports", "posted", dir);
    await rename(pack.path, dest);
    await appendFile(path.join(dest, "post.txt"), `\nPOSTED: ${new Date().toISOString()} pin ${pinId}\n`, "utf8");
    console.log(`✓ moved to exports/posted/${dir}`);
  }

  // 2. + 3. Re-read posted/ and write the row — shared with `clarity uploaded`.
  const today = new Date().toISOString().slice(0, 10);
  await settleRow(row, rows, pending.filter((p) => p.dir !== dir), `posted ${today}: ${pack.template} → ${pinUrl(pinId)}`);
}

/**
 * The Notion half of bookkeeping, shared by `posted` (one pack, id known) and
 * `uploaded` (a csv batch, ids to come): re-read what is in posted/ for this
 * row, derive the patch, and always append the note — status only flips on
 * the last variant. `stillPending` is what remains in packs/ after the caller's
 * own move, so a half-posted row's earliest date still counts its unposted packs.
 */
export async function settleRow(row: PinSummary, rows: PinSummary[], stillPending: PackInfo[], note: string): Promise<void> {
  // Everything of this row now in posted/ (including whatever the caller just
  // moved or repaired — its POSTED: line is on disk before this re-read either
  // way, so it is not a pack silently missing its marker like the ~51
  // pre-this-stage packs are).
  const posted = (await readPacks("posted")).filter((p) => rowFor(p, rows)?.pageId === row.pageId);
  const pendingForRow = stillPending.filter((p) => rowFor(p, rows)?.pageId === row.pageId);
  const { firstPinId, earliestPackDate } = postedDerivation(posted, pendingForRow);

  const patch = postedTransition({
    postedTemplates: posted.map((p) => p.template),
    totalTemplates: TEMPLATE_NAMES.length,
    firstPinId,
    earliestPackDate,
    existingScheduledDate: row.scheduledDate,
    existingPinUrl: row.pinUrl,
    existingPinId: row.pinterestPinId,
  });

  // A row moved by hand to something other than Approved/Scheduled (Rejected,
  // Archived, ...) keeps its status even if this happens to be the last variant.
  const finalPatch = applyStatusGuard(patch, row.status);
  if (patch.status && !finalPatch.status) {
    console.log(`⚠ ${row.name.slice(0, 60)} is ${row.status} — not flipped to Scheduled`);
  }

  await updatePin(row.pageId, { notes: appendNote(row.notes, note), ...finalPatch });
  const n = new Set(posted.map((p) => p.template)).size;
  console.log(
    finalPatch.status
      ? `✓ ${row.name.slice(0, 60)} → Scheduled (${n}/${TEMPLATE_NAMES.length} variants on Pinterest)`
      : `  ${row.name.slice(0, 60)}: ${n}/${TEMPLATE_NAMES.length} variants posted — row stays ${row.status}`,
  );
}
