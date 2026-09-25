// src/stages/stats.ts — `clarity stats [--notion]`
// Archives superseded exports in data/analytics/raw/, then runs the importer
// (scripts/import-analytics.ts) on what is left. Stats arrive as hand-exported
// CSVs from analytics.pinterest.com until the Pinterest API opens up.
import { spawnSync } from "node:child_process";
import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { staleExports } from "../stats.js";

const RAW_DIR = path.join("data", "analytics", "raw");

export async function runStats(toNotion: boolean): Promise<void> {
  const files = await readdir(RAW_DIR).catch(() => [] as string[]);
  const stale = staleExports(files);
  if (stale.length) {
    await mkdir(path.join(RAW_DIR, "archive"), { recursive: true });
    for (const f of stale) {
      await rename(path.join(RAW_DIR, f), path.join(RAW_DIR, "archive", f));
      console.log(`archived stale export: ${f}`);
    }
  }
  const command = `npx tsx scripts/import-analytics.ts${toNotion ? " --notion" : ""}`;
  const run = spawnSync(command, { stdio: "inherit", shell: true });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
