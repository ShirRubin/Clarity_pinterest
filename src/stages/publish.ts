// Publish stage — Stage A (no Pinterest API): Approved → Published.
// Each PNG variant becomes its own dated pack in exports/packs/ — the
// scheduler (src/schedule.ts) assigns dates at 3/day with a 72h gap per
// destination URL. The packs directory is the calendar of record for
// scheduled-but-unposted pins; a row's Pin URL in Notion is the proof a
// pin is actually live. Stage B (direct API posting) replaces this once
// Pinterest Standard access lands.
import { cp, mkdir, writeFile, access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { listAllPins, pinsByStatus, updatePin, type PinSummary } from "../notion.js";
import { TEMPLATE_NAMES } from "../render/renderPin.js";
import { assignDates, type QueueItem, type ScheduledEntry } from "../schedule.js";

const PROFILE_URL = "https://www.pinterest.com/ClarityBucketLists/";

// Until the blog is live, each pin links to ITS BOARD's URL, not the profile:
// destinations stay unique per board, so the 72h-per-URL rule still lets
// several pins go out the same day. Slugs match data/rss/.
const BOARD_URLS: Record<string, string> = {
  "TV & Movie Bucket Lists": `${PROFILE_URL}tv-movie-bucket-lists/`,
  "Aesthetic Life Lists": `${PROFILE_URL}aesthetic-life-lists/`,
  "Travel & Festivals": `${PROFILE_URL}travel-festivals/`,
  "Books · Learning & Culture": `${PROFILE_URL}books-learning-culture/`,
  "Smart & Creative Projects": `${PROFILE_URL}smart-creative-projects/`,
  "Manifest & Magic Life": `${PROFILE_URL}manifest-magic-life/`,
  "Luxury & Lifestyle": `${PROFILE_URL}luxury-lifestyle/`,
  "Career & Learn New Skills": `${PROFILE_URL}career-learn-new-skills/`,
};

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const destFor = (row: PinSummary) => (row.board && BOARD_URLS[row.board]) || PROFILE_URL;

// The posting calendar = the pack dirs on disk, across BOTH directories.
// exports/packs/ holds pins not yet handed to Pinterest; exports/posted/ holds
// ones already handed over. Posted packs are moved by hand after a batch session,
// but a future-dated one is still occupying that slot in Pinterest's scheduler —
// reading only packs/ made the calendar look empty and let a publish run stack a
// fresh 3/day on top of pins already scheduled. Past-dated posted packs matter
// too: they are live pins, so the 72h same-URL rule still has to see them.
// Deleting either directory loses the schedule (Notion only holds each row's
// earliest variant date).
const CALENDAR_DIRS = ["packs", "posted"];

async function readCalendarFromPacks(): Promise<ScheduledEntry[]> {
  const out: ScheduledEntry[] = [];
  for (const sub of CALENDAR_DIRS) {
    const dir = path.join("exports", sub);
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      continue;
    }
    for (const name of names) {
      const m = /^(\d{4}-\d{2}-\d{2})--/.exec(name);
      if (!m) continue;
      try {
        const txt = await readFile(path.join(dir, name, "post.txt"), "utf8");
        const dest = /^DESTINATION LINK: (\S+)/m.exec(txt)?.[1];
        if (dest) out.push({ date: m[1], destUrl: dest });
      } catch {
        // pack without post.txt — ignore
      }
    }
  }
  return out;
}

function postText(row: PinSummary, date: string, template: string, dest: string): string {
  return [
    `POST ON: ${date}   (native scheduler: toggle "Publish at a later date")`,
    ``,
    `IMAGE: ${template}.png`,
    ``,
    `TITLE (paste as pin title):`,
    row.pinTitle ?? row.name,
    ``,
    `DESCRIPTION (paste as pin description):`,
    row.pinDescription ?? "",
    ``,
    `ALT TEXT (paste into the pin's alt-text field):`,
    row.altText ?? "",
    ``,
    `BOARD: ${row.board ?? "(pick manually)"}`,
    `DESTINATION LINK: ${dest}   <- swap for the blog post URL once the blog is live`,
    ``,
    `TAGGED TOPICS: always add 10 (the max) in the pin builder. The taxonomy has no`,
    `"bucket list"/"self care" topics — search concrete nouns from the list items`,
    `(tea, baking, candles, movie night...) plus vibe topics (Cozy Living, Autumn Day).`,
    ``,
    `After posting: paste the live pin's URL into the row's "Pin URL" in Notion.`,
  ].join("\n");
}

