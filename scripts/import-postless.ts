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
  // Boards from the account's earlier era, folded into today's 8 (category follows the board)
  "Healing & Glow-Up": "Aesthetic Life Lists",
  "Wellness & Fitness": "Aesthetic Life Lists",
  "Bestie & Family Goals": "Aesthetic Life Lists",
  "Family related bucket lists (restored)": "Aesthetic Life Lists",
  "Food Adventures": "Luxury & Lifestyle",
};
// "Pins by you" is Pinterest's catch-all, so those are routed by pin id
const BOARD_BY_ID: Record<string, Board> = {
  "1100356121465087591": "Aesthetic Life Lists", // 10-min movement
  "1100356121459093715": "Aesthetic Life Lists", // mother-daughter
  "1100356121458696845": "Luxury & Lifestyle", // breakfast ideas
  "1100356121457690709": "Books · Learning & Culture", // girl pop albums
  "1100356121457676232": "Books · Learning & Culture", // broadway & theatre
  "1100356121455108094": "Smart & Creative Projects", // music goals
  "1100356121455108080": "Aesthetic Life Lists", // eco friendly
  "1100356121455000488": "Smart & Creative Projects", // gardening
  "1100356121454465335": "Manifest & Magic Life", // bucket list for the mind
  "1100356121454465020": "Aesthetic Life Lists", // aerial acrobatics
  "1100356121454464748": "Aesthetic Life Lists", // pilates
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
  const board = BOARD_BY_ID[p.id] ?? (p.board ? BOARD[p.board] : undefined);
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
