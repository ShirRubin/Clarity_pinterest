// Design engine: Drafted → Designed. Renders each list through every template
// (each variant is a "fresh pin" on Pinterest), writes PNGs to exports/designs/,
// uploads them to the Notion row and advances Status.
//
// `runDesignTopUp` is the migration path for when TEMPLATE_NAMES grows (2 → 4 on
// 2026-09-06): rows already past Drafted only have the old variants on disk, and
// publish refuses to schedule a row until every template is packed — so without a
// top-up they would sit unscheduled forever. Renders are deterministic (palette and
// emoji are seeded by the list name), so re-rendering the old variants reproduces
// them byte-for-byte; the row's images are re-attached as one set because
// `attachPinImages` replaces the property rather than appending to it.
import path from "node:path";
import { access } from "node:fs/promises";
import { type Browser } from "playwright-core";
import { pinsByStatus, listAllPins, updatePin, uploadFileToNotion, attachPinImages, type PinSummary } from "../notion.js";
import { renderPin, launchBrowser, TEMPLATE_NAMES } from "../render/renderPin.js";

const OUT_DIR = "exports/designs";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** Render every template for one row, upload the set, and replace the row's images. */
async function designRow(row: PinSummary, browser: Browser): Promise<number> {
  const slug = slugify(row.name);
  const uploads: { id: string; name: string }[] = [];
  for (const template of TEMPLATE_NAMES) {
    const file = path.join(OUT_DIR, slug, `${template}.png`);
    await renderPin(
      { name: row.name, listItems: row.listItems!, theme: row.theme, board: row.board },
      template,
      file,
      browser,
    );
    const filename = `${slug}--${template}.png`;
    uploads.push({ id: await uploadFileToNotion(file, filename), name: filename });
    console.log(`  ✓ ${template} → ${file}`);
  }
  await attachPinImages(row.pageId, uploads);
  return uploads.length;
}

export async function runDesign(limit = 5): Promise<void> {
  const drafted = await pinsByStatus("Drafted");
  if (!drafted.length) {
    console.log("No rows in status Drafted — run `clarity draft` first.");
    return;
  }
  console.log(`Designing ${Math.min(drafted.length, limit)} of ${drafted.length} drafted lists…`);

  const browser = await launchBrowser();
  try {
    for (const row of drafted.slice(0, limit)) {
      if (!row.listItems) {
        console.warn(`⚠ Skipping "${row.name}" — no list items on the row.`);
        continue;
      }
      const n = await designRow(row, browser);
      await updatePin(row.pageId, { status: "Designed" });
      console.log(`✓ Designed: ${row.name} (${n} variants attached)`);
    }
  } finally {
    await browser.close();
  }
  console.log("Design stage done.");
}

/** Which templates have no PNG on disk for this row. */
async function missingTemplates(row: PinSummary): Promise<string[]> {
  const slug = slugify(row.name);
  const missing: string[] = [];
  for (const template of TEMPLATE_NAMES) {
    try {
      await access(path.join(OUT_DIR, slug, `${template}.png`));
    } catch {
      missing.push(template);
    }
  }
  return missing;
}

/**
 * Bring every not-yet-posted row up to the full template set. Targets the rows
 * publish will still touch: Designed / In Review / Approved, plus Published rows
 * that have neither a pin URL nor a scheduled date (packs exported before
 * scheduling existed). Rows already live or scheduled are left alone — their
 * extra variants belong to the "re-mine the catalogue" work, not to this.
 */
export async function runDesignTopUp(limit = 100): Promise<void> {
  const all = await listAllPins();
  const candidates = all.filter(
    (r) =>
      r.source === "pipeline" &&
      ((r.status !== undefined && ["Designed", "In Review", "Approved"].includes(r.status)) ||
        (r.status === "Published" && !r.pinUrl && !r.scheduledDate)),
  );

  const todo: { row: PinSummary; missing: string[] }[] = [];
  for (const row of candidates) {
    const missing = await missingTemplates(row);
    if (missing.length) todo.push({ row, missing });
  }
  if (!todo.length) {
    console.log(`All ${candidates.length} unposted rows already have every template (${TEMPLATE_NAMES.join(", ")}).`);
    return;
  }
  console.log(`Topping up ${Math.min(todo.length, limit)} of ${todo.length} rows missing variants…`);

  const browser = await launchBrowser();
  let done = 0;
  try {
    for (const { row, missing } of todo.slice(0, limit)) {
      if (!row.listItems) {
        console.warn(`⚠ Skipping "${row.name}" — no list items on the row.`);
        continue;
      }
      console.log(`${row.name}  [${row.status}] — missing ${missing.join(", ")}`);
      const n = await designRow(row, browser);
      done++;
      console.log(`✓ ${n} variants attached`);
    }
  } finally {
    await browser.close();
  }
  console.log(`Top-up done: ${done} row(s) now carry all ${TEMPLATE_NAMES.length} templates.`);
}
