// One-off: reconcile each packed row's Status and Scheduled date with the packs on disk
// (the pre-milestone-1 `publish` marked rows Published at pack time; tonight's re-dating
// moved 10 packs). Dry run by default.
//
//   npx tsx scripts/migrate-scheduled.ts           # print what would change
//   npx tsx scripts/migrate-scheduled.ts --apply   # write it to Notion
import "dotenv/config";
import { listAllPins, updatePin, ensureStatusOptions } from "../src/notion.js";
import { readPacks } from "../src/packs.js";
import { migrationDecisions } from "../src/migrateScheduled.js";
import { localToday } from "../src/publishedFlip.js";
import { TEMPLATE_NAMES } from "../src/render/renderPin.js";

const apply = process.argv.includes("--apply");
const today = localToday();

const [rows, posted, pending] = await Promise.all([listAllPins(), readPacks("posted"), readPacks("packs")]);
const decisions = migrationDecisions(rows, posted, pending, today);

console.log(`${rows.length} rows, ${posted.length} posted + ${pending.length} pending packs, today ${today}`);
if (!decisions.length) {
  console.log("Nothing to migrate — every row's status and date are correct.");
  process.exit(0);
}
for (const d of decisions) console.log(`${apply ? "✓" : "→"} ${d.name.slice(0, 60)}  ${d.from} → ${d.status}  (first pin ${d.scheduledDate}, ${d.posted}/${d.total} posted)`);

const short = decisions.filter((d) => d.total < TEMPLATE_NAMES.length);
if (short.length) {
  console.log();
  console.log(
    `⚠ ${short.length} row(s) have fewer than ${TEMPLATE_NAMES.length} variants on disk — run \`clarity topup\` (renders the missing templates for Approved rows) and then \`clarity ship\` before the next /clarity-post, or they stay Approved forever.`,
  );
  for (const d of short) console.log(`   - ${d.name}  (${d.posted}/${d.total})`);
}

if (!apply) {
  console.log(`\n${decisions.length} row(s) would change. Re-run with --apply to write them.`);
  process.exit(0);
}
await ensureStatusOptions(); // "Scheduled" must exist on the live select
for (const d of decisions)
  await updatePin(d.pageId, { status: d.status, scheduledDate: d.scheduledDate, ...(d.publishedDate ? { publishedDate: d.publishedDate } : {}) });
console.log(`\n${decisions.length} row(s) migrated.`);
