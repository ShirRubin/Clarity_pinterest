// clarity — the pipeline CLI. Usage: npm run clarity -- <command> [args]
// Stages advance rows through the Notion Status state machine:
// Idea → Drafted → Designed → In Review → Approved → Scheduled → Published
import "dotenv/config";
import { runIdeas } from "./stages/ideas.js";
import { runDraft } from "./stages/draft.js";
import { runCopy } from "./stages/copy.js";
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
import { runUnpost } from "./stages/unpost.js";
import { runCsv } from "./stages/csv.js";
import { runUploaded } from "./stages/uploaded.js";
import { runStats } from "./stages/stats.js";
import { runReport } from "./stages/report.js";
import { runLinks } from "./stages/links.js";
import { runQueue } from "./queue.js";
import { runStatus } from "./status.js";

const argv = process.argv.slice(3);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const words = argv.filter((a) => !a.startsWith("--"));
/** `--name=value` flags (e.g. `--from=2026-11-16`). */
const flagValue = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
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
  copy: { desc: "Pin title/description/alt/keywords for rows that have a list but no copy (the backfill catalogue) — status untouched (arg: limit, default 100)", run: () => runCopy(arg ?? 100) },
  design: { desc: "Drafted → Designed: render pin image variants + upload to Notion (arg: limit, default 5)", run: () => runDesign(arg ?? 5) },
  topup: { desc: "Render any template a not-yet-posted row is missing (after TEMPLATE_NAMES grows) and re-attach the full set (arg: limit, default 100)", run: () => runDesignTopUp(arg ?? 100) },
  review: { desc: "Designed → In Review: stage for the Notion review queue", run: () => runReview(arg ?? 50) },
  approve: { desc: "In Review → Approved / Needs changes / Rejected via local review page (arg: port, default 4178)", run: () => runApprove(arg ?? 4178) },
  revise: { desc: "Needs changes → rewrite from your review notes, re-render, back to In Review (arg: limit, default 10)", run: () => runRevise(arg ?? 10) },
  ship: { desc: "Approved → blog post + packs + blog deploy, in one go (no browser)", run: () => runShip() },
  pack: { desc: "Approved / Scheduled / Published rows with unposted variants → dated, time-slotted packs in exports/packs/ (arg: limit, default 10)", run: () => runPack(arg ?? 10) },
  publish: {
    desc: "(deprecated alias of pack)",
    run: () => {
      console.warn("`publish` is now `pack` — it no longer marks rows Published; `clarity posted` marks them Scheduled.");
      return runPack(arg ?? 10);
    },
  },
  csv: {
    desc: "Packs → one bulk-upload CSV for Pinterest (Settings → Import content), sized to the scheduler's free slots (cap 100); publishes the images first (arg: max pins, default = free slots; --from=YYYY-MM-DD and --window=DAYS slice the calendar; --scheduled=N takes Pinterest's own scheduled count over the books)",
    run: () => {
      const window = flagValue("window");
      const scheduled = flagValue("scheduled");
      return runCsv(arg, {
        from: flagValue("from"),
        windowDays: window ? parseInt(window, 10) : undefined,
        scheduled: scheduled ? parseInt(scheduled, 10) : undefined,
      });
    },
  },
  uploaded: {
    desc: "Bookkeeping after you uploaded a CSV: uploaded <csv-file> — packs → posted/, rows → Scheduled (pin ids arrive via reconcile)",
    run: () => {
      need(1, "uploaded <csv-file>");
      return runUploaded(words[0]);
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
    desc: "Diff Pinterest's pins against the packs: reconcile <scheduled.json> <created.json|api> [--apply], or reconcile api [--apply] for the published-only API pass (pin ids for live csv uploads; safe unattended)",
    run: () => {
      if (words[0] === "api" && words.length === 1) return runReconcile(undefined, "api", flags.has("--apply"));
      need(2, "reconcile <scheduled.json> <created.json|api> [--apply]  |  reconcile api [--apply]");
      return runReconcile(words[0], words[1], flags.has("--apply"));
    },
  },
  unpost: {
    desc: "Reverse of `uploaded` for a truncated CSV batch: posted packs Pinterest never took → back to packs/ (dry run without --apply)",
    run: () => {
      need(2, "unpost <scheduled.json> <created.json> [--apply]");
      return runUnpost(words[0], words[1], flags.has("--apply"));
    },
  },
  blogpost: { desc: "Approved/Published lists → blog posts in Clarity_blog + Destination link → post URL (arg: limit, default 20)", run: () => runBlogpost(arg ?? 20) },
  stats: { desc: "Import the Pinterest analytics CSVs in data/analytics/raw/ (older exports are archived first so the newest wins; --notion also writes per-pin stats + the summary page)", run: () => runStats(flags.has("--notion")) },
  report: { desc: "Live pin performance from the Pinterest API: totals, per-template A/B table, top pins (arg: min pin age in days to compare templates, default 14). Prints only, never stores", run: () => runReport(arg ?? 14) },
  links: { desc: "Link check over every live pin via the Pinterest API: missing links, off-site links, and posts the blog does not have", run: () => runLinks() },
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

const cmd = process.argv[2];
if (!cmd || !commands[cmd]) {
  console.log("clarity — Pinterest pipeline\n\nCommands:");
  for (const [name, { desc }] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(9)} ${desc}`);
  }
  process.exit(cmd ? 1 : 0);
}
await commands[cmd].run();
