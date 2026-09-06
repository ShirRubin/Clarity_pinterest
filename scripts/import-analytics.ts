/**
 * Import Pinterest CSV exports into our data store and into Notion.
 *
 * Pinterest's v5 API analytics endpoints need approved app access (ours is
 * still on pending Trial), so the numbers arrive as hand-downloaded CSVs from
 * analytics.pinterest.com. Drop them in data/analytics/raw/ and run this.
 *
 *   npm run analytics              # parse + write the snapshot JSON only
 *   npm run analytics -- --notion  # ...and push per-pin stats to Notion
 *
 * Two export shapes are understood:
 *   "Pinterest Analytics overview <start>-<end>.csv" — daily impressions, a Top
 *      Boards table (impressions/engagement/clicks/outbound/saves) and a Top
 *      Pins table (impressions only — that is all Pinterest gives per pin).
 *   "audience-insights-<view>-<date>.csv" — audience size plus interest,
 *      country, metro, gender, device and age splits.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ensureSchemaProperties, listAllPins, updatePin, createPin, notionClient } from "../src/notion.js";

const RAW_DIR = join("data", "analytics", "raw");
const OUT_DIR = join("data", "analytics");
const LOOKUP_PATH = join(OUT_DIR, "pin-lookup.json");

// --- CSV parsing -----------------------------------------------------------

/** Split one CSV line, honouring "quoted, fields" and doubled-quote escapes. */
function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Pinterest stacks several tables into one file, separated by blank lines.
 * Split on those so each block can be identified by its own header row.
 */
function blocks(csv: string): string[][][] {
  const groups: string[][][] = [];
  let cur: string[][] = [];
  for (const raw of csv.split(/\r?\n/)) {
    if (!raw.trim()) {
      if (cur.length) groups.push(cur);
      cur = [];
      continue;
    }
    cur.push(splitRow(raw));
  }
  if (cur.length) groups.push(cur);
  return groups;
}

const num = (s: string | undefined) => {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && (s ?? "").trim() !== "" ? n : undefined;
};

// --- Shapes ----------------------------------------------------------------

interface BoardStat {
  board: string;
  url: string;
  impressions: number;
  engagement: number;
  pinClicks: number;
  outboundClicks: number;
  saves: number;
}
interface PinStat {
  pinId: string;
  url: string;
  contentType: string;
  source: string;
  impressions: number;
}
interface Split {
  label: string;
  percent: number;
}
interface Audience {
  asOf: string;
  aggregation: string;
  size: number;
  categories: Split[];
  interests: Split[];
  countries: Split[];
  metros: Split[];
  gender: Split[];
  device: Split[];
  age: Split[];
}
interface Snapshot {
  capturedAt: string;
  window: { start: string; end: string };
  sources: string[];
  totals: {
    impressions: number;
    engagement: number;
    pinClicks: number;
    outboundClicks: number;
    saves: number;
    days: number;
  };
  dailyImpressions: { date: string; impressions: number }[];
  boards: BoardStat[];
  topPins: PinStat[];
  audience?: Audience;
}

// --- Overview export -------------------------------------------------------

function parseOverview(csv: string) {
  const window = { start: "", end: "" };
  const daily: { date: string; impressions: number }[] = [];
  const boards: BoardStat[] = [];
  const topPins: PinStat[] = [];

  for (const g of blocks(csv)) {
    // The window sits on its own line inside the leading settings block, so
    // scan every row rather than only the block header.
    for (const r of g) {
      const m = r[0]?.match(/^(\d{4}-\d{2}-\d{2}) - (\d{4}-\d{2}-\d{2})$/);
      if (m && !window.start) {
        window.start = m[1];
        window.end = m[2];
      }
    }
    if (g[0][0] === "Date" && g[0][1] === "Impressions") {
      for (const r of g.slice(1)) {
        const v = num(r[1]);
        if (/^\d{4}-\d{2}-\d{2}$/.test(r[0]) && v !== undefined) daily.push({ date: r[0], impressions: v });
      }
    }
    // The section title is its own line; the column header sits on the next one.
    if (g[0][0]?.startsWith("Top Boards")) {
      for (const r of g.slice(2)) {
        if (!r[0]?.includes("/")) continue;
        const slug = r[0].replace(/\/$/, "").split("/").pop() ?? r[0];
        boards.push({
          board: slug,
          url: r[0],
          impressions: num(r[1]) ?? 0,
          engagement: num(r[2]) ?? 0,
          pinClicks: num(r[3]) ?? 0,
          outboundClicks: num(r[4]) ?? 0,
          saves: num(r[5]) ?? 0,
        });
      }
    }
    if (g[0][0]?.startsWith("Top Pins")) {
      for (const r of g.slice(2)) {
        const id = r[0]?.match(/\/pin\/(\d+)/)?.[1];
        if (!id) continue;
        topPins.push({
          pinId: id,
          url: r[0],
          contentType: r[1] ?? "",
          source: r[2] ?? "",
          impressions: num(r[4]) ?? 0,
        });
      }
    }
  }
  return { window, daily, boards, topPins };
}

