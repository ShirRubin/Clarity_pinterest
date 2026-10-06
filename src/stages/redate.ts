// src/stages/redate.ts — re-date every pending pack to the current cadence
// (src/schedule.ts: PINS_PER_DAY, the per-URL gap), new lists first
// (src/freshness.ts), earliest open slot wins. Posted packs, live pipeline
// pins and packs already written into a csv (EXPORTED:) hold their days.
// Each moved pack's directory is renamed and its POST ON / POST AT lines
// rewritten; rows whose earliest pack date moved get their Scheduled date
// refreshed. Used by `scripts/redate-packs.ts` (dry run by default) and by
// `clarity pack`, which calls it after writing packs so a new list lands
// in the next free slot instead of behind the whole backlog.
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { listAllPins, updatePin, type PinSummary } from "../notion.js";
import { readPacks, type PackInfo } from "../packs.js";
import { rowForPack } from "../rowForPack.js";
import { assignDates, slotTime, PINS_PER_DAY, type ScheduledEntry } from "../schedule.js";
import { chooseDestination } from "../destination.js";
import { orderForCalendar } from "../freshness.js";

// OneDrive holds a directory for a moment after a file inside it is written —
// the rename then fails with EPERM. Wait and try again before giving up.
async function renameRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY") || attempt >= 6) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

/** `slug => true` when the pack belongs to a pipeline row (a backfill row is a 2025 pin Pinterest already knows). */
export function newListPredicate(packs: PackInfo[], rows: PinSummary[]): (slug: string) => boolean {
  const bySlug = new Map<string, boolean>();
  for (const p of packs) {
    if (bySlug.has(p.slug)) continue;
    const row = rowForPack(p, rows);
    bySlug.set(p.slug, !!row && row.source !== "backfill");
  }
  return (slug) => bySlug.get(slug) ?? false;
}

export interface RedateResult {
  pending: number;
  moved: number;
  /** Last date on the pending calendar after re-dating. */
  last?: string;
  /** Rows whose Scheduled date was refreshed (apply only). */
  rowsFixed: number;
}

export async function redatePending(o: { apply: boolean; today?: string; rows?: PinSummary[]; log?: (s: string) => void } = { apply: false }): Promise<RedateResult> {
  const log = o.log ?? console.log;
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const rows = o.rows ?? (await listAllPins());
  const posted = await readPacks("posted");
  const pendingAll = await readPacks("packs");
  const exported = pendingAll.filter((p) => p.text.exported);
  const isNew = newListPredicate(pendingAll, rows);
  const byDirAll = new Map(pendingAll.map((p) => [p.dir, p]));
  const ordered = orderForCalendar(
    pendingAll.filter((p) => !p.text.exported).map((p) => ({ dir: p.dir, date: p.date, slug: p.slug, template: p.template, title: p.text.title })),
    posted,
    isNew,
    today,
  );
  const pending = ordered.map((o) => byDirAll.get(o.dir)!);
  const notBefore = new Map(ordered.filter((o) => o.notBefore).map((o) => [o.dir, o.notBefore!]));
  const tiers = { season: 0, opener: 0, backlog: 0, parked: 0 };
  for (const o of ordered) tiers[o.tier]++;

  const existing: ScheduledEntry[] = [
    ...rows
      .filter((r) => r.source === "pipeline" && r.pinUrl && r.publishedDate)
      .map((r) => ({ date: r.publishedDate!.slice(0, 10), destUrl: r.destinationLink ?? chooseDestination(r, false).url, board: r.board })),
    ...[...posted, ...exported].filter((p) => p.text.link).map((p) => ({ date: p.date, destUrl: p.text.link, board: p.text.board })),
  ];

  const assigned = assignDates(
    existing,
    pending.map((p) => ({ id: p.dir, destUrl: p.text.link, notBefore: notBefore.get(p.dir), board: p.text.board })),
    today,
  );
  const byDir = new Map(pending.map((p) => [p.dir, p]));

  let moved = 0;
  const perDay = new Map<string, number>();
  for (const a of assigned) {
    perDay.set(a.date, (perDay.get(a.date) ?? 0) + 1);
    const p = byDir.get(a.id)!;
    const time = slotTime(a.slot);
    if (a.date === p.date && p.text.time === time) continue;
    moved++;
    const newDir = `${a.date}--${p.slug}--${p.template}`;
    if (moved <= 12) log(`${o.apply ? "✓" : "·"} ${p.dir}  →  ${a.date} ${time}`);
    if (!o.apply) continue;
    let txt = await readFile(path.join(p.path, "post.txt"), "utf8");
    txt = txt.replace(/^POST ON: \S+/m, `POST ON: ${a.date}`);
    txt = /^POST AT: /m.test(txt) ? txt.replace(/^POST AT: .*$/m, `POST AT: ${time}`) : txt.replace(/^(POST ON: .*)$/m, `$1\nPOST AT: ${time}`);
    await writeFile(path.join(p.path, "post.txt"), txt, "utf8");
    if (newDir !== p.dir) await renameRetry(p.path, path.join("exports", "packs", newDir));
  }
  if (moved > 12) log(`  … and ${moved - 12} more`);

  const last = [...perDay.keys()].sort().pop();
  log(`\n${pending.length} pending packs at ${PINS_PER_DAY}/day (${tiers.season} in season, ${tiers.opener} new-list openers, ${tiers.backlog} backlog, ${tiers.parked} parked for their window) → ${moved} moved, calendar runs to ${last}${o.apply ? " — written." : " — dry run, add --apply to write."}`);
  for (const p of ordered.filter((x) => x.tier === "parked").slice(0, 8)) log(`  parked  ${p.slug.slice(0, 50).padEnd(50)} ${p.season!.name}: waits for ${p.notBefore}`);

  let rowsFixed = 0;
  if (o.apply) {
    // Scheduled date = earliest pack (posted or pending) per row, now that dates moved.
    const earliest = new Map<string, string>();
    const fresh = [...(await readPacks("posted")), ...(await readPacks("packs"))];
    for (const p of fresh) {
      const r = rowForPack(p, rows);
      if (!r) continue;
      if (!earliest.has(r.pageId) || p.date < earliest.get(r.pageId)!) earliest.set(r.pageId, p.date);
    }
    for (const [pageId, date] of earliest) {
      const r = rows.find((x) => x.pageId === pageId)!;
      if (r.scheduledDate === date) continue;
      await updatePin(pageId, { scheduledDate: date });
      rowsFixed++;
    }
    log(`${rowsFixed} row(s) had their Scheduled date refreshed.`);
  }
  return { pending: pending.length, moved, last, rowsFixed };
}
