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

if (!apply) {
  console.log(`\n${decisions.length} row(s) would change. Re-run with --apply to write them.`);
  process.exit(0);
}
await ensureStatusOptions(); // "Scheduled" must exist on the live select
for (const d of decisions) await updatePin(d.pageId, { status: d.status, scheduledDate: d.scheduledDate });
console.log(`\n${decisions.length} row(s) migrated.`);