// --- Audience export -------------------------------------------------------

function parseAudience(csv: string): Audience {
  let asOf = "";
  let aggregation = "";
  let size = 0;
  const categories = new Map<string, number>();
  const interests: Split[] = [];
  const simple: Record<string, Split[]> = { Countries: [], Metros: [], Gender: [], Device: [], Age: [] };

  for (const g of blocks(csv)) {
    if (g[0][0] === "Audience View" && g[1]) {
      asOf = g[1][1] ?? "";
      aggregation = g[1][2] ?? "";
      size = num(g[1][3]) ?? 0;
    }
    if (g[0][0] === "Interests") {
      // Every interest row repeats its parent category, so dedupe via the map.
      for (const r of g.slice(2)) {
        if (!r[0]) continue;
        const catPct = num(r[2]);
        if (catPct !== undefined) categories.set(r[0], catPct);
        const intPct = num(r[6]);
        if (r[4] && intPct !== undefined) interests.push({ label: `${r[0]} > ${r[4]}`, percent: intPct });
      }
    }
    const key = g[0][0];
    if (key in simple && g[0][1] === "Percent of audience") {
      for (const r of g.slice(1)) {
        const pct = num(r[1]);
        if (r[0] && pct !== undefined) simple[key].push({ label: r[0], percent: pct });
      }
    }
  }
  interests.sort((a, b) => b.percent - a.percent);
  return {
    asOf,
    aggregation,
    size,
    categories: [...categories]
      .map(([label, percent]) => ({ label, percent }))
      .sort((a, b) => b.percent - a.percent),
    interests: interests.slice(0, 25),
    countries: simple.Countries,
    metros: simple.Metros,
    gender: simple.Gender,
    device: simple.Device,
    age: simple.Age,
  };
}

// --- Pinterest public lookup ----------------------------------------------

/**
 * Legacy pins posted before the pipeline existed have no Notion row, so their
 * impressions would otherwise land nowhere. Title and board are readable from
 * the public pin page — cached to disk so a re-run costs no requests.
 */
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
};
const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

async function resolvePin(pinId: string): Promise<{ title: string; board: string } | undefined> {
  const res = await fetch(`https://www.pinterest.com/pin/${pinId}/`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    },
  });
  if (!res.ok) return undefined;
  const html = await res.text();
  // Pinterest titles read "Pin title | keyword, keyword, keyword" — keep the head.
  const raw = html.match(/<title>([^<|]+)/)?.[1]?.trim();
  const board = html.match(/"board":\{"name":"([^"]+)"/)?.[1];
  if (!raw) return undefined;
  // A pin with no title of its own falls back to "Pin on <board>", which is a
  // useless row name — say so plainly instead.
  const title = /^Pin on /.test(raw) ? `Untitled legacy pin ${pinId}` : decodeEntities(raw);
  return { title, board: board ? decodeEntities(board) : "" };
}

// --- Main ------------------------------------------------------------------

const pushToNotion = process.argv.includes("--notion");

const files = existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((f) => f.toLowerCase().endsWith(".csv")) : [];
if (!files.length) {
  console.error(`No CSVs in ${RAW_DIR}. Export from analytics.pinterest.com and drop them there.`);
  process.exit(1);
}

let overview: ReturnType<typeof parseOverview> | undefined;
let audience: Audience | undefined;
for (const f of files) {
  const csv = readFileSync(join(RAW_DIR, f), "utf8");
  if (/^Analytics overview/m.test(csv)) overview = parseOverview(csv);
  else if (/^Audience View/m.test(csv)) audience = parseAudience(csv);
  else console.warn(`Skipped ${f} — unrecognised export shape.`);
}
if (!overview) {
  console.error("No 'Analytics overview' export found — that one carries the pin and board stats.");
  process.exit(1);
}

