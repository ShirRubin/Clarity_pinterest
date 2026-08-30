// Unattended generation run — the job Windows Task Scheduler fires twice a week.
// See scripts/register-task.ps1 to install it.
//
// It never posts and never approves: it tops the review queue up and stops.
// Approving stays the human gate, exactly as it is in a manual `clarity run`.
//
// Queue-aware by design — if the calendar already runs far enough ahead it exits
// without making a single Claude call, so it is safe to fire more often than needed.
//
//   npm run generate        # decide the batch size from queue health
//   npm run generate -- 2   # force 2 lists, ignoring queue health (for testing)
import "dotenv/config";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { queueHealth, formatQueueHealth } from "../src/queue.js";
import { runIdeas } from "../src/stages/ideas.js";
import { runDraft } from "../src/stages/draft.js";
import { runDesign } from "../src/stages/design.js";
import { runReview } from "../src/stages/review.js";

const today = new Date().toISOString().slice(0, 10);
const logFile = path.join("logs", `scheduled-run-${today}.log`);
mkdirSync("logs", { recursive: true });

// The stages print their own progress; tee it all so an overnight run is readable
// in the morning and Task Scheduler failures have something to point at.
for (const level of ["log", "warn", "error"] as const) {
  const write = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    write(...args);
    try {
      appendFileSync(logFile, args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n");
    } catch {
      // A log we cannot write must not take the run down with it.
    }
  };
}

const forced = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;

console.log(`\n=== clarity scheduled run — ${new Date().toISOString()} ===`);

try {
  const before = await queueHealth(today);
  console.log(formatQueueHealth(before));

  const n = forced ?? before.needed;
  if (forced !== undefined) console.log(`\n(forced batch of ${forced}, ignoring queue health)`);
  if (!n) {
    console.log(`\nNothing to generate. Exiting.`);
    process.exit(0);
  }

  console.log(`\n--- ideas (${n}) ---`);
  await runIdeas(n);
  console.log(`\n--- draft (${n}) ---`);
  await runDraft(n);
  console.log(`\n--- design (${n}) ---`);
  await runDesign(n);
  console.log(`\n--- review ---`);
  await runReview(n);

  console.log(`\n=== queue after the run ===`);
  console.log(formatQueueHealth(await queueHealth(today)));
  console.log(`\nLog: ${logFile}`);
} catch (err) {
  console.error(`\nx scheduled run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  console.error(`Log: ${logFile}`);
  process.exit(1);
}
