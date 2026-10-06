// src/report.ts — the `clarity report` numbers: per-template A/B comparison,
// top pins and the outbound-click check, built from Pinterest API pin metrics.
// Pure — the API call and the pack index live in stages/report.ts.
//
// Pinterest's developer guidelines forbid storing data read from the API, and
// the privacy page at clarity-lists.com/privacy/ promises statistics are
// "requested from Pinterest when needed rather than kept". So this is a live
// report only: nothing here is written to Notion or to disk.
import { localParts } from "./schedule.js";
import { TEMPLATE_NAMES } from "./templates.js";

export interface PinMetrics {
  impression: number;
  save: number;
  pinClick: number;
  outboundClick: number;
}

export interface ApiPin {
  id: string;
  createdAt: string;
  title: string;
  link: string | null;
  /** Pinterest's rolling 90-day window. */
  metrics: PinMetrics;
  /** Set when this pin is a save of another pin. */
  parentPinId?: string | null;
  /** Pinterest answered with `pin_metrics: null` for this pin — it happens when
   *  two report runs overlap. The zeros in `metrics` are then not real. */
  metricsMissing?: boolean;
}

/** Which pack a pin came from — keyed by pin id from the POSTED lines in exports/posted/. */
export interface PinOrigin {
  template: string;
  slug: string;
}

/** What a posted pack contributes to pin attribution (a projection of PackInfo, so this file stays fs-free). */
export interface PostedPackRef {
  template: string;
  slug: string;
  title: string;
  /** The pack's POST ON date, in the posting zone. */
  date: string;
  /** The id recorded on the POSTED line, if any. Packs posted through the
   *  browser scheduler carry a *scheduler* id (38xx…) that the API never
   *  reports for the published pin, so this is a hint, not a key. */
  pinId?: string;
}

const norm = (s: string) => s.trim().toLowerCase();
const titleDateKey = (title: string, date: string) => `${norm(title)}@${date}`;

/** The posting-zone date a published pin went live. `created_at` from the API carries no zone and is UTC. */
export function publishedDate(createdAt: string): string {
  const iso = /Z|[+-]\d\d:\d\d$/.test(createdAt) ? createdAt : `${createdAt}Z`;
  return localParts(Math.floor(Date.parse(iso) / 1000)).date;
}

/**
 * Which pack each API pin came from. The POSTED pin id is tried first, then
 * the pin's title + go-live date — the same key `reconcile` matches on, and
 * unique across every pack written so far. Without the fallback the report
 * saw only the csv-uploaded packs (whose ids come from the API itself) and
 * showed every browser-scheduled template as 0 pins.
 */
export function matchOrigins(pins: ApiPin[], posted: PostedPackRef[]): Map<string, PinOrigin> {
  const byId = new Map<string, PinOrigin>();
  const byTitleDate = new Map<string, PinOrigin>();
  for (const pack of posted) {
    const origin = { template: pack.template, slug: pack.slug };
    if (pack.pinId) byId.set(pack.pinId, origin);
    byTitleDate.set(titleDateKey(pack.title, pack.date), origin);
  }
  const origins = new Map<string, PinOrigin>();
  for (const p of pins) {
    const origin = byId.get(p.id) ?? byTitleDate.get(titleDateKey(p.title, publishedDate(p.createdAt)));
    if (origin) origins.set(p.id, origin);
  }
  return origins;
}

export interface TemplateRow extends PinMetrics {
  template: string;
  pins: number;
  savesPer1k: number;
  pinClicksPer1k: number;
  outboundPer1k: number;
}

export interface Report {
  /** Account-level analytics (what Pinterest's own dashboard shows) + the pin count after repins. */
  totals: PinMetrics & { pins: number };
  /** Repins of our own pins — they echo the original's metrics, so they are left out everywhere. */
  repins: number;
  templates: TemplateRow[];
  /** Pack-tracked pins still inside the maturity window, left out of the template table. */
  tooNew: number;
  /** Pins with no posted pack (published before the pipeline, or ids never reconciled). */
  untracked: number;
  /** Pins Pinterest returned without metrics this run — their zeros are not real; re-run, never in parallel. */
  missingMetrics: number;
  topOutbound: ApiPin[];
  topSaves: ApiPin[];
  outboundWarning?: string;
}

/** Below this share of pin clicks turning into site visits, the pins are not sending readers anywhere. */
const OUTBOUND_FLOOR = 0.01;

const zero = (): PinMetrics => ({ impression: 0, save: 0, pinClick: 0, outboundClick: 0 });

function add(into: PinMetrics, m: PinMetrics): void {
  into.impression += m.impression;
  into.save += m.save;
  into.pinClick += m.pinClick;
  into.outboundClick += m.outboundClick;
}

