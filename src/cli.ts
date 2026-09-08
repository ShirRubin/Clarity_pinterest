// clarity — the pipeline CLI. Usage: npm run clarity -- <command> [args]
// Stages advance rows through the Notion Status state machine:
// Idea → Drafted → Designed → In Review → Approved → Scheduled → Published
import "dotenv/config";
import { runIdeas } from "./stages/ideas.js";
import { runDraft } from "./stages/draft.js";
import { runDesign, runDesignTopUp } from "./stages/design.js";
import { runReview } from "./stages/review.js";
import { runApprove } from "./stages/approve.js";
import { runRevise } from "./stages/revise.js";
import { runPack } from "./stages/pack.js";
import { runBlogpost } from "./stages/blogpost.js";
import { runShip } from "./stages/ship.js";
import { runPostPlan } from "./stages/postplan.js";
import { runPosted } from "./stages/posted.js";
import { runReconcile } from "./stages/reconcile.js";
import { runQueue } from "./queue.js";
import { runStatus } from "./status.js";

const argv = process.argv.slice(3);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const words = argv.filter((a) => !a.startsWith("--"));
// Most commands take one optional number; a few take words.
const arg = words[0] && /^\d+$/.test(words[0]) ? parseInt(words[0], 10) : undefined;

const need = (n: number, usage: string) => {
  if (words.length < n) {
    console.error(`usage: clarity ${usage}`);
    process.exit(2);
  }
};

const commands: Record<string, { desc: string; run: () => Promise<unknown> }> = {
  status: { desc: "Whole-project status card: what needs you, the calendar, the blog, and open tasks", run: () => runStatus() },
  queue: { desc: "Queue health: days of posting runway, overdue packs, and how many lists to generate next", run: () => runQueue() },
  ideas: { desc: "Generate new bucket-list ideas → rows in status Idea (arg: count, default 5)", run: () => runIdeas(arg ?? 5) },
  draft: { desc: "Idea → Drafted: write list, pin title, description, keywords (arg: limit, default 10)", run: () => runDraft(arg ?? 10) },
  design: { desc: "Drafted → Designed: render pin image variants + upload to Notion (arg: limit, default 5)", run: () => runDesign(arg ?? 5) },
  topup: { desc: "Render any template a not-yet-posted row is missing (after TEMPLATE_NAMES grows) and re-attach the full set (arg: limit, default 100)", run: () => runDesignTopUp(arg ?? 100) },
  review: { desc: "Designed → In Review: stage for the Notion review queue", run: () => runReview(arg ?? 50) },
  approve: { desc: "In Review → Approved / Needs changes / Rejected via local review page (arg: port, default 4178)", run: () => runApprove(arg ?? 4178) },
  revise: { desc: "Needs changes → rewrite from your review notes, re-render, back to In Review (arg: limit, default 10)", run: () => runRevise(arg ?? 10) },
  ship: { desc: "Approved → blog post + packs + blog deploy, in one go (no browser)", run: () => runShip() },
  pack: { desc: "Approved → dated, time-slotted packs in exports/packs/ (arg: limit, default 10)", run: () => runPack(arg ?? 10) },
  publish: {
    desc: "(deprecated alias of pack)",
    run: () => {
      console.warn("`publish` is now `pack` — it no longer marks rows Published; `clarity posted` marks them Scheduled.");
      return runPack(arg ?? 10);
    },
  },
  "post-plan": { desc: "Packs to put on Pinterest, in order, inside the 29-day window (--json for the skill)", run: () => runPostPlan(flags.has("--json")) },
  posted: {
    desc: "Bookkeeping after one pin is scheduled: posted <pack-dir> <pin-id>",
    run: () => {
      need(2, "posted <pack-dir> <pin-id>");
      return runPosted(words[0], words[1]);
    },
  },
  reconcile: {
    desc: "Diff Pinterest's pin JSON against the packs: reconcile <scheduled.json> <created.json> [--apply]",
    run: () => {
      need(2, "reconcile <scheduled.json> <created.json> [--apply]");
      return runReconcile(words[0], words[1], flags.has("--apply"));
    },
  },
  blogpost: { desc: "Approved/Published lists → blog posts in Clarity_blog + Destination link → post URL (arg: limit, default 20)", run: () => runBlogpost(arg ?? 20) },
  stats: { desc: "Sync impressions/saves/clicks for Published pins", run: notYet("Phase 4") },
  run: {
    desc: "Full pipeline: ideas → draft → design → review (arg: idea count, default 3)",
    run: async () => {
      const n = arg ?? 3;
      await runIdeas(n);
      await runDraft(n);
      await runDesign(n);
      await runReview(n);
    },
  },
};

function notYet(phase: string) {
  return async () => {
    console.log(`Not implemented yet — planned for ${phase} of CLARITY_PLAN.md.`);
  };
}

const cmd = process.argv[2];
if (!cmd || !commands[cmd]) {
  console.log("clarity — Pinterest pipeline\n\nCommands:");
  for (const [name, { desc }] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(9)} ${desc}`);
  }
  process.exit(cmd ? 1 : 0);
}
await commands[cmd].run();
