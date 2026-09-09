// src/stages/ship.ts — `clarity ship`: everything after approval that needs no
// browser. Blog post → packs → deploy the blog if this run wrote posts OR the
// blog on disk is already ahead of its last build. That second check is what
// makes "rerunning after a failure is safe" actually true for the deploy step:
// if `wrangler deploy` (or `pack`) fails after posts were written, the next
// `ship` finds those posts already on disk (so `written` comes back 0), but
// `blogBehind()` still sees the drift and retries the deploy.
import { execFileSync } from "node:child_process";
import { readdir, stat, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { runBlogpost } from "./blogpost.js";
import { runPack } from "./pack.js";
import { blogDrift } from "../status.js";

const BLOG_DIR = process.env.CLARITY_BLOG_DIR ?? path.join("..", "Clarity_blog");
// `astro build` wipes and recreates `dist` from scratch every time, so a marker
// dropped there only survives a run that reached the end of `deployBlog` — a
// crash between the build and a successful `wrangler deploy` (or a build that
// ran with no deploy at all) leaves a fresh `dist` with no marker, which is
// exactly the "looks current but isn't" case `deployBehind` below catches.
const DEPLOY_MARKER = path.join(BLOG_DIR, "dist", ".clarity-deployed");

async function deployBlog(): Promise<void> {
  // npx is a .cmd on Windows — shell:true is what makes it resolvable there.
  const run = (args: string[]) => execFileSync("npx", args, { cwd: BLOG_DIR, stdio: "inherit", shell: true });
  run(["astro", "build"]);
  run(["wrangler", "deploy"]);
  // Only reached once wrangler deploy actually succeeds (execFileSync throws
  // otherwise) — this is what lets the next run tell "deployed" from "built".
  await writeFile(DEPLOY_MARKER, new Date().toISOString(), "utf8");
}

// readdir that treats a missing directory as empty — mirrors src/status.ts's
// private helper of the same name (copied rather than exported, to keep this
// fix to a single file).
async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

// The newest mtime under a directory, or 0 when it has no files — mirrors
// src/status.ts's private helper of the same name.
async function newestMtime(dir: string): Promise<number> {
  const entries = await names(dir);
  let newest = 0;
  for (const e of entries) {
    try {
      const s = await stat(path.join(dir, e));
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    } catch {
      /* vanished mid-read — not worth failing a deploy decision over */
    }
  }
  return newest;
}

/**
 * Whether a fresh `dist` should still count as "behind" even though `blogDrift`
 * sees no gap: a build that never reached a successful `wrangler deploy` (crash,
 * or a bare `astro build` run by hand) leaves `dist/posts` populated with no
 * `DEPLOY_MARKER` — `astro build` would otherwise make that indistinguishable
 * from a real deploy on the next run.
 */
export function deployBehind(
  drift: { unbuilt: number; stale: boolean },
  builtPostsExist: boolean,
  markerExists: boolean,
): boolean {
  return drift.unbuilt > 0 || drift.stale || (builtPostsExist && !markerExists);
}

/** Whether the deployed blog is behind the posts already on disk (see status.ts's blogDrift). */
async function blogBehind(): Promise<boolean> {
  const postsDir = path.join(BLOG_DIR, "src", "content", "posts");
  const builtDir = path.join(BLOG_DIR, "dist", "posts");
  const [postFiles, builtFiles, newestPostMs, buildMs, markerExists] = await Promise.all([
    names(postsDir),
    names(builtDir),
    newestMtime(postsDir),
    newestMtime(builtDir),
    access(DEPLOY_MARKER).then(() => true, () => false),
  ]);
  const posts = postFiles.filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
  const drift = blogDrift({ posts: posts.length, built: builtFiles.length, newestPostMs, buildMs });
  return deployBehind(drift, builtFiles.length > 0, markerExists);
}

export async function runShip(): Promise<void> {
  console.log("--- blog posts ---");
  const written = await runBlogpost(50);
  console.log("\n--- packs ---");
  await runPack(50);

  // Only check disk drift when this run wrote nothing — when it did, that
  // alone is reason enough to deploy, and the drift is expected to be zero
  // right after runBlogpost/runPack complete anyway.
  const behind = written === 0 && (await blogBehind());
  if (written > 0 || behind) {
    const reason = written > 0
      ? `${written} new post${written === 1 ? "" : "s"}`
      : "posts on disk are newer than the last build";
    console.log(`\n--- deploying the blog (${reason}) ---`);
    await deployBlog();
  } else {
    console.log("\nNo new blog posts and the build is current — blog not redeployed.");
  }
  console.log("\nShip done — run `clarity post-plan` for what goes to Pinterest.");
}