const per1k = (n: number, impressions: number) => (impressions ? Math.round((n / impressions) * 10000) / 10 : 0);

function daysBetween(isoDate: string, today: string): number {
  return Math.floor((Date.parse(today) - Date.parse(isoDate.slice(0, 10))) / 86_400_000);
}

export function buildReport(
  allPins: ApiPin[],
  origins: Map<string, PinOrigin>,
  account: PinMetrics,
  today: string,
  matureDays: number,
  topN = 5,
): Report {
  // A repin of one of our own pins reports the original's metrics, so summing
  // both double-counts (the Mother-Daughter pin showed up twice at 3,412 saves).
  const own = new Set(allPins.map((p) => p.id));
  const pins = allPins.filter((p) => !(p.parentPinId && own.has(p.parentPinId)));
  const totals = { ...account, pins: pins.length };
  const byTemplate = new Map<string, PinMetrics & { pins: number }>(
    TEMPLATE_NAMES.map((t) => [t, { ...zero(), pins: 0 }]),
  );
  let tooNew = 0;
  let untracked = 0;
  const missingMetrics = pins.filter((p) => p.metricsMissing).length;

  for (const p of pins) {
    if (p.metricsMissing) continue; // zeros from a null answer would drag the template's rates down
    const origin = origins.get(p.id);
    if (!origin) {
      untracked++;
      continue;
    }
    if (daysBetween(p.createdAt, today) < matureDays) {
      tooNew++;
      continue;
    }
    const row = byTemplate.get(origin.template) ?? { ...zero(), pins: 0 };
    add(row, p.metrics);
    row.pins++;
    byTemplate.set(origin.template, row);
  }

  const templates = [...byTemplate].map(([template, r]) => ({
    template,
    ...r,
    savesPer1k: per1k(r.save, r.impression),
    pinClicksPer1k: per1k(r.pinClick, r.impression),
    outboundPer1k: per1k(r.outboundClick, r.impression),
  }));

  const top = (key: keyof PinMetrics) =>
    pins
      .filter((p) => p.metrics[key] > 0)
      .sort((a, b) => b.metrics[key] - a.metrics[key])
      .slice(0, topN);

  const report: Report = {
    totals,
    repins: allPins.length - pins.length,
    templates,
    tooNew,
    untracked,
    missingMetrics,
    topOutbound: top("outboundClick"),
    topSaves: top("save"),
  };
  if (totals.pinClick > 0 && totals.outboundClick / totals.pinClick < OUTBOUND_FLOOR) {
    report.outboundWarning =
      `Only ${totals.outboundClick} of ${totals.pinClick.toLocaleString("en-US")} pin clicks reached the site ` +
      `(${((totals.outboundClick / totals.pinClick) * 100).toFixed(2)}%). The full list on the image answers the ` +
      `reader — test a variant that keeps part of the list for the blog.`;
  }
  return report;
}

export interface Winner {
  title: string;
  impression: number;
  savesPer1k: number;
  pinClicksPer1k: number;
  template: string;
}

/** Mature pipeline pins ranked by saves per 1k impressions, over a minimum reach — what already works on this account. */
export function winners(allPins: ApiPin[], origins: Map<string, PinOrigin>, today: string, matureDays: number, n = 8, minImpressions = 100): Winner[] {
  const own = new Set(allPins.map((p) => p.id));
  return allPins
    .filter((p) => !p.metricsMissing && !(p.parentPinId && own.has(p.parentPinId)))
    .filter((p) => origins.has(p.id) && daysBetween(p.createdAt, today) >= matureDays && p.metrics.impression >= minImpressions)
    .map((p) => ({
      title: p.title,
      impression: p.metrics.impression,
      savesPer1k: per1k(p.metrics.save, p.metrics.impression),
      pinClicksPer1k: per1k(p.metrics.pinClick, p.metrics.impression),
      template: origins.get(p.id)!.template,
    }))
    .sort((a, b) => b.savesPer1k - a.savesPer1k || b.impression - a.impression)
    .slice(0, n);
}

/** The prompt block for the idea engine; "" when nothing has matured yet. */
export function formatWinners(w: Winner[]): string {
  if (!w.length) return "";
  return [
    `WHAT ALREADY WORKS ON THIS ACCOUNT (live Pinterest numbers, last 90 days, pins at least two weeks old; saves per 1,000 impressions):`,
    ...w.map((x) => `- "${x.title}" (${x.impression.toLocaleString("en-US")} impressions, ${x.savesPer1k} saves/1k)`),
    `Prefer topics and framings in this family when the demand data allows; never repeat a title.`,
  ].join("\n");
}
