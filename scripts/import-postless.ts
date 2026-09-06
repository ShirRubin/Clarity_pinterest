// One-off (2026-09-06): live Pinterest pins that had neither a Notion row nor a
// blog post. Reads exports/postless.json (dumped from Pinterest's own pin data
// in the browser), appends them to data/backfill.json (the catalog of record)
// and creates a Published/backfill row for each in Notion — after which
// `clarity blogpost` transcribes the list from the pin image and writes the post.
// Idempotent on Pin URL, like scripts/backfill-to-notion.ts.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { createPin, listAllPins } from "../src/notion.js";
import type { Board } from "../src/schema.js";

interface PostlessPin {
  id: string;
  title: string;
  description: string;
  board?: string;
  image?: string | null;
  created?: string;
}

// Pinterest board names → Notion Board options (Notion selects forbid commas)
const BOARD: Record<string, Board> = {
  "TV & Movie Bucket Lists": "TV & Movie Bucket Lists",
  "Aesthetic Life Lists": "Aesthetic Life Lists",
  "Travel & Festivals": "Travel & Festivals",
  "Books, Learning & Culture": "Books · Learning & Culture",
  "Smart & Creative Projects": "Smart & Creative Projects",
  "Manifest & Magic Life": "Manifest & Magic Life",
  "Luxury & Lifestyle": "Luxury & Lifestyle",
  "Career & Learn New Skills": "Career & Learn New Skills",
};

const apply = process.argv.includes("--apply");
const pins: PostlessPin[] = JSON.parse(readFileSync("exports/postless.json", "utf8"));
const catalogPath = new URL("../data/backfill.json", import.meta.url);
const catalog: { pinUrl: string }[] = JSON.parse(readFileSync(catalogPath, "utf8"));
const inCatalog = new Set(catalog.map((p) => p.pinUrl));
const inNotion = new Set((await listAllPins()).map((r) => r.pinUrl).filter(Boolean));

let added = 0;
let created = 0;
for (const p of pins) {
  const pinUrl = `https://www.pinterest.com/pin/${p.id}/`;
  const title = p.title.replace(/\s+/g, " ").trim();
  if (!p.image) {
    console.warn(`⚠ no image for ${p.id} "${title.slice(0, 40)}" — skipped (nothing to transcribe)`);
    continue;
  }
  const board = p.board ? BOARD[p.board] : undefined;
  if (p.board && !board) console.warn(`⚠ unknown board "${p.board}" on ${p.id} — row created without a board`);
  const entry = {
    title,
    description: p.description,
    board,
    pinUrl,
    imageUrl: p.image.replace("/736x/", "/originals/"),
    publishedDate: p.created ? new Date(p.created).toISOString().slice(0, 10) : undefined,
  };
  const flag = `${inCatalog.has(pinUrl) ? "" : "+catalog "}${inNotion.has(pinUrl) ? "" : "+notion"}`.trim() || "already present";
  console.log(`${flag.padEnd(16)} ${title.slice(0, 60)}  [${board ?? "-"}]`);
  if (!apply) continue;
  if (!inCatalog.has(pinUrl)) {
    catalog.push(entry as (typeof catalog)[number]);
    added++;
  }
  if (!inNotion.has(pinUrl)) {
    await createPin({
      name: title,
      status: "Published",
      source: "backfill",
      board,
      pinTitle: title,
      pinDescription: p.description,
      pinUrl,
      imageUrl: entry.imageUrl,
      publishedDate: entry.publishedDate,
    });
    created++;
  }
}
if (apply) {
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(`\n✓ data/backfill.json +${added} · Notion +${created} rows. Next: clarity blogpost`);
} else {
  console.log("\n(dry run — pass --apply to write data/backfill.json and create the Notion rows)");
}
