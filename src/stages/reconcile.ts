// src/stages/reconcile.ts — `clarity reconcile <scheduled.json> <created.json> [--apply]`
// The two files are Pinterest's ScheduledPinsResource / UserActivityPinsResource
// data, normalised by the /clarity-post skill's browser snippet to PinterestPin[].
import { readFile } from "node:fs/promises";
import { readPacks } from "../packs.js";
import { reconcile, formatReconcile, type PinterestPin } from "../reconcile.js";
import { runPosted } from "./posted.js";

async function readPins(file: string, kind: PinterestPin["kind"]): Promise<PinterestPin[]> {
  const raw = JSON.parse(await readFile(file, "utf8")) as Partial<PinterestPin>[];
  return raw.map((p) => {
    if (!p.id || typeof p.ts !== "number") throw new Error(`${file}: every entry needs id and ts (unix seconds)`);
    return { id: String(p.id), title: p.title ?? "", link: p.link, ts: p.ts, kind };
  });
}

export async function runReconcile(scheduledFile: string, createdFile: string, apply = false): Promise<void> {
  const pins = [...(await readPins(scheduledFile, "scheduled")), ...(await readPins(createdFile, "published"))];
  const [pending, posted] = await Promise.all([readPacks("packs"), readPacks("posted")]);
  const today = new Date().toISOString().slice(0, 10);
  const r = reconcile(pins, pending, posted, today);
  console.log(formatReconcile(r));
  if (apply && r.alreadyLive.length) {
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
