// src/stages/reconcile.ts — `clarity reconcile <scheduled.json> <created.json> [--apply]`
// The two files are Pinterest's ScheduledPinsResource / UserActivityPinsResource
// data, normalised by the /clarity-post skill's browser snippet to PinterestPin[].
import { readFile } from "node:fs/promises";
import { readPacks } from "../packs.js";
import { reconcile, formatReconcile, parsePinterestPins, scheduledLooksTruncated, type PinterestPin } from "../reconcile.js";
import { runPosted } from "./posted.js";

async function readPins(file: string, kind: PinterestPin["kind"]): Promise<PinterestPin[]> {
  const raw = JSON.parse(await readFile(file, "utf8")) as Partial<PinterestPin>[];
  return parsePinterestPins(raw, kind, file);
}

export async function runReconcile(scheduledFile: string, createdFile: string, apply = false): Promise<void> {
  const scheduled = await readPins(scheduledFile, "scheduled");
  const created = await readPins(createdFile, "published");
  // Printed before anything else derived from these counts — a silently short
  // page from Pinterest's endpoint should be visible immediately, not inferred
  // later from a suspicious "missing" list.
  console.log(`read ${scheduled.length} scheduled + ${created.length} created pins`);

  const pins = [...scheduled, ...created];
  const [pending, posted] = await Promise.all([readPacks("packs"), readPacks("posted")]);
  const today = new Date().toISOString().slice(0, 10);
  const r = reconcile(pins, pending, posted, today);
  console.log(formatReconcile(r));

  const truncated = scheduledLooksTruncated(scheduled.length, posted, today);
  if (truncated) {
    const due = posted.filter((p) => p.date >= today).length;
    console.log(
      `⚠ scheduled list looks truncated (${scheduled.length} pins vs ${due} posted packs) — re-pull in slices before trusting "missing"`,
    );
  }

  if (!apply) return;
  if (truncated) {
    console.log("Refusing --apply while the scheduled list looks truncated — re-pull it first.");
    process.exitCode = 1;
    return;
  }
  if (r.alreadyLive.length) {
    console.log(`\nApplying ${r.alreadyLive.length} already-live pack(s):`);
    let applied = 0;
    let failed = 0;
    for (const { pack, pin } of r.alreadyLive) {
      try {
        await runPosted(pack.dir, pin.id);
        applied++;
      } catch (err) {
        failed++;
        console.log(`✗ ${pack.dir}: ${(err as Error).message}`);
      }
    }
    console.log(`applied ${applied}, failed ${failed}`);
  }
}
