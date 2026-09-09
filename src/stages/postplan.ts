// src/stages/postplan.ts — `clarity post-plan [--json]`
import { listAllPins } from "../notion.js";
import { readPacks } from "../packs.js";
import { buildPostPlan, formatPostPlan } from "../postplan.js";
import { suggestTopics } from "../topics.js";
import { rowForPack } from "../rowForPack.js";

export async function runPostPlan(json = false): Promise<void> {
  const [pending, posted, rows] = await Promise.all([readPacks("packs"), readPacks("posted"), listAllPins()]);
  const today = new Date().toISOString().slice(0, 10);
  const plan = buildPostPlan(
    pending,
    today,
    (p) => {
      const r = rowForPack(p, rows);
      return suggestTopics(r?.listItems ?? "", r?.theme);
    },
    undefined,
    posted,
  );
  console.log(json ? JSON.stringify(plan.entries, null, 2) : formatPostPlan(plan));
}
