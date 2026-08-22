// clarity — the pipeline CLI. Usage: npm run clarity -- <command>
// Stages advance rows through the Notion Status state machine:
// Idea → Drafted → Designed → In Review → Approved → Published
import "dotenv/config";
import { runIdeas } from "./stages/ideas.js";
import { runDraft } from "./stages/draft.js";
import { runDesign } from "./stages/design.js";
import { runReview } from "./stages/review.js";
import { runPublish } from "./stages/publish.js";

const arg = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;

const commands: Record<string, { desc: string; run: () => Promise<void> }> = {
  ideas: { desc: "Generate new bucket-list ideas → rows in status Idea (arg: count, default 5)", run: () => runIdeas(arg ?? 5) },
  draft: { desc: "Idea → Drafted: write list, pin title, description, keywords (arg: limit, default 10)", run: () => runDraft(arg ?? 10) },
  design: { desc: "Drafted → Designed: render pin image variants + upload to Notion (arg: limit, default 5)", run: () => runDesign(arg ?? 5) },
  review: { desc: "Designed → In Review: stage for the Notion review queue", run: () => runReview(arg ?? 50) },
  publish: { desc: "Approved → Published: write export packs to exports/packs/ (API posting in Phase 4)", run: () => runPublish(arg ?? 10) },
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
    console.log(`  ${name.padEnd(8)} ${desc}`);
  }
  process.exit(cmd ? 1 : 0);
}
await commands[cmd].run();
