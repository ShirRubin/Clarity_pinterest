// clarity — the pipeline CLI. Usage: npm run clarity -- <command>
// Stages advance rows through the Notion Status state machine:
// Idea → Drafted → Designed → In Review → Approved → Published
import "dotenv/config";

const commands: Record<string, { desc: string; run: () => Promise<void> }> = {
  ideas: { desc: "Generate new bucket-list ideas → rows in status Idea", run: notYet("Phase 1") },
  draft: { desc: "Idea → Drafted: write list, pin title, description, keywords", run: notYet("Phase 1") },
  design: { desc: "Drafted → Designed: render 3–5 pin image variants", run: notYet("Phase 2") },
  review: { desc: "Designed → In Review: stage for the Notion review queue", run: notYet("Phase 3") },
  publish: { desc: "Approved → Published: write export packs (API posting in Phase 4)", run: notYet("Phase 3") },
  stats: { desc: "Sync impressions/saves/clicks for Published pins", run: notYet("Phase 4") },
  run: { desc: "Run the full pipeline: ideas → draft → design → review", run: notYet("Phase 3") },
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
