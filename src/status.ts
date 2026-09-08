// Clarity status — one card answering "what needs me right now?" across the whole
// project: the Notion review queue, the posting calendar, the blog, and the open
// tasks recorded in ../CLARITY_PLAN.md.
//
// `clarity queue` answers a narrower question (is the generator behind?) and this
// reuses its arithmetic rather than re-deriving runway. Everything added on top is
// split the same way: pure derivation first (tested in tests/status.test.ts), then
// one async gather that does all the I/O.
//
// Every filesystem read degrades to "nothing there" rather than throwing — a
// status command that crashes because a directory is missing is useless.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { listAllPins } from "./notion.js";
import { queueHealth, packNames, TARGET_RUNWAY_DAYS } from "./queue.js";

/** A Pinterest CSV export older than this is worth refreshing. */
export const ANALYTICS_STALE_DAYS = 7;

/** The unattended job runs Mon + Thu, so this is the longest healthy silence. */
export const MISSED_RUN_DAYS = 4;

/** How many days of the posting calendar the card previews. */
export const UPCOMING_DAYS = 5;

const DAY_MS = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY_MS);

/** "3 lists" / "1 list" — the card is read at a glance, so the grammar matters. */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface DayCount {
  date: string;
  count: number;
}

export interface ClarityStatus {
  today: string;
  // Acute queues — each one is work only you can clear.
  inReview: number;
  needsChanges: number;
  readyToPublish: number;
  packsWaiting: number;
  packsOverdue: number;
  // The calendar.
  scheduledOnPinterest: number;
  runwayDays: number;
  lastScheduledDate?: string;
  upcoming: DayCount[];
  // The generator.
  idea: number;
  drafted: number;
  designed: number;
  listsToGenerate: number;
  lastRun?: { date?: string; daysAgo?: number; missed: boolean };
  // The blog.
  blog: { posts: number; built: number; unbuilt: number; stale: boolean };
  // Long-running work.
  relink: { done: number; total: number; remaining: number };
  openTasks: string[];
  analytics: { latest?: string; daysOld?: number; stale: boolean };
}

// --- pure derivation ---------------------------------------------------------

interface PublishableRow {
  status?: string;
  source?: string;
  scheduledDate?: string;
  pinUrl?: string;
}

/**
 * How many lists `clarity publish` would pick up. Mirrors the queue publish.ts
 * builds: Approved rows, plus Published rows that never got a date or a live URL
 * (packed before scheduling existed and still not posted). Backfill rows are
 * imported history and never become packs.
 */
export function readyToPublish(rows: PublishableRow[]): number {
  return rows.filter((r) => {
    if (r.source === "backfill") return false;
    if (r.status === "Approved") return true;
    return r.status === "Published" && !r.scheduledDate && !r.pinUrl;
  }).length;
}

const dateOf = (packName: string) => /^(\d{4}-\d{2}-\d{2})--/.exec(packName)?.[1];

/**
 * The next `days` days of the posting calendar, one entry each. Days with no pin
 * are kept as zeroes — a gap in the cadence is exactly what you want to see.
 */
