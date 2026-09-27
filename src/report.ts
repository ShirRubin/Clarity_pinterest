// src/report.ts — the `clarity report` numbers: per-template A/B comparison,
// top pins and the outbound-click check, built from Pinterest API pin metrics.
// Pure — the API call and the pack index live in stages/report.ts.
//
// Pinterest's developer guidelines forbid storing data read from the API, and
// the privacy page at clarity-lists.com/privacy/ promises statistics are
// "requested from Pinterest when needed rather than kept". So this is a live
// report only: nothing here is written to Notion or to disk.
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
}

/** Which pack a pin came from — keyed by pin id from the POSTED lines in exports/posted/. */
export interface PinOrigin {
  template: string;
  slug: string;
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

  for (const p of pins) {
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
