// src/stages/csv.ts — `clarity csv [limit]`: the packs `post-plan` would hand
// to the browser, written instead as one file for Pinterest's bulk upload
// (Settings → Import content → Upload). The images have to be reachable by
// Pinterest, so they are published to the blog first and each URL is checked
// before its row is written; a pack then carries an EXPORTED: line so it is
// never put in a second file. `clarity uploaded <file>` does the bookkeeping
// once the file has actually been uploaded.
import { access, appendFile, cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { listAllPins } from "../notion.js";
import { readPacks, splitPackName } from "../packs.js";
import { buildPostPlan, type PlanEntry } from "../postplan.js";
import { suggestTopics } from "../topics.js";
import { rowForPack } from "../rowForPack.js";
import { buildCsv, mediaUrl } from "../csv.js";
import { BLOG_DIR, deployBlog } from "./ship.js";

const CSV_DIR = path.join("exports", "csv");
const PINS_PUBLIC_DIR = path.join(BLOG_DIR, "public", "pins");

const exists = (p: string) => access(p).then(() => true, () => false);

async function csvFileName(today: string): Promise<string> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${today}-pins.csv` : `${today}-pins-${n}.csv`;
    if (!(await exists(path.join(CSV_DIR, name)))) return name;
  }
}

/** Copy the pack PNGs the blog does not serve yet; returns how many were new. */
async function publishImages(entries: PlanEntry[]): Promise<number> {
  let copied = 0;
  for (const e of entries) {
    const { slug, template } = splitPackName(e.pack)!;
    const dest = path.join(PINS_PUBLIC_DIR, slug, `${template}.png`);
    if (await exists(dest)) continue;
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(e.image, dest);
    copied++;
  }
  return copied;
}

/** Media URLs Pinterest would fail to fetch — checked live, after the deploy. */
async function unreachable(entries: PlanEntry[]): Promise<string[]> {
  const bad: string[] = [];
  for (const e of entries) {
    const { slug, template } = splitPackName(e.pack)!;
    const url = mediaUrl(slug, template);
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok) bad.push(`${url} → HTTP ${res.status}`);
    } catch (err) {
      bad.push(`${url} → ${(err as Error).message}`);
    }
  }
  return bad;
}

export async function runCsv(limit = 200): Promise<void> {
  const [pending, posted, rows] = await Promise.all([readPacks("packs"), readPacks("posted"), listAllPins()]);
  const today = new Date().toISOString().slice(0, 10);
  const byDir = new Map(pending.map((p) => [p.dir, p]));
  const rowOf = (e: PlanEntry) => rowForPack(byDir.get(e.pack)!, rows);

  const plan = buildPostPlan(
    pending,
    today,
    (p) => {
      const r = rowForPack(p, rows);
      return suggestTopics(r?.listItems ?? "", r?.theme);
    },
    undefined,
    posted,
  );
  const entries = plan.entries.slice(0, limit);
  if (!entries.length) {
    console.log("Nothing to export — every pack is either already in a csv or outside the scheduler window.");
    return;
  }

  console.log("--- images ---");
  const copied = await publishImages(entries);
  if (copied) {
    console.log(`${copied} new image(s) in ${PINS_PUBLIC_DIR} — deploying the blog so Pinterest can fetch them`);
    await deployBlog();
  } else {
    console.log("all images already published");
  }
  const bad = await unreachable(entries);
  if (bad.length) {
    throw new Error(`Refusing to write the CSV — Pinterest could not fetch these images:\n  ${bad.join("\n  ")}`);
  }

  // Keywords: the row's own Notion keywords, else the topic suggestions the
  // browser route would have typed into "Tagged topics".
  const csv = buildCsv(entries, (e) => {
    const kw = rowOf(e)?.keywords;
    return kw?.length ? kw : e.topics;
  });

  await mkdir(CSV_DIR, { recursive: true });
  const file = await csvFileName(today);
  await writeFile(path.join(CSV_DIR, file), csv, "utf8");
  const stamp = new Date().toISOString();
  for (const e of entries) {
    await appendFile(path.join(byDir.get(e.pack)!.path, "post.txt"), `\nEXPORTED: ${stamp} ${file}\n`, "utf8");
  }

  console.log(`\n--- ${file} ---`);
  for (const e of entries) console.log(`${e.date}  ${e.time}  ${e.pack}`);
  if (plan.entries.length > entries.length) {
    console.log(`(${plan.entries.length - entries.length} more in the window — run \`clarity csv\` again for the next file)`);
  }
  if (plan.deferred.length) {
    console.log(`(${plan.deferred.length} pack(s) waiting for the scheduler window, first: ${plan.deferred[0].date})`);
  }
  console.log(
    `\n${entries.length} pin(s) written to ${path.join(CSV_DIR, file)}\n` +
      `Upload it at pinterest.com → Settings → Import content → Upload, then run:\n` +
      `  clarity uploaded ${file}`,
  );
}
