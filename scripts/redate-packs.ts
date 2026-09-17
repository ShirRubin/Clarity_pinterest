// Re-date every pending pack to the current cadence (src/schedule.ts):
// PINS_PER_DAY and the 72h-per-URL gap, earliest open slot first, keeping the
// packs' current order. Posted packs and live pipeline pins hold their days;
// packs already written into a csv (EXPORTED:) are left where they are. Each
// moved pack's directory is renamed and its POST ON / POST AT lines rewritten;
// rows whose earliest pack date moved get their Scheduled date refreshed.
// Dry run by default, `--apply` writes.
//
//   npx tsx scripts/redate-packs.ts            # report
//   npx tsx scripts/redate-packs.ts --apply    # move
import "dotenv/config";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { listAllPins, updatePin } from "../src/notion.js";
import { readPacks } from "../src/packs.js";
import { rowForPack } from "../src/rowForPack.js";
import { assignDates, slotTime, PINS_PER_DAY, type ScheduledEntry } from "../src/schedule.js";
import { chooseDestination } from "../src/destination.js";

const apply = process.argv.includes("--apply");
const today = new Date().toISOString().slice(0, 10);

const rows = await listAllPins();
const posted = await readPacks("posted");
const pendingAll = await readPacks("packs");
const exported = pendingAll.filter((p) => p.text.exported);
const pending = pendingAll
  .filter((p) => !p.text.exported)
  .sort((a, b) => a.date.localeCompare(b.date) || a.dir.localeCompare(b.dir));

const existing: ScheduledEntry[] = [
  ...rows
    .filter((r) => r.source === "pipeline" && r.pinUrl && r.publishedDate)
    .map((r) => ({ date: r.publishedDate!.slice(0, 10), destUrl: r.destinationLink ?? chooseDestination(r, false).url })),
  ...[...posted, ...exported].filter((p) => p.text.link).map((p) => ({ date: p.date, destUrl: p.text.link })),
];

const assigned = assignDates(existing, pending.map((p) => ({ id: p.dir, destUrl: p.text.link })), today);
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
  if (moved <= 12) console.log(`${apply ? "✓" : "·"} ${p.dir}  →  ${a.date} ${time}`);
  if (!apply) continue;
  let txt = await readFile(path.join(p.path, "post.txt"), "utf8");
  txt = txt.replace(/^POST ON: \S+/m, `POST ON: ${a.date}`);
  txt = /^POST AT: /m.test(txt) ? txt.replace(/^POST AT: .*$/m, `POST AT: ${time}`) : txt.replace(/^(POST ON: .*)$/m, `$1\nPOST AT: ${time}`);
  await writeFile(path.join(p.path, "post.txt"), txt, "utf8");
  if (newDir !== p.dir) await rename(p.path, path.join("exports", "packs", newDir));
}
if (moved > 12) console.log(`  … and ${moved - 12} more`);

const last = [...perDay.keys()].sort().pop();
console.log(`\n${pending.length} pending packs at ${PINS_PER_DAY}/day → ${moved} moved, calendar runs to ${last}${apply ? " — written." : " — dry run, add --apply to write."}`);

if (apply) {
  // Scheduled date = earliest pack (posted or pending) per row, now that dates moved.
  const earliest = new Map<string, string>();
  const fresh = [...(await readPacks("posted")), ...(await readPacks("packs"))];
  for (const p of fresh) {
    const r = rowForPack(p, rows);
    if (!r) continue;
    if (!earliest.has(r.pageId) || p.date < earliest.get(r.pageId)!) earliest.set(r.pageId, p.date);
  }
  let fixed = 0;
  for (const [pageId, date] of earliest) {
    const r = rows.find((x) => x.pageId === pageId)!;
    if (r.scheduledDate === date) continue;
    await updatePin(pageId, { scheduledDate: date });
    fixed++;
  }
  console.log(`${fixed} row(s) had their Scheduled date refreshed.`);
}