export async function runPublish(limit = 10): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const all = await listAllPins();

  // Pre-scan packs dir to find already-packed variants (new format only).
  const alreadyPacked = new Map<string, string>(); // "slug--template" -> date
  const dir = path.join("exports", "packs");
  try {
    const names = await readdir(dir);
    for (const name of names) {
      const parts = name.split("--");
      if (parts.length === 3) {
        // New format: date--slug--template
        const [date, slug, template] = parts;
        alreadyPacked.set(`${slug}--${template}`, date);
      }
      // Legacy 2-part format (date--slug) is ignored
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // packs dir doesn't exist yet
  }

  // Existing calendar: live pipeline pins + scheduled packs on disk.
  const existing: ScheduledEntry[] = [
    ...all
      .filter((r) => r.source === "pipeline" && r.pinUrl && r.publishedDate)
      .map((r) => ({ date: r.publishedDate!.slice(0, 10), destUrl: r.destinationLink ?? destFor(r) })),
    ...(await readCalendarFromPacks()),
  ];

  // Queue: date-less Published rows first (packs exported before scheduling
  // existed, still not live), then newly Approved rows.
  const needsDate = all.filter(
    (r) => r.source === "pipeline" && r.status === "Published" && !r.scheduledDate && !r.pinUrl,
  );
  const approved = await pinsByStatus("Approved");
  const rows = [...needsDate, ...approved].slice(0, limit);
  if (!rows.length) {
    console.log("Nothing to schedule — approve some In Review rows first (`clarity approve`).");
    return;
  }

  // One queue item per variant PNG — every variant is its own fresh pin.
  const queue: QueueItem[] = [];
  const rowsById = new Map<string, PinSummary>();
  const packedPerRow = new Map<string, Set<string>>(); // pageId -> Set of packed templates
  const firstDatePerRow = new Map<string, string>(); // pageId -> earliest date

  for (const row of rows) {
    rowsById.set(row.pageId, row);
    const slug = slugify(row.name);
    const packedTemplates = new Set<string>();
    let earliestDate: string | undefined;

    for (const t of TEMPLATE_NAMES) {
      const key = `${slug}--${t}`;
      if (alreadyPacked.has(key)) {
        // Already packed; don't queue it
        packedTemplates.add(t);
        const existingDate = alreadyPacked.get(key)!;
        if (!earliestDate || existingDate < earliestDate) {
          earliestDate = existingDate;
        }
      } else {
        queue.push({ id: `${row.pageId}#${t}`, destUrl: destFor(row) });
      }
    }

    packedPerRow.set(row.pageId, packedTemplates);
    if (earliestDate) {
      firstDatePerRow.set(row.pageId, earliestDate);
    }
  }

  const assigned = assignDates(existing, queue, today);

  let packed = 0;
  for (const a of assigned) {
    const [pageId, template] = a.id.split("#");
    const row = rowsById.get(pageId)!;
    const slug = slugify(row.name);
    const src = path.join("exports", "designs", slug, `${template}.png`);
    try {
      await access(src);
    } catch {
      console.warn(`⚠ Missing render ${src} — run \`clarity design\` again for this row.`);
      continue;
    }
    const packDir = path.join("exports", "packs", `${a.date}--${slug}--${template}`);
    await mkdir(packDir, { recursive: true });
    await cp(src, path.join(packDir, `${template}.png`));
    await writeFile(path.join(packDir, "post.txt"), postText(row, a.date, template, a.destUrl), "utf8");

    // Track successfully packed template
    const packedSet = packedPerRow.get(pageId)!;
    packedSet.add(template);

    // Track earliest date
    const currentEarliest = firstDatePerRow.get(pageId);
    if (!currentEarliest || a.date < currentEarliest) {
      firstDatePerRow.set(pageId, a.date);
    }

    packed++;
    console.log(`✓ ${a.date}  ${slug} (${template})`);
  }

  for (const [pageId, packedSet] of packedPerRow) {
    if (packedSet.size === TEMPLATE_NAMES.length) {
      const row = rowsById.get(pageId)!;
      const date = firstDatePerRow.get(pageId)!;
      await updatePin(pageId, {
        status: "Published",
        publishedDate: today,
        scheduledDate: date,
        destinationLink: destFor(row),
      });
    } else if (packedSet.size > 0) {
      const row = rowsById.get(pageId)!;
      const slug = slugify(row.name);
      console.warn(
        `⚠ ${slug}: only ${packedSet.size}/${TEMPLATE_NAMES.length} variants packed — row left unscheduled for a future run`,
      );
    }
  }
  console.log(`\n${packed} pack(s) scheduled in exports/packs/ — load them in the next batch posting session.`);
}
