// src/pinterestApi.ts — the Pinterest v5 API, read-only. App 1615659 is on
// Trial access (1000 calls/day), which reads the real account. Keep every use
// consistent with what the app application and clarity-lists.com/privacy/
// promise: own account only, statistics read live and never stored.
import type { ApiPin, PinMetrics } from "./report.js";
import { getAccessToken } from "./pinterestAuth.js";

const BASE = "https://api.pinterest.com/v5";

async function get<T>(pathAndQuery: string): Promise<T> {
  // OAuth store first (refreshes itself), .env PINTEREST_ACCESS_TOKEN as the fallback.
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    const hint = res.status === 401 ? " — the access token is invalid or expired; run `npm run clarity -- auth` to log in again" : "";
    throw new Error(`Pinterest API ${res.status} on ${pathAndQuery.split("?")[0]}${hint}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface RawPin {
  id: string;
  created_at: string;
  title: string | null;
  link: string | null;
  parent_pin_id: string | null;
  pin_metrics: {
    "90d"?: { impression?: number; save?: number; pin_click?: number; outbound_click?: number };
  } | null;
}

/** Every pin on the account with its 90-day metrics — about 100 pins per call. */
export async function listPinsWithMetrics(): Promise<ApiPin[]> {
  const out: ApiPin[] = [];
  let bookmark: string | undefined;
  do {
    const q = `/pins?page_size=100&pin_metrics=true${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""}`;
    const page = await get<{ items: RawPin[]; bookmark: string | null }>(q);
    for (const p of page.items) {
      const m = p.pin_metrics?.["90d"] ?? {};
      out.push({
        id: p.id,
        createdAt: p.created_at,
        title: p.title ?? "",
        link: p.link,
        parentPinId: p.parent_pin_id,
        metrics: {
          impression: m.impression ?? 0,
          save: m.save ?? 0,
          pinClick: m.pin_click ?? 0,
          outboundClick: m.outbound_click ?? 0,
        },
      });
    }
    bookmark = page.bookmark ?? undefined;
  } while (bookmark);
  return out;
}

/** Account-level totals for a date range — the numbers Pinterest's analytics dashboard shows. */
export async function accountTotals(startDate: string, endDate: string): Promise<PinMetrics> {
  const q = `/user_account/analytics?start_date=${startDate}&end_date=${endDate}&metric_types=IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK`;
  const r = await get<{ all: { summary_metrics: Record<string, number> } }>(q);
  const m = r.all.summary_metrics;
  return { impression: m.IMPRESSION ?? 0, save: m.SAVE ?? 0, pinClick: m.PIN_CLICK ?? 0, outboundClick: m.OUTBOUND_CLICK ?? 0 };
}

export type TrendType = "growing" | "monthly" | "seasonal" | "yearly";

/** One keyword from Pinterest's top-trends list. `time_series` is a weekly index, 0-100 against the keyword's own peak. */
export interface RawTrend {
  keyword: string;
  pct_growth_wow: number;
  pct_growth_mom: number;
  pct_growth_yoy: number;
  time_series: Record<string, number>;
}

/**
 * Pinterest's top search trends for a region. Unlike trends.pinterest.com's
 * /top_trends_filtered/ (see src/trends.ts), the API honours its filters:
 * `interest` is one of Pinterest's fixed topic ids (travel, wedding, …) and
 * `includeKeywords` keeps only searches containing those words.
 */
export async function topTrends(o: { region: string; type: TrendType; interest?: string; includeKeywords?: string[]; limit: number }): Promise<RawTrend[]> {
  const q = new URLSearchParams({ limit: String(o.limit) });
  if (o.interest) q.append("interests", o.interest);
  for (const k of o.includeKeywords ?? []) q.append("include_keywords", k);
  const r = await get<{ trends: RawTrend[] }>(`/trends/keywords/${encodeURIComponent(o.region)}/top/${o.type}?${q}`);
  return r.trends ?? [];
}
