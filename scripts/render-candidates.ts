// Render the creative-refresh candidates (growth review, Oct 6 2026) for a few
// real lists and write an HTML board to look at them side by side. Nothing is
// registered: TEMPLATE_NAMES is untouched until the user picks.
//
//   npx tsx scripts/render-candidates.ts
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { listAllPins } from "../src/notion.js";
import { renderPin, launchBrowser, type TemplateName } from "../src/render/renderPin.js";
import { slugify } from "../src/destination.js";

const OUT = path.join("exports", "candidates", "refresh-2026-10-06");
const BOARD = path.join("docs", "refresh-options.html");
const CANDIDATES = ["poster", "teaser-count", "teaser-torn", "classic-checklist"];
const LISTS = ["halloween movies", "soup season", "fall bucket list for adults", "slow october"];

const rows = await listAllPins();
const picked = LISTS.map((n) => rows.find((r) => r.name.toLowerCase().includes(n) && (r.listItems ?? "").trim())).filter((r): r is NonNullable<typeof r> => !!r);
console.log(`Rendering ${CANDIDATES.length} looks x ${picked.length} lists → ${OUT}`);

const browser = await launchBrowser();
const cells: { list: string; template: string; file: string }[] = [];
try {
  for (const row of picked) {
    const slug = slugify(row.name).slice(0, 40);
    for (const template of CANDIDATES) {
      const file = path.join(OUT, `${slug}--${template}.png`);
      await renderPin({ name: row.name, listItems: row.listItems!, theme: row.theme, board: row.board }, template as TemplateName, file, browser);
      cells.push({ list: row.name, template, file: path.relative("docs", file).replace(/\\/g, "/") });
      console.log(`  ✓ ${slug} ${template}`);
    }
  }
} finally {
  await browser.close();
}

const byList = new Map<string, typeof cells>();
for (const c of cells) byList.set(c.list, [...(byList.get(c.list) ?? []), c]);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Creative refresh candidates (Oct 6, 2026)</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 24px; background: #faf7f2; color: #222; }
  h1 { font-size: 22px; } h2 { font-size: 17px; margin: 28px 0 8px; }
  .row { display: grid; grid-template-columns: repeat(${CANDIDATES.length}, 1fr); gap: 16px; }
  figure { margin: 0; } img { width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; background: #fff; }
  figcaption { font-size: 13px; color: #555; margin-top: 6px; }
  .feed { display: flex; gap: 10px; margin: 8px 0 18px; } .feed img { width: 205px; }
  p.note { max-width: 900px; }
</style></head><body>
<h1>Creative refresh candidates</h1>
<p class="note">Left to right: <b>poster</b> (new: big number, the search phrase as the headline, paper texture, three legible lines, the printable promise on the image), <b>teaser-count</b> and <b>teaser-torn</b> (built Sep 27, waiting for a verdict), and the current <b>classic-checklist</b> for comparison. The small strip under each row is feed size (205 px wide), which is how almost everyone meets a pin.</p>
${[...byList].map(([list, cs]) => `<h2>${list}</h2>
<div class="row">${cs.map((c) => `<figure><img src="${c.file}" alt="${c.template}"><figcaption>${c.template}</figcaption></figure>`).join("")}</div>
<div class="feed">${cs.map((c) => `<img src="${c.file}" alt="">`).join("")}</div>`).join("\n")}
</body></html>`;
await mkdir("docs", { recursive: true });
await writeFile(BOARD, html, "utf8");
console.log(`Board: ${path.resolve(BOARD)}`);
