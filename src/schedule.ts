// Cadence-aware date assignment for approved pins.
// Pure logic — no Notion, no filesystem — so it stays unit-testable.
// Rules (see DESIGN.md): 3 pins/day, and never the same destination URL
// twice within 72h. Earliest open slot wins.

export interface ScheduledEntry {
  date: string; // YYYY-MM-DD
  destUrl: string;
}

export interface QueueItem {
  id: string; // opaque — publish uses `${pageId}#${template}`
  destUrl: string;
}

export interface Assignment extends QueueItem {
  date: string;
}

export const PINS_PER_DAY = 3;
export const URL_GAP_DAYS = 3;

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function assignDates(
  existing: ScheduledEntry[],
  queue: QueueItem[],
  startDate: string,
): Assignment[] {
  const perDay = new Map<string, number>();
  const byUrl = new Map<string, number[]>();
  const book = (date: string, destUrl: string) => {
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
    byUrl.set(destUrl, [...(byUrl.get(destUrl) ?? []), toMs(date)]);
  };
  for (const e of existing) book(e.date, e.destUrl);

  const out: Assignment[] = [];
  for (const item of queue) {
    let ms = toMs(startDate);
    for (;;) {
      const date = toDate(ms);
      const dayFull = (perDay.get(date) ?? 0) >= PINS_PER_DAY;
      const urlClash = (byUrl.get(item.destUrl) ?? []).some(
        (other) => Math.abs(other - ms) < URL_GAP_DAYS * DAY_MS,
      );
      if (!dayFull && !urlClash) break;
      ms += DAY_MS;
    }
    const date = toDate(ms);
    book(date, item.destUrl);
    out.push({ ...item, date });
  }
  return out;
}
