// Pack stage — Approved → packs on disk (the row stays Approved).
// Each PNG variant becomes its own dated + time-slotted pack in exports/packs/;
// the scheduler (src/schedule.ts) assigns 3/day with a 72h gap per destination
// URL. `clarity posted` moves a pack to exports/posted/ once it is in Pinterest's
// scheduler and flips the row to Scheduled when all four variants are there.
import { cp, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { listAllPins, pinsByStatus, updatePin, type PinSummary } from "../notion.js";
import { TEMPLATE_NAMES } from "../render/renderPin.js";
import { postText } from "../packText.js";
import { readPacks } from "../packs.js";
import { assignDates, slotTime, type QueueItem, type ScheduledEntry } from "../schedule.js";
import { chooseDestination, postSlugForName, slugify } from "../destination.js";

const BLOG_DIR = process.env.CLARITY_BLOG_DIR ?? path.join("..", "Clarity_blog");
const POSTS_DIR = path.join(BLOG_DIR, "src", "content", "posts");

const exists = (p: string) => access(p).then(() => true, () => false);

// Blog post only (src/destination.ts) — a board URL is a dead end here: pack
// skips a directory that already exists, so a board-linked pack could never
// be repaired once the post shows up. A missing post means "not packable
// yet", not "link to the board"; the caller skips the row entirely.
async function destFor(row: PinSummary): Promise<string | undefined> {
  const onDisk = await exists(path.join(POSTS_DIR, `${postSlugForName(row.name)}.md`));
  const d = chooseDestination(row, onDisk);
  return d.source === "board" ? undefined : d.url;
}

// The posting calendar = every pack on disk, both directories (see src/packs.ts).
async function readCalendarFromPacks(): Promise<ScheduledEntry[]> {
  const all = [...(await readPacks("packs")), ...(await readPacks("posted"))];
  return all.filter((p) => p.text.link).map((p) => ({ date: p.date, destUrl: p.text.link }));
}

export async function runPack(limit = 10): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const all = await listAllPins();

  // Pre-scan packs dir to find already-packed variants.
  const alreadyPacked = new Map<string, string>(); // "slug--template" -> date
  for (const p of await readPacks("packs")) alreadyPacked.set(`${p.slug}--${p.template}`, p.date);

  // Existing calendar: live pipeline pins + scheduled packs on disk.
  const existing: ScheduledEntry[] = [
    ...all
      .filter((r) => r.source === "pipeline" && r.pinUrl && r.publishedDate)
      .map((r) => ({ date: r.publishedDate!.slice(0, 10), destUrl: r.destinationLink ?? chooseDestination(r, false).url })),
    ...(await readCalendarFromPacks()),
  ];

  // A row is fully packed once every template variant is on disk — it stays
  // Approved (this stage never flips status), so it would otherwise keep
  // reappearing here forever, burning a `limit` slot every run.
  const isFullyPacked = (row: PinSummary) =>
    TEMPLATE_NAMES.every((t) => alreadyPacked.has(`${slugify(row.name)}--${t}`));

  const approved = await pinsByStatus("Approved");
  const fullyPacked = approved.filter(isFullyPacked);
  const rows = approved.filter((r) => !isFullyPacked(r)).slice(0, limit);
  if (fullyPacked.length) {
    console.log(`(${fullyPacked.length} approved rows already fully packed — waiting for /clarity-post)`);
  }
  if (!rows.length) {
    console.log("Nothing to schedule — approve some In Review rows first (`clarity approve`).");
    return;
  }

  // One queue item per variant PNG — every variant is its own fresh pin.
  const queue: QueueItem[] = [];
  const rowsById = new Map<string, PinSummary>();
  const destByPageId = new Map<string, string>(); // pageId -> the post URL it was queued with
  const packedPerRow = new Map<string, Set<string>>(); // pageId -> Set of packed templates
  const firstDatePerRow = new Map<string, string>(); // pageId -> earliest date
  let skipped = 0;

  for (const row of rows) {
    const slug = slugify(row.name);
    const dest = await destFor(row);
    if (!dest) {
      skipped++;
      console.warn(`⚠ ${slug}: no blog post yet — skipped. Run \`clarity blogpost\` (or \`clarity ship\`) first.`);
      continue;
    }
    rowsById.set(row.pageId, row);
    destByPageId.set(row.pageId, dest);
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
        queue.push({ id: `${row.pageId}#${t}`, destUrl: dest });
      }
    }

    packedPerRow.set(row.pageId, packedTemplates);
    if (earliestDate) {
      firstDatePerRow.set(row.pageId, earliestDate);
    }
  }

  const assigned = assignDates(existing, queue, today);

  let packed = 0;
  const newlyPacked = new Set<string>(); // pageIds this run actually wrote a variant for
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
    await writeFile(
      path.join(packDir, "post.txt"),
      postText({
        date: a.date,
        time: slotTime(a.slot),
        pageId,
        image: `${template}.png`,
        title: row.pinTitle ?? row.name,
        description: row.pinDescription ?? "",
        alt: row.altText ?? "",
        board: row.board ?? "(pick manually)",
        link: a.destUrl,
      }),
      "utf8",
    );

    // Track successfully packed template
    const packedSet = packedPerRow.get(pageId)!;
    packedSet.add(template);
    newlyPacked.add(pageId);

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
      // Only write Notion when this run packed something new — a row already
      // fully packed by an earlier run never reaches here (filtered out of
      // `rows` above), but a row completed by this run still needs the write.
      if (!newlyPacked.has(pageId)) continue;
      const date = firstDatePerRow.get(pageId)!;
      await updatePin(pageId, {
        scheduledDate: date,
        destinationLink: destByPageId.get(pageId)!,
      });
    } else if (packedSet.size > 0) {
      const row = rowsById.get(pageId)!;
      const slug = slugify(row.name);
      console.warn(
        `⚠ ${slug}: only ${packedSet.size}/${TEMPLATE_NAMES.length} variants packed — row left unscheduled for a future run`,
      );
    }
  }
  const skippedNote = skipped ? ` (${skipped} row(s) skipped — missing blog post)` : "";
  console.log(`\n${packed} pack(s) written to exports/packs/ — run /clarity-post to put them on Pinterest.${skippedNote}`);
}