export function upcomingPins(names: string[], today: string, days: number): DayCount[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const date = dateOf(name);
    if (date) counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const out: DayCount[] = [];
  for (let i = 0; i < days; i++) {
    const date = toDate(toMs(today) + i * DAY_MS);
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}

/**
 * Whether the deployed blog is behind the posts on disk. `built` is what came out
 * of the last `astro build`; a post written or edited after that build has not
 * reached clarity-lists.com.
 */
export function blogDrift(input: {
  posts: number;
  built: number;
  newestPostMs: number;
  buildMs: number;
}): { unbuilt: number; stale: boolean } {
  if (!input.built) return { unbuilt: input.posts, stale: true };
  return {
    unbuilt: Math.max(0, input.posts - input.built),
    stale: input.newestPostMs > input.buildMs,
  };
}

/**
 * Relink progress. Pinterest's own links can't be read back, so this counts the
 * `done` flags in exports/relink-pins.json — accurate the moment anything records
 * progress there, and honest (nothing done) until then.
 */
export function relinkProgress(entries: { done?: boolean }[]): {
  done: number;
  total: number;
  remaining: number;
} {
  const done = entries.filter((e) => e.done).length;
  return { done, total: entries.length, remaining: entries.length - done };
}

/** Age of the newest data/analytics/snapshot-<date>.json. */
export function analyticsAge(
  files: string[],
  today: string,
): { latest?: string; daysOld?: number; stale: boolean } {
  const dates = files
    .map((f) => /^snapshot-(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1])
    .filter((d): d is string => !!d);
  if (!dates.length) return { stale: true };
  const latest = dates.reduce((a, b) => (a > b ? a : b));
  const daysOld = daysBetween(latest, today);
  return { latest, daysOld, stale: daysOld > ANALYTICS_STALE_DAYS };
}

/** Age of the newest logs/scheduled-run-<date>.log — did the Mon/Thu job fire? */
export function lastRunFrom(
  files: string[],
  today: string,
): { date?: string; daysAgo?: number; missed: boolean } {
  const dates = files
    .map((f) => /^scheduled-run-(\d{4}-\d{2}-\d{2})\.log$/.exec(f)?.[1])
    .filter((d): d is string => !!d);
  if (!dates.length) return { missed: true };
  const date = dates.reduce((a, b) => (a > b ? a : b));
  const daysAgo = daysBetween(date, today);
  return { date, daysAgo, missed: daysAgo > MISSED_RUN_DAYS };
}

/**
 * The `⏳ OPEN TASK — <headline>.` callouts in CLARITY_PLAN.md. The plan is the
 * project's to-do list, so the card reads it rather than keeping its own copy.
 */
export function openTasksFrom(planMarkdown: string): string[] {
  const out: string[] = [];
  const re = /OPEN TASK\s*[—-]\s*(.+?)\.?\*\*/g;
  for (const m of planMarkdown.matchAll(re)) out.push(m[1].trim());
  return out;
}

/** The acute queues, phrased for the headline. Long-running work is not here. */
export function attentionItems(s: ClarityStatus): string[] {
  const items: string[] = [];
  if (s.inReview) items.push(`${plural(s.inReview, "list")} in review`);
  if (s.needsChanges) items.push(`${plural(s.needsChanges, "list")} needing changes`);
  if (s.readyToPublish) items.push(`${plural(s.readyToPublish, "list")} ready to publish`);
  if (s.packsWaiting) items.push(`${plural(s.packsWaiting, "pack")} to post`);
  if (s.packsOverdue) items.push(`${plural(s.packsOverdue, "pack")} overdue`);
  return items;
}

export function severity(s: ClarityStatus): "ok" | "attention" | "urgent" {
  if (s.packsOverdue) return "urgent";
  return attentionItems(s).length ? "attention" : "ok";
}

// --- the card ----------------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sun 7 Sep 2026" — built by hand so the card reads the same on any machine. */
function pretty(date: string): string {
  const d = new Date(toMs(date));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const short = (date: string) => {
  const d = new Date(toMs(date));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
};

/** The far end of the calendar is weeks out, so it needs its month to make sense. */
const shortWithMonth = (date: string) => `${short(date)} ${MONTHS[new Date(toMs(date)).getUTCMonth()]}`;

/** A left-aligned count in a fixed gutter, so the numbers line up down the card. */
const row = (n: number | string, label: string, hint = "") =>
  `   ${String(n).padStart(3)}  ${label.padEnd(26)}${hint}`;

export function formatStatus(s: ClarityStatus): string {
  const items = attentionItems(s);
  const icon = { ok: "🟢", attention: "🟡", urgent: "🔴" }[severity(s)];
  const headline = items.length
    ? `${items.length === 1 ? "1 thing needs" : `${items.length} things need`} you`
    : "all clear";

  const L: string[] = [`${icon} CLARITY — ${pretty(s.today)} · ${headline}`, ""];

  L.push("⚡ NEEDS YOU NOW");
  if (items.length) {
    if (s.packsOverdue) L.push(row(s.packsOverdue, "packs OVERDUE", "post these first"));
    if (s.inReview) L.push(row(s.inReview, "lists in review", "clarity approve"));
    if (s.needsChanges) L.push(row(s.needsChanges, "lists needing changes", "clarity revise"));
    if (s.readyToPublish) L.push(row(s.readyToPublish, "lists ready to publish", "clarity publish"));
    if (s.packsWaiting) L.push(row(s.packsWaiting, "packs to post by hand", "exports/packs/"));
  } else {
    L.push("        nothing — the review queue is empty");
  }

  L.push("", "📅 CALENDAR");
  L.push(
    row(
      s.scheduledOnPinterest,
      "pins on Pinterest",
      s.lastScheduledDate
        ? `through ${shortWithMonth(s.lastScheduledDate)} · ${s.runwayDays} days of runway`
        : "nothing scheduled",
    ),
  );
  if (s.upcoming.length) {
    const strip = s.upcoming
      .map((d) => `${short(d.date)} ${d.count ? "●".repeat(d.count) : "–"}`)
      .join("   ");
    L.push(`        ${strip}`);
  }

  L.push("", "🏭 PIPELINE");
  const flow = [
    [s.idea, "Idea"],
    [s.drafted, "Drafted"],
    [s.designed, "Designed"],
  ] as const;
  const inFlight = flow.filter(([n]) => n).map(([n, name]) => `${n} ${name}`);
  L.push(`        ${inFlight.length ? inFlight.join(" · ") : "nothing between idea and review"}`);
  L.push(
    `        ${
      s.listsToGenerate
        ? `generate ${plural(s.listsToGenerate, "new list")} to reach a ${TARGET_RUNWAY_DAYS}-day runway`
        : "generator idle — the queue is healthy"
    }`,
  );
  if (s.lastRun) {
    const when = s.lastRun.date
      ? `last unattended run ${s.lastRun.date} (${plural(s.lastRun.daysAgo ?? 0, "day")} ago)`
      : "no unattended run has ever logged";
    L.push(`        ${when}${s.lastRun.missed ? "  ⚠ looks like a run was missed" : ""}`);
  }

  L.push("", "📝 BLOG");
  L.push(`        ${s.blog.posts} posts on disk · ${s.blog.built} built · live at clarity-lists.com`);
  if (s.blog.unbuilt || s.blog.stale) {
    const what = s.blog.unbuilt
      ? `${plural(s.blog.unbuilt, "post")} not built yet`
      : "posts edited since the last build";
    L.push(`        ⚠ ${what}  → npx astro build && npx wrangler deploy`);
  }

  L.push("", "📌 OPEN TASKS");
  const open: string[] = [];
  if (s.relink.remaining) {
    // Only claim a total once something has actually been recorded done — the todo
    // file is regenerated from what is left, so "130 of 130" would say nothing.
    const of = s.relink.done ? `${s.relink.remaining} of ${s.relink.total}` : `${s.relink.remaining}`;
    open.push(`relink pins on Pinterest — ${of} still point at a board`);
  }
  // The plan carries its own relink callout; the counter above supersedes it.
  const covered = (t: string) => s.relink.remaining > 0 && /relink/i.test(t);
  for (const t of s.openTasks) if (!covered(t)) open.push(t);
  if (s.analytics.stale) {
    open.push(
      s.analytics.latest
        ? `export fresh Pinterest stats — last import ${s.analytics.latest} (${plural(s.analytics.daysOld ?? 0, "day")} ago)`
        : "export Pinterest stats — nothing imported yet",
    );
  } else if (s.analytics.latest) {
    open.push(
      `stats current — imported ${s.analytics.latest} (${plural(s.analytics.daysOld ?? 0, "day")} ago)`,
    );
  }
  for (const t of open) L.push(`        • ${t}`);
  if (!open.length) L.push("        nothing outstanding");

  return L.join("\n");
}

// --- gathering ---------------------------------------------------------------

const BLOG = path.join("..", "Clarity_blog");
const PLAN = path.join("..", "CLARITY_PLAN.md");

/** readdir that treats a missing directory as empty — see the file header. */
async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** The newest mtime under a directory, or 0 when it has no files. */
async function newestMtime(dir: string): Promise<number> {
  const entries = await names(dir);
  let newest = 0;
  for (const e of entries) {
    try {
      const s = await stat(path.join(dir, e));
      if (s.mtimeMs > newest) newest = s.mtimeMs;
    } catch {
      /* vanished mid-read — not worth failing a status card over */
    }
  }
  return newest;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

export async function gatherStatus(
  today = new Date().toISOString().slice(0, 10),
): Promise<ClarityStatus> {
  // One Notion round trip, shared with queueHealth — the card is read often.
  const rows = await listAllPins();

  const postsDir = path.join(BLOG, "src", "content", "posts");
  const builtDir = path.join(BLOG, "dist", "posts");

  const [health, pending, submitted, postFiles, builtFiles, analyticsFiles, logFiles, plan, relink] =
    await Promise.all([
      queueHealth(today, rows),
      packNames("packs"),
      packNames("posted"),
      names(postsDir),
      names(builtDir),
      names(path.join("data", "analytics")),
      names("logs"),
      readText(PLAN),
      readJson<{ done?: boolean }[]>(path.join("exports", "relink-pins.json"), []),
    ]);

  const [newestPostMs, buildMs] = await Promise.all([
    newestMtime(postsDir),
    newestMtime(builtDir),
  ]);

  const posts = postFiles.filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
  const drift = blogDrift({
    posts: posts.length,
    built: builtFiles.length,
    newestPostMs,
    buildMs,
  });

  const upcomingFrom = [...pending, ...submitted];
  const scheduledOnPinterest = submitted.filter((n) => {
    const d = dateOf(n);
    return d !== undefined && d >= today;
  }).length;
  const packsWaiting = pending.filter((n) => {
    const d = dateOf(n);
    return d !== undefined && d >= today;
  }).length;

  return {
    today,
    inReview: health.inFlight["In Review"] ?? 0,
    needsChanges: rows.filter((r) => r.status === "Needs changes" && r.source !== "backfill").length,
    readyToPublish: readyToPublish(rows),
    packsWaiting,
    packsOverdue: health.pastDue,
    scheduledOnPinterest,
    runwayDays: health.daysOfRunway,
    lastScheduledDate: health.lastScheduledDate,
    upcoming: upcomingPins(upcomingFrom, today, UPCOMING_DAYS),
    idea: health.inFlight["Idea"] ?? 0,
    drafted: health.inFlight["Drafted"] ?? 0,
    designed: health.inFlight["Designed"] ?? 0,
    listsToGenerate: health.needed,
    lastRun: lastRunFrom(logFiles, today),
    blog: { posts: posts.length, built: builtFiles.length, ...drift },
    relink: relinkProgress(relink),
    openTasks: openTasksFrom(plan),
    analytics: analyticsAge(analyticsFiles, today),
  };
}

export async function runStatus(): Promise<void> {
  console.log(formatStatus(await gatherStatus()));
}
