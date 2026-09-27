// src/stages/reconcile.ts — `clarity reconcile <scheduled.json> <created.json|api> [--apply]`
// or `clarity reconcile api [--apply]`.
// The files are Pinterest's ScheduledPinsResource / UserActivityPinsResource
// data, normalised by the /clarity-post skill's browser snippet to PinterestPin[].
// "api" reads the published pins from the Pinterest API instead of created.json.
// The API cannot see the scheduler, so `reconcile api` alone is the
// published-only pass: pin ids for csv-uploaded packs that have gone live, and
// pending packs that are already live — no "missing", no truncation check.
import { readFile } from "node:fs/promises";
import { readPacks } from "../packs.js";
import { listPinsWithMetrics } from "../pinterestApi.js";
import { reconcile, formatReconcile, parsePinterestPins, scheduledLooksTruncated, fromApiPins, type PinterestPin } from "../reconcile.js";
import { runPosted } from "./posted.js";

async function readPins(file: string, kind: PinterestPin["kind"]): Promise<PinterestPin[]> {
  const raw = JSON.parse(await readFile(file, "utf8")) as Partial<PinterestPin>[];
  return parsePinterestPins(raw, kind, file);
}

async function readCreated(source: string): Promise<PinterestPin[]> {
  if (source !== "api") return readPins(source, "published");
  const { pins, untitled } = fromApiPins(await listPinsWithMetrics());
  if (untitled) console.log(`(${untitled} untitled pins from the API skipped — reconcile matches on title)`);
  return pins;
}

/** `scheduledFile` undefined = the published-only API pass. */
export async function runReconcile(scheduledFile: string | undefined, createdSource: string, apply = false): Promise<void> {
  const publishedOnly = scheduledFile === undefined;
  const scheduled = publishedOnly ? [] : await readPins(scheduledFile, "scheduled");
  const created = await readCreated(createdSource);
  if (publishedOnly) console.log("published-only pass (the API cannot see the scheduler): id backfill + already-live only");
  // Printed before anything else derived from these counts — a silently short
  // page from Pinterest's endpoint should be visible immediately, not inferred
  // later from a suspicious "missing" list.
  console.log(`read ${scheduled.length} scheduled + ${created.length} created pins`);

  const pins = [...scheduled, ...created];
  const [pending, posted] = await Promise.all([readPacks("packs"), readPacks("posted")]);
  const today = new Date().toISOString().slice(0, 10);
  const r = reconcile(pins, pending, posted, today, { publishedOnly });
  console.log(formatReconcile(r));

  const truncated = !publishedOnly && scheduledLooksTruncated(scheduled.length, created.length, posted, today);
  if (truncated) {
    const due = posted.filter((p) => p.date > today).length;
    console.log(
      `⚠ scheduled list looks truncated (${scheduled.length + created.length} pins vs ${due} posted packs due after today) — re-pull in slices before trusting "missing"`,
    );
  }

  if (!apply) return;
  if (truncated) {
    console.log("Refusing --apply while the scheduled list looks truncated — re-pull it first.");
    process.exitCode = 1;
    return;
  }
  const fixes = [...r.alreadyLive, ...r.unidentified];
  if (fixes.length) {
    console.log(`\nApplying ${r.alreadyLive.length} already-live + ${r.unidentified.length} id-backfill pack(s):`);
    let applied = 0;
    let failed = 0;
    for (const { pack, pin } of fixes) {
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