const totals = overview.boards.reduce(
  (a, b) => ({
    impressions: a.impressions + b.impressions,
    engagement: a.engagement + b.engagement,
    pinClicks: a.pinClicks + b.pinClicks,
    outboundClicks: a.outboundClicks + b.outboundClicks,
    saves: a.saves + b.saves,
  }),
  { impressions: 0, engagement: 0, pinClicks: 0, outboundClicks: 0, saves: 0 },
);

const snapshot: Snapshot = {
  capturedAt: new Date().toISOString().slice(0, 10),
  window: overview.window,
  sources: files,
  totals: { ...totals, days: overview.daily.length },
  dailyImpressions: overview.daily,
  boards: overview.boards,
  topPins: overview.topPins,
  audience,
};

const outPath = join(OUT_DIR, `snapshot-${overview.window.end || snapshot.capturedAt}.json`);
writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
console.log(`Snapshot written: ${outPath}`);
console.log(
  `  window ${snapshot.window.start} -> ${snapshot.window.end} (${snapshot.totals.days} days)\n` +
    `  ${totals.impressions.toLocaleString()} impressions, ${totals.saves.toLocaleString()} saves, ` +
    `${totals.pinClicks.toLocaleString()} pin clicks, ${totals.outboundClicks} outbound\n` +
    `  ${overview.boards.length} boards, ${overview.topPins.length} pins in the top table` +
    (audience ? `\n  audience ${audience.size.toLocaleString()} monthly (as of ${audience.asOf})` : ""),
);

if (!pushToNotion) {
  console.log("\nRe-run with --notion to write these numbers onto the pin rows.");
  process.exit(0);
}

// --- Notion push -----------------------------------------------------------

const statsDate = overview.window.end;
await ensureSchemaProperties();
const pins = await listAllPins();
const byPinId = new Map<string, (typeof pins)[number]>();
for (const p of pins) {
  const id = p.pinUrl?.match(/\/pin\/(\d+)/)?.[1];
  if (id) byPinId.set(id, p);
}

const lookup: Record<string, { title: string; board: string }> = existsSync(LOOKUP_PATH)
  ? JSON.parse(readFileSync(LOOKUP_PATH, "utf8"))
  : {};

let updated = 0;
let created = 0;
const unresolved: string[] = [];

for (const stat of overview.topPins) {
  const row = byPinId.get(stat.pinId);
  if (row) {
    await updatePin(row.pageId, { impressions: stat.impressions, statsUpdated: statsDate });
    updated++;
    continue;
  }
  let meta = lookup[stat.pinId];
  if (!meta) {
    const fetched = await resolvePin(stat.pinId);
    if (!fetched) {
      unresolved.push(stat.pinId);
      continue;
    }
    meta = fetched;
    lookup[stat.pinId] = meta;
    writeFileSync(LOOKUP_PATH, JSON.stringify(lookup, null, 2));
  }
  await createPin({
    name: meta.title,
    status: "Published",
    source: "backfill",
    pinUrl: stat.url,
    pinterestPinId: stat.pinId,
    impressions: stat.impressions,
    statsUpdated: statsDate,
    // Legacy boards are not in schema.ts's BOARDS list, so the board name goes
    // in Notes rather than inventing select options behind the schema's back.
    notes:
      `Pre-pipeline pin, row created by import-analytics.ts from the ${statsDate} CSV export.` +
      (meta.board ? ` Pinterest board: ${meta.board}.` : ""),
  });
  created++;
}

console.log(`\nNotion: ${updated} rows updated, ${created} legacy pins created.`);
if (unresolved.length) console.log(`  could not resolve ${unresolved.length} pin(s): ${unresolved.join(", ")}`);

// --- Notion snapshot page --------------------------------------------------

/**
 * Account-level numbers (audience splits, board totals) have nowhere to live in
 * a per-pin database, so they go on a page under the workspace's Clarity parent.
 * Re-running archives the previous page for the same window rather than piling
 * up duplicates.
 */
const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
if (!parentPageId) {
  console.log("\nNOTION_PARENT_PAGE_ID missing — skipped the summary page.");
  process.exit(0);
}

const notion = notionClient();
const pageTitle = `Pinterest Analytics — ${snapshot.window.start} → ${snapshot.window.end}`;

const text = (content: string) => [{ type: "text" as const, text: { content } }];
const para = (content: string) => ({ object: "block" as const, type: "paragraph" as const, paragraph: { rich_text: text(content) } });
const h2 = (content: string) => ({ object: "block" as const, type: "heading_2" as const, heading_2: { rich_text: text(content) } });
const bullet = (content: string) => ({
  object: "block" as const,
  type: "bulleted_list_item" as const,
  bulleted_list_item: { rich_text: text(content) },
});
const table = (headers: string[], rows: string[][]) => ({
  object: "block" as const,
  type: "table" as const,
  table: {
    table_width: headers.length,
    has_column_header: true,
    has_row_header: false,
    children: [headers, ...rows].map((cells) => ({
      object: "block" as const,
      type: "table_row" as const,
      table_row: { cells: cells.map((c) => text(c)) },
    })),
  },
});

