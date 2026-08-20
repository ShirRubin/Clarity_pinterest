// Imports data/backfill.json (scraped from the live Pinterest profile)
// into Notion as Published rows with Source=backfill. Idempotent: skips
// pins whose Pin URL already exists in the database.
import { readFileSync } from "node:fs";
import "dotenv/config";
import { createPin, dbId, notionClient } from "../src/notion.js";
import type { Board } from "../src/schema.js";

interface BackfillPin {
  title: string;
  description?: string;
  board: Board;
  pinUrl: string;
  imageUrl?: string;
}

const pins: BackfillPin[] = JSON.parse(
  readFileSync(new URL("../data/backfill.json", import.meta.url), "utf8"),
);

const notion = notionClient();
const existing = new Set<string>();
let cursor: string | undefined;
do {
  const res = await notion.databases.query({
    database_id: dbId(),
    filter: { property: "Source", select: { equals: "backfill" } },
    start_cursor: cursor,
    page_size: 100,
  });
  for (const page of res.results) {
    const url = (page as { properties?: { ["Pin URL"]?: { url?: string | null } } }).properties?.["Pin URL"]?.url;
    if (url) existing.add(url);
  }
  cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
} while (cursor);

let created = 0;
for (const pin of pins) {
  if (existing.has(pin.pinUrl)) continue;
  await createPin({
    name: pin.title,
    status: "Published",
    source: "backfill",
    board: pin.board,
    pinTitle: pin.title,
    pinDescription: pin.description,
    pinUrl: pin.pinUrl,
    imageUrl: pin.imageUrl,
  });
  created++;
  console.log(`+ ${pin.title}`);
}
console.log(`Backfill done: ${created} created, ${pins.length - created} already present.`);
