// src/csv.ts — one row per pack for Pinterest's bulk upload (Settings → Import
// content). Pure; the stage copies images, checks URLs and writes the file.
// Column set and limits come from help.pinterest.com's "bulk upload" article:
// Title ≤100, Description ≤500, Media URL must be a public link to the file,
// Publish date is UTC, and an unknown board name silently creates a board —
// so every board is checked against Pinterest's spelling before a row is made.
import { PINTEREST_BOARD_NAMES } from "./schema.js";
import { POST_TZ } from "./schedule.js";
import { SITE } from "./destination.js";
import { splitPackName } from "./packs.js";
import type { PlanEntry } from "./postplan.js";

export const CSV_HEADER = "Title,Media URL,Pinterest board,Thumbnail,Description,Link,Publish date,Keywords";
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 500;

const KNOWN_BOARDS = new Set<string>(Object.values(PINTEREST_BOARD_NAMES));

/** Where `clarity csv` publishes a pack's PNG so Pinterest can fetch it. */
export const mediaUrl = (slug: string, template: string) => `${SITE}/pins/${slug}/${template}.png`;

/** "09:00 AM" → [9, 0]. Same clock labels as SLOT_TIMES. */
function clock(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})\s+(AM|PM)$/.exec(time);
  if (!m) throw new Error(`Unrecognised slot time: ${time}`);
  let hour = parseInt(m[1], 10) % 12;
  if (m[3] === "PM") hour += 12;
  return [hour, parseInt(m[2], 10)];
}

/** The wall clock `tz` shows at instant `ms`, re-encoded as a UTC timestamp. */
function wallClockMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const n = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}

/** A posting-zone date + slot time as the UTC `YYYY-MM-DDTHH:MM:SS` Pinterest wants. */
export function toUtcStamp(date: string, time: string, tz = POST_TZ): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = clock(time);
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  // Start from the UTC reading and correct by the zone's offset at that
  // instant; the second pass settles the guess on a DST boundary day.
  let guess = wanted;
  for (let i = 0; i < 2; i++) guess += wanted - wallClockMs(guess, tz);
  return new Date(guess).toISOString().slice(0, 19);
}

const field = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Pinterest's description box is one paragraph; a pack's line breaks become spaces. */
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

export function buildCsv(entries: PlanEntry[], keywordsFor: (e: PlanEntry) => string[]): string {
  const problems: string[] = [];
  const rows = entries.map((e) => {
    const parts = splitPackName(e.pack);
    if (!parts) problems.push(`${e.pack}: not a pack directory name`);
    if (!KNOWN_BOARDS.has(e.board)) problems.push(`${e.pack}: board "${e.board}" is not one of Pinterest's boards`);
    if (e.title.length > TITLE_MAX) problems.push(`${e.pack}: title is ${e.title.length} chars (max ${TITLE_MAX})`);
    const description = oneLine(e.description);
    if (description.length > DESCRIPTION_MAX) {
      problems.push(`${e.pack}: description is ${description.length} chars (max ${DESCRIPTION_MAX})`);
    }
    return [
      e.title,
      parts ? mediaUrl(parts.slug, parts.template) : "",
      e.board,
      "", // Thumbnail — video only
      description,
      e.link,
      toUtcStamp(e.date, e.time),
      keywordsFor(e).join(", "),
    ]
      .map(field)
      .join(",");
  });
  if (problems.length) throw new Error(`Refusing to write the CSV:\n  ${problems.join("\n  ")}`);
  return [CSV_HEADER, ...rows].join("\r\n") + "\r\n";
}
