// src/stages/postplan.ts — `clarity post-plan [--json]`
import { listAllPins } from "../notion.js";
import { readPacks, type PackInfo } from "../packs.js";
import { buildPostPlan, formatPostPlan } from "../postplan.js";
import { suggestTopics } from "../topics.js";
import { slugify } from "../destination.js";

export async function runPostPlan(json = false): Promise<void> {
  const [pending, rows] = await Promise.all([readPacks("packs"), listAllPins()]);
  const today = new Date().toISOString().slice(0, 10);
  const rowFor = (p: PackInfo) =>
    rows.find((r) => (p.text.pageId ? r.pageId === p.text.pageId : r.source !== "backfill" && slugify(r.name) === p.slug));
  const plan = buildPostPlan(pending, today, (p) => {
    const r = rowFor(p);
    return suggestTopics(r?.listItems ?? "", r?.theme);
  });
  console.log(json ? JSON.stringify(plan.entries, null, 2) : formatPostPlan(plan));
}
