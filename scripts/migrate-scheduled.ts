// One-off: rows marked Published by the pre-milestone-1 `publish` stage whose
// pins have not gone live yet become Scheduled. Dry run by default.
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

const [rows, posted] = await Promise.all([listAllPins(), readPacks("posted")]);
const decisions = migrationDecisions(rows, posted, today);

console.log(`${rows.filter((r) => r.status === "Published").length} Published rows, ${posted.length} posted packs, today ${today}`);
if (!decisions.length) {
  console.log("Nothing to migrate — every Published row is already live.");
  process.exit(0);
}
for (const d of decisions) console.log(`${apply ? "✓" : "→"} ${d.name.slice(0, 60)}  Published → Scheduled  (first pin ${d.scheduledDate})`);

if (!apply) {
  console.log(`\n${decisions.length} row(s) would change. Re-run with --apply to write them.`);
  process.exit(0);
}
await ensureStatusOptions(); // "Scheduled" must exist on the live select
for (const d of decisions) await updatePin(d.pageId, { status: d.status, scheduledDate: d.scheduledDate });
console.log(`\n${decisions.length} row(s) migrated.`);
