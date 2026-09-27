// src/stages/links.ts — `clarity links`: where every live pin sends a reader,
// checked against the blog's own post list (../Clarity_blog/src/content/posts).
// Read-only: it reports, fixing a pin's link stays a deliberate step.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { auditLinks } from "../links.js";
import { listPinsWithMetrics } from "../pinterestApi.js";
import type { ApiPin } from "../report.js";

const POSTS_DIR = path.join("..", "Clarity_blog", "src", "content", "posts");

function section(label: string, pins: ApiPin[]): void {
  if (!pins.length) return;
  console.log(`\n${label} (${pins.length})`);
  for (const p of pins) {
    const title = p.title.trim() || "(untitled)";
    console.log(`  pinterest.com/pin/${p.id}  ${title.slice(0, 50)}  → ${p.link || "no link"}`);
  }
}

export async function runLinks(): Promise<void> {
  const [pins, files] = await Promise.all([listPinsWithMetrics(), readdir(POSTS_DIR)]);
  const slugs = new Set(files.filter((f) => /\.mdx?$/.test(f)).map((f) => f.replace(/\.mdx?$/, "")));
  const r = auditLinks(pins, slugs);
  const bad = r.noLink.length + r.offSite.length + r.notAPost.length + r.deadPost.length;
  console.log(`${pins.length} live pins checked against ${slugs.size} blog posts: ${r.ok} ok, ${bad} to fix, ${r.repins} repins of our own pins skipped`);
  section("Post the blog does not have — every click is a 404", r.deadPost);
  section("No link at all", r.noLink);
  section("Links off clarity-lists.com", r.offSite);
  section("On the site but not a post", r.notAPost);
  if (!bad) console.log("Every pin points at a live blog post.");
}
