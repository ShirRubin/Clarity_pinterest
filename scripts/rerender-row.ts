// Re-render every template for one row after its list changed, refresh the
// PNGs inside its pending (not exported) packs, and re-attach the set to the
// Notion row. Posted and exported packs keep their image: Pinterest has it.
//
//   npx tsx scripts/rerender-row.ts "halloween movies"      # name match, case-insensitive
import "dotenv/config";
import { copyFile, access } from "node:fs/promises";
import path from "node:path";
import { listAllPins, uploadFileToNotion, attachPinImages } from "../src/notion.js";
import { readPacks } from "../src/packs.js";
import { rowForPack } from "../src/rowForPack.js";
import { renderPin, launchBrowser, TEMPLATE_NAMES } from "../src/render/renderPin.js";
import { slugify } from "../src/destination.js";

const needle = (process.argv[2] ?? "").toLowerCase();
if (!needle) {
  console.error("usage: npx tsx scripts/rerender-row.ts <part of the row name>");
  process.exit(2);
}
const rows = await listAllPins();
const matches = rows.filter((r) => r.name.toLowerCase().includes(needle) && (r.listItems ?? "").trim());
if (matches.length !== 1) {
  console.error(`${matches.length} rows match "${needle}": ${matches.map((r) => r.name).join(" | ")}`);
  process.exit(2);
}
const row = matches[0];
const slug = slugify(row.name);
const outDir = path.join("exports", "designs", slug);
console.log(`Re-rendering ${TEMPLATE_NAMES.length} templates for "${row.name}" → ${outDir}`);

const browser = await launchBrowser();
const uploads: { id: string; name: string }[] = [];
try {
  for (const template of TEMPLATE_NAMES) {
    const file = path.join(outDir, `${template}.png`);
    await renderPin({ name: row.name, listItems: row.listItems!, theme: row.theme, board: row.board }, template, file, browser);
    const filename = `${slug}--${template}.png`;
    uploads.push({ id: await uploadFileToNotion(file, filename), name: filename });
    console.log(`  ✓ ${template}`);
  }
} finally {
  await browser.close();
}
await attachPinImages(row.pageId, uploads);

let refreshed = 0;
for (const p of await readPacks("packs")) {
  if (p.text.exported) continue;
  if (rowForPack(p, rows)?.pageId !== row.pageId) continue;
  const src = path.join(outDir, `${p.template}.png`);
  try {
    await access(src);
  } catch {
    continue;
  }
  await copyFile(src, path.join(p.path, p.text.image || `${p.template}.png`));
  refreshed++;
  console.log(`  ↻ ${p.dir}`);
}
console.log(`Done: ${uploads.length} renders, ${refreshed} pending pack image(s) refreshed, Notion images replaced.`);
