// One-off (2026-09-17): give every backfill row the title of its blog post.
// Backfill rows were named from the first sentence of the old pin's caption
// ("Feeling down", "Ready to attract your dream life"), and the design engine
// puts the row name on the image — so before those lists get their four fresh
// variants they need real names. The blog post (written by `clarity blogpost`
// from the same pin) already carries the right title in its frontmatter; the
// row's Destination link points at it. The old name is kept in Notes.
// Dry run by default, `--apply` writes. Safe to re-run.
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listAllPins, updatePin } from "../src/notion.js";
import { appendNote } from "../src/approve/decide.js";

const apply = process.argv.includes("--apply");
const BLOG = process.env.CLARITY_BLOG_DIR ?? path.join("..", "Clarity_blog");
const today = new Date().toISOString().slice(0, 10);

const rows = (await listAllPins()).filter((r) => r.source === "backfill" && r.status === "Published");
let renamed = 0, same = 0, noPost = 0;
for (const r of rows) {
  const slug = r.destinationLink?.match(/\/posts\/([^/?#]+)/)?.[1];
  if (!slug) { noPost++; continue; }
  let fm: string;
  try {
    fm = await readFile(path.join(BLOG, "src", "content", "posts", `${slug}.md`), "utf8");
  } catch {
    console.log(`  ? post file missing for ${slug} (${r.name.slice(0, 40)})`);
    noPost++;
    continue;
  }
  const title = fm.match(/^title:\s*"(.+?)"\s*$/m)?.[1]?.replace(/\\"/g, '"');
  if (!title) { console.log(`  ? no title in ${slug}.md`); noPost++; continue; }
  if (title === r.name) { same++; continue; }
  console.log(`${apply ? "✓" : "·"} ${r.name.slice(0, 45).padEnd(45)} → ${title}`);
  if (apply) await updatePin(r.pageId, { name: title, notes: appendNote(r.notes, `renamed ${today}: was "${r.name}"`) });
  renamed++;
}
console.log(`\n${rows.length} backfill rows: ${renamed} to rename, ${same} already match, ${noPost} without a post${apply ? " — written." : " — dry run, add --apply to write."}`);
