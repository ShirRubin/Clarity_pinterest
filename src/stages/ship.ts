// src/stages/ship.ts — `clarity ship`: everything after approval that needs no
// browser. Blog post → packs → deploy the blog if anything new was written.
// Every step skips what exists, so rerunning after a failure is safe.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { runBlogpost } from "./blogpost.js";
import { runPack } from "./pack.js";

const BLOG_DIR = process.env.CLARITY_BLOG_DIR ?? path.join("..", "Clarity_blog");

function deployBlog(): void {
  // npx is a .cmd on Windows — shell:true is what makes it resolvable there.
  const run = (args: string[]) => execFileSync("npx", args, { cwd: BLOG_DIR, stdio: "inherit", shell: true });
  run(["astro", "build"]);
  run(["wrangler", "deploy"]);
}

export async function runShip(): Promise<void> {
  console.log("--- blog posts ---");
  const written = await runBlogpost(50);
  console.log("\n--- packs ---");
  await runPack(50);
  if (written) {
    console.log(`\n--- deploying the blog (${written} new post${written === 1 ? "" : "s"}) ---`);
    deployBlog();
  } else {
    console.log("\nNo new blog posts — blog not redeployed.");
  }
  console.log("\nShip done — run `clarity post-plan` for what goes to Pinterest.");
}
