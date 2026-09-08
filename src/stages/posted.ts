// src/stages/posted.ts — bookkeeping after one pin is in Pinterest's scheduler:
//   clarity posted <pack-dir-name> <pin-id>
// Moves the pack to exports/posted/, appends a POSTED line, notes the row, and
// flips it to Scheduled when all variants are there. Claude runs this after every
// pin so no file or Notion row is ever edited by hand.
import { appendFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { listAllPins, updatePin, ensureStatusOptions, type PinSummary } from "../notion.js";
import { readPacks, splitPackName, type PackInfo } from "../packs.js";
import { postedTransition, pinUrl } from "../posted.js";
import { appendNote } from "./approve.js";
import { TEMPLATE_NAMES } from "../render/renderPin.js";
import { slugify } from "../destination.js";

/** The Notion row a pack belongs to: the PAGE line when present, else the slug. */
function rowFor(pack: PackInfo, rows: PinSummary[]): PinSummary | undefined {
  if (pack.text.pageId) return rows.find((r) => r.pageId === pack.text.pageId);
  return rows.find((r) => r.source !== "backfill" && slugify(r.name) === pack.slug);
}

export async function runPosted(packDir: string, pinId: string): Promise<void> {
  const dir = path.basename(packDir); // accept "exports/packs/<dir>" or "<dir>"
  if (!splitPackName(dir)) throw new Error(`Not a pack directory name: ${dir}`);
  if (!/^\d+$/.test(pinId)) throw new Error(`Pin id must be numeric, got: ${pinId}`);

  const pending = await readPacks("packs");
  const pack = pending.find((p) => p.dir === dir);
  if (!pack) throw new Error(`No such pack in exports/packs/: ${dir}`);

  await ensureStatusOptions();
  const rows = await listAllPins();
  const row = rowFor(pack, rows);
  if (!row) throw new Error(`No Notion row for pack ${dir} — add a PAGE: line to its post.txt`);

  // 1. Move the pack and stamp it.
  await mkdir(path.join("exports", "posted"), { recursive: true });
  const dest = path.join("exports", "posted", dir);
  await rename(pack.path, dest);
  await appendFile(path.join(dest, "post.txt"), `\nPOSTED: ${new Date().toISOString()} pin ${pinId}\n`, "utf8");
  console.log(`✓ moved to exports/posted/${dir}`);

  // 2. Everything of this row now in posted/ (including the one just moved).
  const posted = (await readPacks("posted")).filter((p) => rowFor(p, rows)?.pageId === row.pageId);
  const stillPending = pending.filter((p) => p.dir !== dir && rowFor(p, rows)?.pageId === row.pageId);
  const earliest = [...posted, ...stillPending].map((p) => p.date).sort()[0];
  const first = [...posted].sort((a, b) => a.date.localeCompare(b.date) || a.dir.localeCompare(b.dir))[0];

  const patch = postedTransition({
    postedTemplates: posted.map((p) => p.template),
    totalTemplates: TEMPLATE_NAMES.length,
    firstPinId: first.text.posted?.pinId ?? pinId,
    earliestPackDate: earliest,
    existingScheduledDate: row.scheduledDate,
  });

  // 3. Notion: always a note; status only on the last variant.
  const today = new Date().toISOString().slice(0, 10);
  await updatePin(row.pageId, {
    notes: appendNote(row.notes, `posted ${today}: ${pack.template} → ${pinUrl(pinId)}`),
    ...patch,
  });
  const n = new Set(posted.map((p) => p.template)).size;
  console.log(
    patch.status
      ? `✓ ${row.name.slice(0, 60)} → Scheduled (${n}/${TEMPLATE_NAMES.length} variants on Pinterest)`
      : `  ${row.name.slice(0, 60)}: ${n}/${TEMPLATE_NAMES.length} variants posted — row stays Approved`,
  );
}
