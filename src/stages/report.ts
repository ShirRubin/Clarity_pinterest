// src/stages/report.ts — `clarity report [matureDays]`: live pin performance
// from the Pinterest API, split by template via the pin ids in exports/posted/.
// Prints only — see src/report.ts for why nothing is stored.
import { readPacks } from "../packs.js";
import { accountTotals, listPinsWithMetrics } from "../pinterestApi.js";
import { buildReport, type ApiPin, type PinOrigin } from "../report.js";

const pad = (s: string | number, n: number) => String(s).padStart(n);
const num = (n: number) => n.toLocaleString("en-US");

function pinLine(p: ApiPin, metric: number, label: string): string {
  const title = p.title.length > 58 ? `${p.title.slice(0, 57)}…` : p.title;
  return `  ${pad(num(metric), 6)} ${label}  ${title}  (pinterest.com/pin/${p.id})`;
}

export async function runReport(matureDays = 14): Promise<void> {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const today = day(0);
  // Same window as the pins' own 90-day metrics; yesterday is the last complete day.
  const [pins, account, posted] = await Promise.all([listPinsWithMetrics(), accountTotals(day(-90), day(-1)), readPacks("posted")]);
  const origins = new Map<string, PinOrigin>();
  for (const pack of posted) {
    if (pack.text.posted?.pinId) origins.set(pack.text.posted.pinId, { template: pack.template, slug: pack.slug });
  }
  const r = buildReport(pins, origins, account, today, matureDays);
  const t = r.totals;

  console.log(`Pinterest — last 90 days, live from the API (${today}, nothing stored)\n`);
  console.log(`  ${num(t.pins)} pins · ${num(t.impression)} impressions · ${num(t.save)} saves · ${num(t.pinClick)} pin clicks · ${num(t.outboundClick)} outbound clicks`);
  if (r.outboundWarning) console.log(`\n  ⚠ ${r.outboundWarning}`);

  console.log(`\nTemplates — pipeline pins at least ${matureDays} days old, per 1,000 impressions`);
  console.log(`  ${"template".padEnd(18)} ${pad("pins", 5)} ${pad("impr.", 9)} ${pad("saves/1k", 9)} ${pad("clicks/1k", 10)} ${pad("outbound/1k", 12)}`);
  for (const row of r.templates) {
    console.log(
      `  ${row.template.padEnd(18)} ${pad(row.pins, 5)} ${pad(num(row.impression), 9)} ${pad(row.savesPer1k, 9)} ${pad(row.pinClicksPer1k, 10)} ${pad(row.outboundPer1k, 12)}`,
    );
  }
  console.log(`  (${r.tooNew} pipeline pins too new to compare · ${r.untracked} pins with no posted pack, e.g. pre-pipeline · ${r.repins} repins of our own pins left out)`);

  console.log(`\nTop pins by outbound clicks`);
  if (r.topOutbound.length) r.topOutbound.forEach((p) => console.log(pinLine(p, p.metrics.outboundClick, "out ")));
  else console.log("  none yet");
  console.log(`\nTop pins by saves`);
  r.topSaves.forEach((p) => console.log(pinLine(p, p.metrics.save, "saves")));
}
