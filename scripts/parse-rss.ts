// Parses the board RSS feeds in data/rss/ into data/backfill.json,
// the input for backfill-to-notion.ts. Re-runnable any time.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { BOARDS, type Board } from "../src/schema.js";

const SLUG_TO_BOARD: Record<string, Board> = {
  "travel-festivals": "Travel & Festivals",
  "books-learning-culture": "Books, Learning & Culture",
  "tv-movie-bucket-lists": "TV & Movie Bucket Lists",
  "aesthetic-life-lists": "Aesthetic Life Lists",
  "smart-creative-projects": "Smart & Creative Projects",
  "manifest-magic-life": "Manifest & Magic Life",
  "luxury-lifestyle": "Luxury & Lifestyle",
  "career-learn-new-skills": "Career & Learn New Skills",
};

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

const tag = (xml: string, name: string) =>
  (xml.match(new RegExp(`<${name}>(.*?)</${name}>`, "s")) || [])[1] ?? "";

interface BackfillPin {
  title: string;
  description: string;
  board: Board;
  pinUrl: string;
  imageUrl: string;
  publishedDate?: string;
}

const rssDir = new URL("../data/rss/", import.meta.url);
const pins: BackfillPin[] = [];
const seen = new Set<string>();

for (const file of readdirSync(rssDir).filter((f) => f.endsWith(".rss"))) {
  const slug = file.replace(/\.rss$/, "");
  const board = SLUG_TO_BOARD[slug];
  if (!board) {
    console.warn(`Skipping unknown board slug: ${slug}`);
    continue;
  }
  const xml = readFileSync(new URL(file, rssDir), "utf8");
  for (const item of xml.match(/<item>.*?<\/item>/gs) ?? []) {
    const pinUrl = decode(tag(item, "link"));
    if (!pinUrl || seen.has(pinUrl)) continue;
    seen.add(pinUrl);
    const text = decode(tag(item, "title"));
    const descHtml = decode(tag(item, "description"));
    const imageUrl = (descHtml.match(/img src="([^"]+)"/) || [])[1] ?? "";
    const parsed = new Date(decode(tag(item, "pubDate")));
    const pubDate = isNaN(parsed.getTime()) ? undefined : parsed;
    pins.push({
      // RSS "title" is the pin's caption; use its first sentence as the row name.
      title: text.split(/[.!?]\s/)[0].slice(0, 120) || `Pin ${pinUrl.split("/").filter(Boolean).pop()}`,
      description: text,
      board,
      pinUrl,
      // Upgrade thumbnail to the original-size image.
      imageUrl: imageUrl.replace("/236x/", "/originals/"),
      publishedDate: pubDate?.toISOString().slice(0, 10),
    });
  }
}

if (!BOARDS.every((b) => pins.some((p) => p.board === b))) {
  console.warn("Warning: some boards contributed no pins.");
}

writeFileSync(new URL("../data/backfill.json", import.meta.url), JSON.stringify(pins, null, 2));
console.log(`Wrote data/backfill.json with ${pins.length} pins across ${new Set(pins.map((p) => p.board)).size} boards.`);
