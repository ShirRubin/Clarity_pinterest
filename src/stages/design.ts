// Design engine: Drafted → Designed. Renders each list through every template
// (each variant is a "fresh pin" on Pinterest), writes PNGs to exports/designs/,
// uploads them to the Notion row and advances Status.
import path from "node:path";
import { pinsByStatus, updatePin, uploadFileToNotion, attachPinImages } from "../notion.js";
import { renderPin, launchBrowser, TEMPLATE_NAMES } from "../render/renderPin.js";

const OUT_DIR = "exports/designs";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

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
      const slug = slugify(row.name);
      const uploads: { id: string; name: string }[] = [];
      for (const template of TEMPLATE_NAMES) {
        const file = path.join(OUT_DIR, slug, `${template}.png`);
        await renderPin(
          { name: row.name, listItems: row.listItems, theme: row.theme, board: row.board },
          template,
          file,
          browser,
        );
        const filename = `${slug}--${template}.png`;
        uploads.push({ id: await uploadFileToNotion(file, filename), name: filename });
        console.log(`  ✓ ${template} → ${file}`);
      }
      await attachPinImages(row.pageId, uploads);
      await updatePin(row.pageId, { status: "Designed" });
      console.log(`✓ Designed: ${row.name} (${uploads.length} variants attached)`);
    }
  } finally {
    await browser.close();
  }
  console.log("Design stage done.");
}
