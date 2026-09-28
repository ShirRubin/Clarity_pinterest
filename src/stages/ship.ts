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

export const BLOG_DIR = process.env.CLARITY_BLOG_DIR ?? path.join("..", "Clarity_blog");
// `astro build` wipes and recreates `dist` from scratch every time, so a marker
// dropped there only survives a run that reached the end of `deployBlog` — a
// crash between the build and a successful `wrangler deploy` (or a build that
// ran with no deploy at all) leaves a fresh `dist` with no marker, which is
// exactly the "looks current but isn't" case `deployBehind` below catches.
const DEPLOY_MARKER = path.join(BLOG_DIR, "dist", ".clarity-deployed");

/**
 * How a finished blog build reaches clarity-lists.com (env CLARITY_BLOG_DEPLOY):
 * - "wrangler" (default): `wrangler deploy` from this machine, as it always was.
 * - "git": commit the pipeline's blog files on `main` and push; Cloudflare
 *   Workers Builds (A3) builds and deploys each push, one at a time, which
 *   ends the parallel-deploy race. Only switch to "git" once a test push has
 *   been seen building and deploying end to end.
 */
export type DeployMode = "wrangler" | "git";

export function deployModeFrom(raw: string | undefined): DeployMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "" || v === "wrangler") return "wrangler";
  if (v === "git") return "git";
  throw new Error(`CLARITY_BLOG_DEPLOY must be "wrangler" or "git", not "${raw}"`);
}

/** Production is `main` only; anything else (notably `affiliates`, which
 *  carries an unreleased Worker script + D1 binding) must never deploy. */
export const PRODUCTION_BRANCH = "main";
export function branchProblem(branch: string): string | undefined {
  if (branch === PRODUCTION_BRANCH) return undefined;
  return `the blog checkout at ${BLOG_DIR} is on "${branch}", not "${PRODUCTION_BRANCH}", so refusing to deploy it to clarity-lists.com. Switch it back with \`git switch ${PRODUCTION_BRANCH}\` (work on other branches in a separate worktree).`;
}

// The files the pipeline writes into the blog (posts + their cover images +
// printable PDFs). public/pins/ is git-ignored on purpose (~370 MB), see csv.ts.
export const PIPELINE_BLOG_PATHS = ["src/content/posts", "public/images", "public/downloads"];

const git = (args: string[]) =>
  execFileSync("git", args, { cwd: BLOG_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

/** Commit whatever the pipeline wrote on main and push it; Workers Builds deploys. */
function pushToMain(): void {
  git(["add", "-A", "--", ...PIPELINE_BLOG_PATHS]);
  let staged = true;
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: BLOG_DIR, stdio: "ignore" });
    staged = false; // exit 0 = nothing staged
  } catch {
    /* exit 1 = there are staged changes */
  }
  if (staged) {
    const n = git(["diff", "--cached", "--name-only", "--", "src/content/posts"]).split(/\r?\n/).filter(Boolean).length;
    git(["commit", "-m", `clarity ship: ${n} post file${n === 1 ? "" : "s"} from the nightly pipeline`]);
  }
  // Another session may have pushed since; replay ours on top rather than fail.
  git(["pull", "--rebase", "origin", PRODUCTION_BRANCH]);
  execFileSync("git", ["push", "origin", PRODUCTION_BRANCH], { cwd: BLOG_DIR, stdio: "inherit" });
  console.log(staged ? "Pushed to main; Cloudflare Workers Builds deploys it (Deployments tab)." : "Nothing new to commit; main is pushed.");
}

/**
 * Build the blog and publish it. `direct` forces a `wrangler deploy` from this
 * machine even in "git" mode: `clarity csv` needs that, because the pin PNGs
 * it publishes live in git-ignored public/pins/ and a GitHub build cannot ship them.
 */
export async function deployBlog(opts: { direct?: boolean } = {}): Promise<void> {
  const mode = deployModeFrom(process.env.CLARITY_BLOG_DEPLOY);
  const problem = branchProblem(git(["rev-parse", "--abbrev-ref", "HEAD"]));
  if (problem) throw new Error(problem);
  // npx is a .cmd on Windows — shell:true is what makes it resolvable there.
  const run = (args: string[]) => execFileSync("npx", args, { cwd: BLOG_DIR, stdio: "inherit", shell: true });
  // The blog's house rule (no long dashes anywhere that renders) is enforced by
  // scripts/check-dashes.mjs; `npm run build` runs it as prebuild, this path must too.
  execFileSync("node", ["scripts/check-dashes.mjs"], { cwd: BLOG_DIR, stdio: "inherit", shell: true });
  // Built locally in both modes: in "git" mode it is the pre-push check, so a
  // broken build never reaches main.
  run(["astro", "build"]);
  if (mode === "git" && !opts.direct) pushToMain();
  else run(["wrangler", "deploy"]);
  // Only reached once the deploy (or push) actually succeeds (execFileSync
  // throws otherwise). This is what lets the next run tell "deployed" from "built".
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
  console.log("\nShip done — run `clarity csv` for the bulk-upload file (or `clarity post-plan` for the browser route).");
}
