// One-off (2026-09-06): point every pin at its blog post now that
// clarity-lists.com is live. Dry run by default — prints the worklist and
// writes exports/relink.json. `--apply` also updates each Notion row's
// Destination link and rewrites DESTINATION LINK in exports/posted/*/post.txt
// so the scheduler's 72h-per-URL calendar matches what Pinterest really links to.
// Editing the pins on Pinterest itself is a separate (browser/API) step that
// reads exports/relink.json.
import "dotenv/config";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listAllPins, updatePin } from "../src/notion.js";
import { chooseDestination, postSlugForName, SITE } from "../src/destination.js";

const BLOG_DIR = process.env.CLARITY_BLOG_DIR ?? path.join("..", "Clarity_blog");
const POSTS_DIR = path.join(BLOG_DIR, "src", "content", "posts");
const exists = (p: string) => access(p).then(() => true, () => false);
const apply = process.argv.includes("--apply");

const rows = await listAllPins();
const work: {
  pageId: string; name: string; pinTitle?: string; pinUrl?: string; status?: string; source?: string;
  scheduledDate?: string; from?: string; to: string; how: string;
}[] = [];
let missing = 0;

for (const r of rows) {
  if (!["Published", "Approved"].includes(r.status ?? "")) continue;
  // The Notion link may already be right (blogpost stage) — recompute from disk anyway so a
  // renamed post can't leave a stale link behind.
  const slug = postSlugForName(r.name);
  let onDisk = await exists(path.join(POSTS_DIR, `${slug}.md`));
  let d = chooseDestination({ ...r, destinationLink: undefined }, onDisk);
  if (d.source === "board" && r.destinationLink?.startsWith(SITE)) {
    // backfill rows: blogpost chose a different slug (from the pin title) — trust it if it exists
    const linked = r.destinationLink.split("/").filter(Boolean).pop() ?? "";
    if (await exists(path.join(POSTS_DIR, `${linked}.md`))) d = { url: r.destinationLink, source: "notion" };
  }
  if (d.source === "board") { missing++; console.warn(`⚠ no post for: ${r.name}`); continue; }
  work.push({
    pageId: r.pageId, name: r.name, pinTitle: r.pinTitle, pinUrl: r.pinUrl, status: r.status, source: r.source,
    scheduledDate: r.scheduledDate, from: r.destinationLink, to: d.url, how: d.source,
  });
}

const changed = work.filter((w) => w.from !== w.to);
console.log(`${work.length} rows resolve to a blog post (${changed.length} Notion links need changing, ${missing} rows have no post).`);
for (const w of changed) console.log(`  ${w.status?.padEnd(9)} ${w.name.slice(0, 55).padEnd(56)} → ${w.to}`);

await writeFile(path.join("exports", "relink.json"), JSON.stringify(work, null, 2), "utf8");
console.log(`worklist → exports/relink.json`);

if (!apply) { console.log("(dry run — pass --apply to update Notion and pack files)"); process.exit(0); }

for (const w of changed) await updatePin(w.pageId, { destinationLink: w.to });
console.log(`✓ Notion: ${changed.length} Destination links updated`);

// Pack files: match by the slug prefix used in pack dir names.
let packs = 0;
for (const sub of ["packs", "posted"]) {
  const dir = path.join("exports", sub);
  let names: string[] = [];
  try { names = await readdir(dir); } catch { continue; }
  for (const name of names) {
    const m = /^\d{4}-\d{2}-\d{2}--(.+)--[a-z-]+$/.exec(name);
    if (!m) continue;
    const packSlug = m[1];
    const hit = work.find((w) => {
      const s = w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      return s === packSlug || s.startsWith(packSlug) || packSlug.startsWith(s);
    });
    if (!hit) { console.warn(`⚠ pack without a row: ${name}`); continue; }
    const file = path.join(dir, name, "post.txt");
    const txt = await readFile(file, "utf8");
    const next = txt.replace(/^DESTINATION LINK: \S+.*$/m, `DESTINATION LINK: ${hit.to}`);
    if (next !== txt) { await writeFile(file, next, "utf8"); packs++; }
  }
}
console.log(`✓ packs: ${packs} post.txt files now link to the blog`);
