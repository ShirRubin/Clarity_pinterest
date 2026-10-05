// src/freshness.ts — which lists are NEW to Pinterest, and the calendar order
// that puts them first. Pure; the stages read the packs and Notion.
//
// Why this exists (growth review, Oct 5 2026 — plan §1): the calendar is a
// FIFO of variant packs. 540 packs of lists Pinterest already knows read as
// 91 days of runway, so the nightly generator produced nothing for a month,
// and the few new lists that were approved were dated for December because
// every earlier slot was taken by a fourth skin of an old list. Pinterest
// rewards fresh content; a new image on an old URL is worth less than a new
// list. So runway is now also measured in NEW lists going live, and new
// lists jump the backlog.
//
// "New" = a pipeline list (not a backfill row — those are the 2025 pins
// Pinterest has already seen) with no pack in exports/posted/ yet. The first
// variant of such a list is a fresh pin; its three siblings are ordinary
// backlog, spaced by the URL gap like everything else.

import { seasonFor, seasonState, type Season } from "./season.js";

export interface CalendarPack {
  dir: string;
  date: string;
  slug: string;
  template: string;
  /** Written into a csv already — Pinterest may hold it, so it keeps its date. */
  exported?: boolean;
  /** The pin title, so the season can be read off it (the slug alone is the fallback). */
  title?: string;
}

/** A pack with its place in the re-dated calendar decided. */
export interface OrderedPack extends CalendarPack {
  /** Earliest date it may take: a seasonal window not open yet (this year's or next year's). */
  notBefore?: string;
  season?: Season;
  tier: "season" | "opener" | "backlog" | "parked";
}

/** Slugs of lists that have never had a pack in posted/. */
export function neverPostedSlugs(pending: Pick<CalendarPack, "slug">[], posted: Pick<CalendarPack, "slug">[]): Set<string> {
  const done = new Set(posted.map((p) => p.slug));
  return new Set(pending.map((p) => p.slug).filter((s) => !done.has(s)));
}

/**
 * Lists whose FIRST pin goes live inside [today, today + horizonDays): the
 * slug has no posted pack, `isNew(slug)` holds, and its earliest pending
 * pack is dated in the window. Returns the slugs, earliest first.
 */
export function freshLists(
  pending: CalendarPack[],
  posted: Pick<CalendarPack, "slug">[],
  today: string,
  horizonDays: number,
  isNew: (slug: string) => boolean,
): string[] {
  const never = neverPostedSlugs(pending, posted);
  const earliest = new Map<string, string>();
  for (const p of pending) {
    if (!never.has(p.slug) || !isNew(p.slug)) continue;
    const cur = earliest.get(p.slug);
    if (!cur || p.date < cur) earliest.set(p.slug, p.date);
  }
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + horizonDays * 86_400_000).toISOString().slice(0, 10);
  return [...earliest]
    .filter(([, d]) => d >= today && d < end)
    .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
    .map(([slug]) => slug);
}

/**
 * The order the re-dater hands packs to `assignDates`, and the earliest date
 * each may take:
 *   1. season  — packs whose seasonal window is open today, deadline first,
 *                one variant per list ahead of its siblings;
 *   2. opener  — the first variant of every never-posted new list (current
 *                date order, so earlier approvals stay earlier);
 *   3. backlog — everything else in its current order;
 *   4. parked  — seasonal packs whose window has not opened (`notBefore` =
 *                the window's first day, this year's or next year's). They sit
 *                last so they never take a near slot from the others.
 * Exported packs are not re-dated and must be filtered out by the caller.
 * The URL gap then spaces the sibling variants by itself.
 */
export function orderForCalendar(
  pending: CalendarPack[],
  posted: Pick<CalendarPack, "slug">[],
  isNew: (slug: string) => boolean,
  today?: string,
): OrderedPack[] {
  const never = neverPostedSlugs(pending, posted);
  const sorted = [...pending].sort((a, b) => a.date.localeCompare(b.date) || a.dir.localeCompare(b.dir));
  const season: OrderedPack[] = [];
  const openers: OrderedPack[] = [];
  const backlog: OrderedPack[] = [];
  const parked: OrderedPack[] = [];
  const seen = new Set<string>();
  const seasonSeen = new Set<string>();
  for (const p of sorted) {
    const s = today ? seasonFor(`${p.title ?? ""} ${p.slug}`, today) : undefined;
    if (s && today) {
      const state = seasonState(s, today);
      if (state === "open") {
        // The list's first in-window variant leads; its siblings follow the rest of the season.
        season.push({ ...p, season: s, tier: "season" });
        continue;
      }
      // "early" (this year's window ahead) or "late" (rolled to next year): wait for the window.
      parked.push({ ...p, season: s, notBefore: s.open, tier: "parked" });
      continue;
    }
    if (never.has(p.slug) && isNew(p.slug) && !seen.has(p.slug)) {
      seen.add(p.slug);
      openers.push({ ...p, tier: "opener" });
    } else {
      backlog.push({ ...p, tier: "backlog" });
    }
  }
  // Deadline first; within a list, keep variant order; a list's first variant
  // goes ahead of every list's second one so each season gets its openers early.
  const rank = (p: OrderedPack) => {
    const n = seasonSeen.has(p.slug) ? 1 : 0;
    seasonSeen.add(p.slug);
    return n;
  };
  const ranked = season.map((p) => ({ p, n: rank(p) }));
  ranked.sort((a, b) => a.n - b.n || a.p.season!.deadline.localeCompare(b.p.season!.deadline) || a.p.date.localeCompare(b.p.date));
  parked.sort((a, b) => a.notBefore!.localeCompare(b.notBefore!) || a.date.localeCompare(b.date));
  return [...ranked.map((r) => r.p), ...openers, ...backlog, ...parked];
}
