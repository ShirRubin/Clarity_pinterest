// src/stages/trends.ts — `clarity trends`: what people search on Pinterest
// right now, live from the API, for picking the next lists. First the searches
// containing "bucket list" (and which ones the blog already answers), then the
// top searches in each of Clarity's topics.
// Prints only — see src/trendsReport.ts for why nothing is stored.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { topTrends, type TrendType } from "../pinterestApi.js";
import { pct, toRow, type TrendRow } from "../trendsReport.js";

const POSTS_DIR = path.join("..", "Clarity_blog", "src", "content", "posts");

/** Pinterest's topic ids closest to what the boards cover. */
const CLARITY_INTERESTS = ["travel", "diy_and_crafts", "home_decor", "food_and_drinks", "health", "entertainment", "event_planning", "wedding"];

const pad = (s: string | number, n: number) => String(s).padStart(n);

function line(r: TrendRow, withBlog: boolean): string {
  const kw = r.keyword.length > 38 ? `${r.keyword.slice(0, 37)}…` : r.keyword;
  const blog = withBlog ? `   ${r.coveredBy ? `✓ ${r.coveredBy}` : "NEW"}` : "";
  return `  ${kw.padEnd(38)} ${pad(pct(r.mom), 7)} ${pad(pct(r.yoy), 7)} ${pad(r.now, 7)}   ${r.peakMonth}${blog}`;
}

const header = (withBlog: boolean) => `  ${"search".padEnd(38)} ${pad("month", 7)} ${pad("year", 7)} ${pad("now", 7)}   peak${withBlog ? "  blog" : ""}`;

/** Live rows for every "bucket list" search (growing first, then the biggest), with blog coverage. ~2 API calls. */
export async function bucketListRows(region = "US"): Promise<TrendRow[]> {
  const files = await readdir(POSTS_DIR);
  const slugs = files.filter((f) => /\.mdx?$/.test(f)).map((f) => f.replace(/\.mdx?$/, ""));
  const [moving, steady] = await Promise.all([
    topTrends({ region, type: "growing", includeKeywords: ["bucket list"], limit: 50 }),
    topTrends({ region, type: "monthly", includeKeywords: ["bucket list"], limit: 50 }),
  ]);
  const seen = new Set<string>();
  return [...moving, ...steady].filter((t) => !seen.has(t.keyword) && !!seen.add(t.keyword)).map((t) => toRow(t, slugs));
}

export async function runTrends(o: { limit?: number; type?: string; region?: string; interests?: string[]; match?: string[] } = {}): Promise<void> {
  const region = o.region ?? "US";
  const perTopic = o.limit ?? 10;
  const type = (o.type ?? "growing") as TrendType;
  const match = o.match?.length ? o.match : ["bucket list"];
  const interests = o.interests?.length ? o.interests : CLARITY_INTERESTS;

  const files = await readdir(POSTS_DIR);
  const slugs = files.filter((f) => /\.mdx?$/.test(f)).map((f) => f.replace(/\.mdx?$/, ""));

  // "monthly" ranks by volume (the steady big searches); `type` adds what is moving now.
  const [moving, steady] = await Promise.all([
    topTrends({ region, type, includeKeywords: match, limit: 50 }),
    type === "monthly" ? Promise.resolve([]) : topTrends({ region, type: "monthly", includeKeywords: match, limit: 50 }),
  ]);
  const seen = new Set<string>();
  const matched = [...moving, ...steady].filter((t) => !seen.has(t.keyword) && !!seen.add(t.keyword)).map((t) => toRow(t, slugs));
  const gaps = matched.filter((r) => !r.coveredBy).length;

  console.log(`Pinterest trends — ${region}, live from the API (${new Date().toISOString().slice(0, 10)}, nothing stored)`);
  console.log(`month / year = search growth · now = this week against the search's own yearly peak (100) · pin 45-60 days before the peak\n`);
  console.log(`Searches containing "${match.join('" / "')}" (${type} first, then the biggest): ${matched.length}, ${gaps} with no post yet`);
  console.log(header(true));
  for (const r of matched) console.log(line(r, true));

  for (const interest of interests) {
    const rows = (await topTrends({ region, type, interest, limit: perTopic })).map((t) => toRow(t, slugs));
    console.log(`\nTop ${type} in ${interest.replace(/_/g, " ")}`);
    console.log(header(false));
    for (const r of rows) console.log(line(r, false));
  }
}
