// Pull far-future scheduled pins forward into short days (src/pullForward.ts).
// Pinterest caps the scheduler at 100 pins; spread thinly to mid-November they
// leave October short of 5/day. Three steps:
//
//   npx tsx scripts/pull-forward.ts [--from=YYYY-MM-DD]   # plan → exports/reconcile/pull-forward.json
//   (apply the moves on Pinterest: ApiResource/update /v3/scheduledpins/<id>/)
//   npx tsx scripts/pull-forward.ts --books               # rename the moved posted packs + settle their rows
//
// Then `npx tsx scripts/redate-packs.ts --apply` re-dates the pending packs
// around the new calendar. Reads the same scheduled.json / created.json pulls
// as `clarity reconcile`.
import "dotenv/config";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { planPullForward, type PinAt, type PullMove } from "../src/pullForward.js";
import { localParts } from "../src/schedule.js";
import { readPacks } from "../src/packs.js";
import { listAllPins } from "../src/notion.js";
import { rowForPack } from "../src/rowForPack.js";
import { settleRow } from "../src/stages/posted.js";

const DIR = path.join("exports", "reconcile");
const PLAN = path.join(DIR, "pull-forward.json");
const flag = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

async function renameRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY") || attempt >= 6) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

if (!process.argv.includes("--books")) {
  const scheduled = JSON.parse(await readFile(path.join(DIR, "scheduled.json"), "utf8")) as PinAt[];
  const created = JSON.parse(await readFile(path.join(DIR, "created.json"), "utf8")) as PinAt[];
  const from = flag("from") ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const moves = planPullForward(scheduled, created, from);

  const count = (dates: string[]) => dates.reduce((m, d) => m.set(d, (m.get(d) ?? 0) + 1), new Map<string, number>());
  const before = count(scheduled.map((p) => localParts(p.ts).date));
  const movedIds = new Set(moves.map((m) => m.id));
  const after = count([
    ...scheduled.filter((p) => !movedIds.has(p.id)).map((p) => localParts(p.ts).date),
    ...moves.map((m) => m.toDate),
  ]);
  const days = [...new Set([...before.keys(), ...after.keys()])].filter((d) => d >= from).sort();
  for (const d of days) console.log(`${d}  ${before.get(d) ?? 0} → ${after.get(d) ?? 0}`);
  await writeFile(PLAN, JSON.stringify(moves, null, 1));
  console.log(`\n${moves.length} move(s) planned → ${PLAN}`);
} else {
  const moves = JSON.parse(await readFile(PLAN, "utf8")) as PullMove[];
  const byPin = new Map(moves.map((m) => [m.id, m]));
  const rows = await listAllPins();
  const pending = await readPacks("packs");
  const touched = new Set<string>();
  for (const p of await readPacks("posted")) {
    const m = p.text.posted?.pinId ? byPin.get(p.text.posted.pinId) : undefined;
    if (!m) continue;
    let txt = await readFile(path.join(p.path, "post.txt"), "utf8");
    txt = txt.replace(/^POST ON: \S+/m, `POST ON: ${m.toDate}`);
    txt = /^POST AT: /m.test(txt) ? txt.replace(/^POST AT: .*$/m, `POST AT: ${m.toTime}`) : txt.replace(/^(POST ON: .*)$/m, `$1\nPOST AT: ${m.toTime}`);
    await writeFile(path.join(p.path, "post.txt"), txt, "utf8");
    const newDir = `${m.toDate}--${p.slug}--${p.template}`;
    if (newDir !== p.dir) await renameRetry(p.path, path.join("exports", "posted", newDir));
    byPin.delete(m.id);
    const row = rowForPack(p, rows);
    if (row) touched.add(row.pageId);
    console.log(`✓ ${p.dir}  →  ${m.toDate} ${m.toTime}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const pageId of touched) {
    const row = rows.find((r) => r.pageId === pageId)!;
    await settleRow(row, rows, pending, `pulled forward ${today}: scheduled pin(s) moved to fill short days`);
  }
  if (byPin.size) console.log(`⚠ ${byPin.size} move(s) had no posted pack with that pin id: ${[...byPin.keys()].join(", ")}`);
  console.log(`${moves.length - byPin.size} pack(s) re-dated, ${touched.size} row(s) settled.`);
}
