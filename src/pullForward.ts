// src/pullForward.ts — plan moving far-future scheduled pins into short days.
// Pinterest holds at most 100 scheduled pins. When they are spread thinly over
// many weeks, the near days run short of PINS_PER_DAY while the cap is full.
// This takes the latest-dated pins and moves them into the earliest free slots
// (never within URL_GAP_DAYS of another pin to the same URL, scheduled or
// already published), until nothing later than the day being filled is left.
// Pure logic: the caller applies the moves on Pinterest and in the packs.
import { PINS_PER_DAY, SLOT_TIMES, URL_GAP_DAYS, localParts } from "./schedule.js";
import { toUtcStamp } from "./csv.js";

export interface PinAt {
  id: string;
  link?: string;
  ts: number; // unix seconds
}

export interface PullMove {
  id: string;
  fromDate: string;
  toDate: string;
  toTime: (typeof SLOT_TIMES)[number];
  toTs: number;
}

const DAY_MS = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const nextDay = (d: string) => new Date(dayMs(d) + DAY_MS).toISOString().slice(0, 10);
const slotTs = (date: string, time: string) => Date.parse(`${toUtcStamp(date, time)}Z`) / 1000;

export function planPullForward(scheduled: PinAt[], published: PinAt[], from: string): PullMove[] {
  // Where every scheduled pin sits now; moves update this as they are planned.
  const at = new Map(scheduled.map((p) => [p.id, { ...p, date: localParts(p.ts).date }]));
  const fixed = published.map((p) => ({ link: p.link, date: localParts(p.ts).date }));

  const clashes = (id: string, link: string | undefined, date: string) => {
    if (!link) return false;
    const near = (d: string) => Math.abs(dayMs(d) - dayMs(date)) < URL_GAP_DAYS * DAY_MS;
    for (const o of at.values()) if (o.id !== id && o.link === link && near(o.date)) return true;
    return fixed.some((o) => o.link === link && near(o.date));
  };

  const moves: PullMove[] = [];
  for (let day = from; ; day = nextDay(day)) {
    const later = () => [...at.values()].filter((p) => p.date > day).sort((a, b) => b.ts - a.ts);
    if (!later().length) break;
    const onDay = [...at.values()].filter((p) => p.date === day);
    const usedTimes = new Set(onDay.map((p) => p.ts));
    const freeTimes = SLOT_TIMES.filter((t) => !usedTimes.has(slotTs(day, t)));
    let room = PINS_PER_DAY - onDay.length;
    for (const time of freeTimes) {
      if (room <= 0) break;
      const pick = later().find((p) => !clashes(p.id, p.link, day));
      if (!pick) break;
      const toTs = slotTs(day, time);
      moves.push({ id: pick.id, fromDate: pick.date, toDate: day, toTime: time, toTs });
      at.set(pick.id, { ...pick, ts: toTs, date: day });
      room--;
    }
  }
  return moves;
}
