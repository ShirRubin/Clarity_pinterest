// The nightly job — Windows Task Scheduler fires it every day at 02:00.
// See scripts/register-task.ps1 to install it.
//
// It never posts and never approves. In order:
//   1. revise   — "Needs changes" rows get the reviewer's note applied and go
//                 back to In Review (so a note typed on the phone is in the
//                 queue by morning);
//   2. generate — only if queue health says the calendar is running short
//                 (ideas → draft → design → review), exactly as before;
//   3. flip     — Scheduled rows whose pins have all gone live → Published.
//                 Date-based, no Pinterest call.
//   4. remind   — one Todoist task, due 09:00 with a reminder, kept open while
//                 anything sits in "In Review" and closed when the queue empties.
//                 Runs last so it sees the night's final state.
// Steps 1, 3 and 4 always run; step 2 is skipped (no Claude call) when the queue
// is healthy, so the job is safe to fire more often than needed.
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
import { runRevise } from "../src/stages/revise.js";
import { runPublishedFlip } from "../src/stages/publishedFlip.js";
import { runReviewReminder } from "../src/stages/reviewReminder.js";
import { localToday } from "../src/publishedFlip.js";

const today = localToday();
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

console.log(`\n=== clarity nightly run — ${new Date().toISOString()} (today in posting zone: ${today}) ===`);

let failed = false;
const step = async (name: string, fn: () => Promise<unknown>) => {
  console.log(`\n--- ${name} ---`);
  try {
    await fn();
  } catch (err) {
    failed = true;
    console.error(`x ${name} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
};

// 1. revise — a failure here must not stop the flip below, hence per-step try/catch.
await step("revise (Needs changes → In Review)", () => runRevise());

// 2. generate, only when the queue is short.
await step("generate", async () => {
  const before = await queueHealth(today);
  console.log(formatQueueHealth(before));
  const n = forced ?? before.needed;
  if (forced !== undefined) console.log(`(forced batch of ${forced}, ignoring queue health)`);
  if (!n) {
    console.log(`Queue is healthy — nothing to generate.`);
    return;
  }
  console.log(`\n--- ideas (${n}) ---`);
  await runIdeas(n);
  console.log(`\n--- draft (${n}) ---`);
  await runDraft(n);
  console.log(`\n--- design (${n}) ---`);
  await runDesign(n);
  console.log(`\n--- review ---`);
  await runReview(n);
  console.log(`\n=== queue after generating ===`);
  console.log(formatQueueHealth(await queueHealth(today)));
});

// 3. flip Scheduled → Published for rows dated before today.
await step("flip (Scheduled → Published)", () => runPublishedFlip(today));

// 4. remind — last, so the count covers rows revise and generate just added.
await step("remind (lists waiting in review)", () => runReviewReminder(today));

console.log(`\nLog: ${logFile}`);
process.exit(failed ? 1 : 0);
