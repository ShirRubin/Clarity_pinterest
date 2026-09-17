// Refresh data/trends.json from a raw Pinterest Trends pull.
//
// Pinterest Trends is cookie-authenticated against the ClarityBucketLists login,
// so this cannot be automated: the nightly job has no browser and nobody logged
// in. The pull is a two-step job done roughly monthly.
//
//   1. npx tsx scripts/refresh-trends.ts --snippet
//      Prints a JavaScript snippet. Run it in a logged-in trends.pinterest.com
//      tab (Claude can paste it through Chrome). It fetches a year of weekly
//      search volume for every term in TREND_VOCABULARY and saves
//      clarity-trends-raw.json to your Downloads folder.
//
//   2. npx tsx scripts/refresh-trends.ts ~/Downloads/clarity-trends-raw.json
//      Converts that file into data/trends.json, which the ideas stage reads.
//
// Terms Pinterest declines to report are below its volume threshold — that is a
// real finding about demand, not an error, so they are listed rather than hidden.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  parseMetricsResponse,
  classify,
  TREND_VOCABULARY,
  METRICS_BATCH_SIZE,
  TRENDS_FILE,
  type TrendsCache,
} from "../src/trends.js";

const DEFAULT_RAW = path.join(os.homedir(), "Downloads", "clarity-trends-raw.json");

function snippet(): string {
  const vocab = JSON.stringify([...TREND_VOCABULARY]);
  return `const V=${vocab};
const date=(await fetch('/latest_available_date/',{credentials:'include'}).then(r=>r.json())).date;
const all=[];
for(let i=0;i<V.length;i+=${METRICS_BATCH_SIZE}){
  const batch=V.slice(i,i+${METRICS_BATCH_SIZE});
  const u=\`/metrics/?terms=\${batch.map(encodeURIComponent).join('%2C')}&country=US&end_date=\${date}&days=365&aggregation=2&normalize_against_group=false&predicted_days=0\`;
  const r=await fetch(u,{credentials:'include'}).then(r=>r.json());
  for(const e of (Array.isArray(r)?r:Object.values(r))) all.push({term:e.term,counts:(e.counts||[]).map(c=>c.normalizedCount)});
}
const payload=JSON.stringify({dataDate:date,country:'US',pulledAt:new Date().toISOString().slice(0,10),series:all});
const a=document.createElement('a');
a.href=URL.createObjectURL(new Blob([payload],{type:'application/json'}));
a.download='clarity-trends-raw.json';
document.body.appendChild(a);a.click();a.remove();
\`saved \${all.length} of \${V.length} terms\`;`;
}

const arg = process.argv[2];

if (arg === "--snippet") {
  console.log("Run this in a logged-in trends.pinterest.com tab:\n");
  console.log(snippet());
  process.exit(0);
}

const rawFile = arg ?? DEFAULT_RAW;
const raw = JSON.parse(await readFile(rawFile, "utf8")) as {
  dataDate?: string;
  country?: string;
  pulledAt?: string;
  series?: unknown;
};

const terms = parseMetricsResponse(raw.series);
if (!terms.length) {
  console.error(`x ${rawFile} contained no usable terms — re-run the snippet in a logged-in tab.`);
  process.exit(1);
}

const cache: TrendsCache = {
  fetchedAt: raw.pulledAt ?? new Date().toISOString().slice(0, 10),
  dataDate: raw.dataDate ?? "unknown",
  country: raw.country ?? "US",
  terms,
};

await mkdir(path.dirname(TRENDS_FILE), { recursive: true });
await writeFile(TRENDS_FILE, JSON.stringify(cache, null, 2) + "\n", "utf8");

const { rising, steady, fading, peaking } = classify(terms);
const missing = TREND_VOCABULARY.filter((v) => !terms.some((t) => t.term === v));

console.log(`Wrote ${TRENDS_FILE} — ${terms.length} terms, Pinterest data through ${cache.dataDate}.`);
console.log(`  rising ${rising.length} · steady ${steady.length} · fading ${fading.length} · peaking ${peaking.length}`);
if (rising.length) {
  console.log(`\nTop risers:`);
  for (const t of rising.slice(0, 10)) console.log(`  +${Math.round(t.momChange)}%  ${t.term} (index ${Math.round(t.searchCount)})`);
}
if (missing.length) {
  console.log(`\n${missing.length} term(s) below Pinterest's reporting threshold — no measurable demand:`);
  console.log(`  ${missing.join(", ")}`);
}