const n = (v: number) => v.toLocaleString("en-US");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const splitRows = (s: Split[]) => s.map((x) => [x.label, pct(x.percent)]);

const nameByPinId = new Map<string, string>();
for (const p of await listAllPins()) {
  const id = p.pinUrl?.match(/\/pin\/(\d+)/)?.[1];
  if (id) nameByPinId.set(id, p.name);
}

const peak = [...snapshot.dailyImpressions].sort((a, b) => b.impressions - a.impressions)[0];
const quiet = [...snapshot.dailyImpressions].sort((a, b) => a.impressions - b.impressions)[0];
const perDay = Math.round(snapshot.totals.impressions / Math.max(snapshot.totals.days, 1));

const children: Record<string, unknown>[] = [
  para(
    `Imported from ${snapshot.sources.join(" and ")} by scripts/import-analytics.ts on ${snapshot.capturedAt}. ` +
      `Per-pin impressions are also written onto the pin rows in Clarity Pins (Impressions + Stats updated).`,
  ),
  h2("Headline"),
  bullet(`${n(snapshot.totals.impressions)} impressions over ${snapshot.totals.days} days (~${n(perDay)}/day)`),
  bullet(`${n(snapshot.totals.saves)} saves · ${n(snapshot.totals.pinClicks)} pin clicks · ${n(snapshot.totals.outboundClicks)} outbound clicks`),
  bullet(`Outbound clicks are the number that matters for the blog — ${n(snapshot.totals.outboundClicks)} of ${n(snapshot.totals.pinClicks)} pin clicks left Pinterest.`),
  bullet(`Busiest day ${peak?.date} (${n(peak?.impressions ?? 0)}); quietest ${quiet?.date} (${n(quiet?.impressions ?? 0)})`),
];

if (snapshot.audience) {
  children.push(
    bullet(`${n(snapshot.audience.size)} monthly audience as of ${snapshot.audience.asOf}`),
  );
}

children.push(
  h2("Boards"),
  table(
    ["Board", "Impressions", "Saves", "Pin clicks", "Outbound"],
    snapshot.boards.map((b) => [b.board, n(b.impressions), n(b.saves), n(b.pinClicks), n(b.outboundClicks)]),
  ),
  h2("Top pins"),
  para("Pinterest's overview export gives impressions only at pin level — saves and clicks are board-level."),
  table(
    ["Pin", "Impressions", "Link"],
    snapshot.topPins.map((p) => [nameByPinId.get(p.pinId) ?? p.pinId, n(p.impressions), p.url]),
  ),
);

if (snapshot.audience) {
  const a = snapshot.audience;
  children.push(
    h2("Audience"),
    para(`Gender, age, device, country and metro splits as of ${a.asOf} (${a.aggregation.toLowerCase()} aggregation).`),
    table(["Gender", "Share"], splitRows(a.gender)),
    table(["Age", "Share"], splitRows(a.age)),
    table(["Device", "Share"], splitRows(a.device)),
    table(["Country", "Share"], splitRows(a.countries)),
    table(["Metro", "Share"], splitRows(a.metros)),
    h2("Interests"),
    para("Share of our audience with each interest — the raw material for board and keyword decisions."),
    table(["Category", "Share"], splitRows(a.categories.slice(0, 15))),
    table(["Interest", "Share"], splitRows(a.interests.slice(0, 20))),
  );
}

// Archive an earlier page for the same window so re-runs stay tidy.
const existing = await notion.search({ query: pageTitle, filter: { property: "object", value: "page" } });
for (const hit of existing.results) {
  const t = (hit as { properties?: { title?: { title?: { plain_text: string }[] } } }).properties?.title?.title;
  if (t?.map((x) => x.plain_text).join("") === pageTitle) {
    await notion.pages.update({ page_id: hit.id, archived: true });
    console.log(`  archived previous page for this window (${hit.id})`);
  }
}

const page = await notion.pages.create({
  parent: { type: "page_id", page_id: parentPageId.replace(/-/g, "") },
  properties: { title: { title: text(pageTitle) } },
  children: children as never,
});
console.log(`Summary page: https://www.notion.so/${page.id.replace(/-/g, "")}`);
