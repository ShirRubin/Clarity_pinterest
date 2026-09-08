// src/postplan.ts — the ordered list of packs to put into Pinterest's scheduler,
// with every field the browser step needs and nothing left to derive.
import path from "node:path";
import { PINTEREST_BOARD_NAMES, type Board } from "./schema.js";
import { SLOT_TIMES } from "./schedule.js";
import type { PackInfo } from "./packs.js";

/** Pinterest's native scheduler rejects dates further out than this. */
export const SCHEDULER_WINDOW_DAYS = 29;

export interface PlanEntry {
  n: number;
  total: number;
  pack: string;
  pageId?: string;
  date: string;
  time: string;
  image: string;
  board: string;
  link: string;
  title: string;
  description: string;
  alt: string;
  topics: string[];
}

export interface PostPlan {
  entries: PlanEntry[];
  deferred: PackInfo[];
}

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

const minutesOf = (t: string): number => {
  const match = t.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let [, hourStr, minStr, ampm] = match;
  let hour = parseInt(hourStr);
  const min = parseInt(minStr);
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + min;
};

const slotIndexOf = (t: string): number => {
  return (SLOT_TIMES as readonly string[]).indexOf(t);
};

export function buildPostPlan(
  pending: PackInfo[],
  today: string,
  topicsFor: (p: PackInfo) => string[],
  windowDays = SCHEDULER_WINDOW_DAYS,
): PostPlan {
  const limit = toMs(today) + windowDays * DAY_MS;
  const inWindow = pending.filter((p) => toMs(p.date) <= limit);
  const deferred = pending
    .filter((p) => toMs(p.date) > limit)
    .sort((a, b) => a.date.localeCompare(b.date));

  // First pass: collect slot indexes taken by explicit times.
  const takenByDay = new Map<string, Set<number>>();
  for (const p of inWindow) {
    if (p.text.time) {
      const idx = slotIndexOf(p.text.time);
      if (idx >= 0) {
        const taken = takenByDay.get(p.date) ?? new Set();
        taken.add(idx);
        takenByDay.set(p.date, taken);
      }
    }
  }

  // Second pass: assign times and sort by time.
  const timed = [...inWindow]
    .sort((a, b) => a.date.localeCompare(b.date) || a.dir.localeCompare(b.dir))
    .map((p) => {
      if (p.text.time) {
        return { p, time: p.text.time };
      }
      const taken = takenByDay.get(p.date) ?? new Set();
      let slotIndex = 0;
      while (slotIndex < SLOT_TIMES.length && taken.has(slotIndex)) {
        slotIndex++;
      }
      if (slotIndex >= SLOT_TIMES.length) {
        slotIndex = SLOT_TIMES.length - 1;
      }
      taken.add(slotIndex);
      takenByDay.set(p.date, taken);
      return { p, time: SLOT_TIMES[slotIndex] };
    })
    .sort((a, b) => a.p.date.localeCompare(b.p.date) || minutesOf(a.time) - minutesOf(b.time));

  const entries = timed.map(({ p, time }, i) => ({
    n: i + 1,
    total: timed.length,
    pack: p.dir,
    ...(p.text.pageId ? { pageId: p.text.pageId } : {}),
    date: p.date,
    time,
    image: path.posix.join("exports", p.where, p.dir, p.text.image),
    board: PINTEREST_BOARD_NAMES[p.text.board as Board] ?? p.text.board,
    link: p.text.link,
    title: p.text.title,
    description: p.text.description,
    alt: p.text.alt,
    topics: topicsFor(p),
  }));
  return { entries, deferred };
}

export function formatPostPlan(plan: PostPlan): string {
  const L: string[] = [];
  for (const e of plan.entries) {
    L.push(`${e.n}/${e.total}  ${e.date}  ${e.time}  ${e.pack}`);
    L.push(`      image: ${e.image}`);
    L.push(`      board: ${e.board}`);
    L.push(`      link:  ${e.link}`);
    L.push(`      title: ${e.title}`);
    L.push(`      description: ${e.description.replace(/\n/g, "\n                   ")}`);
    L.push(`      alt: ${e.alt}`);
    L.push(`      topics: ${e.topics.join(" | ")}`);
    L.push(``);
  }
  if (!plan.entries.length) L.push("Nothing to post inside the scheduler window.");
  if (plan.deferred.length) {
    const n = plan.deferred.length;
    L.push(`${n} more pack${n === 1 ? "" : "s"} waiting for the ${SCHEDULER_WINDOW_DAYS}-day window (first: ${plan.deferred[0].date})`);
  }
  return L.join("\n");
}
