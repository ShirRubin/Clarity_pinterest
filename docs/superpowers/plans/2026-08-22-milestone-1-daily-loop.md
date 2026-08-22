# Milestone 1 — Frictionless Daily Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approving takes a minute in a local review page, approved pins are auto-scheduled at 3/day with a 72h-per-URL gap, packs are per-variant and dated, and the pin design system is documented.

**Architecture:** A pure scheduling module (`src/schedule.ts`) is unit-tested and consumed by a reworked `publish` stage that creates one dated pack per PNG variant. A new `approve` stage serves a self-contained local HTML page from Node's built-in `http`; decisions write straight to Notion via the existing `updatePin`. The pack directory is the calendar of record for scheduled-but-unposted pins; Notion (Pin URL + Published date) is the record for live pins.

**Tech Stack:** Node 24 / TypeScript / tsx, `node:test` runner (new — repo had no tests), `@notionhq/client` (already present), zero new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-22-milestone-1-daily-loop-design.md`

## Global Constraints

- Zero new npm dependencies; server binds `127.0.0.1` only, default port **4178**.
- Cadence: **3 pins/day**; **72h minimum** between pins sharing a destination URL.
- **1 list = 2 scheduled pins** (one pack per variant in `TEMPLATE_NAMES`).
- Notion is updated only after the external action is confirmed (a decision click; a Pinterest confirm).
- Pack naming: `exports/packs/<scheduled-date>--<slug>--<template>/` containing one PNG + `post.txt` starting `POST ON: <date>`.
- ESM imports end in `.js` (repo convention); match existing comment style.
- Commits end with the Co-Authored-By/Claude-Session trailer used by this repo's recent commits.

---

### Task 1: Test harness + scheduling module

**Files:**
- Create: `src/schedule.ts`
- Create: `tests/schedule.test.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `assignDates(existing: ScheduledEntry[], queue: QueueItem[], startDate: string): Assignment[]`, types `ScheduledEntry { date: string; destUrl: string }`, `QueueItem { id: string; destUrl: string }`, `Assignment extends QueueItem { date: string }`, constants `PINS_PER_DAY = 3`, `URL_GAP_DAYS = 3`. Task 3 imports these.

- [ ] **Step 1: Add the test script**

In `package.json` `"scripts"`, add:

```json
"test": "tsx --test tests/schedule.test.ts tests/approve.test.ts"
```

(The approve test file arrives in Task 4; until then run the schedule file directly as shown below.)

- [ ] **Step 2: Write the failing tests**

Create `tests/schedule.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignDates } from "../src/schedule.js";

test("fills 3 slots per day before moving to the next day", () => {
  const q = ["a", "b", "c", "d"].map((id) => ({ id, destUrl: `https://x/${id}/` }));
  const r = assignDates([], q, "2026-09-01");
  assert.deepEqual(r.map((x) => x.date), ["2026-09-01", "2026-09-01", "2026-09-01", "2026-09-02"]);
});

test("pins sharing a destination URL sit at least 3 days apart", () => {
  const q = [
    { id: "v1", destUrl: "https://x/b/" },
    { id: "v2", destUrl: "https://x/b/" },
  ];
  const r = assignDates([], q, "2026-09-01");
  assert.equal(r[0].date, "2026-09-01");
  assert.equal(r[1].date, "2026-09-04");
});

test("respects already-scheduled pins for day capacity and URL gap", () => {
  const existing = [
    { date: "2026-09-01", destUrl: "https://x/a/" },
    { date: "2026-09-01", destUrl: "https://x/b/" },
    { date: "2026-09-01", destUrl: "https://x/c/" },
    { date: "2026-09-02", destUrl: "https://x/d/" },
  ];
  const r = assignDates(existing, [{ id: "n", destUrl: "https://x/d/" }], "2026-09-01");
  // Day 1 is full; days 2-4 are inside the 72h window of the existing /d/ pin.
  assert.equal(r[0].date, "2026-09-05");
});

test("never assigns before the start date", () => {
  const r = assignDates([], [{ id: "a", destUrl: "https://x/a/" }], "2026-09-10");
  assert.equal(r[0].date, "2026-09-10");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test tests/schedule.test.ts`
Expected: FAIL — cannot find module `../src/schedule.js`.

- [ ] **Step 4: Write the module**

Create `src/schedule.ts`:

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test tests/schedule.test.ts`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/schedule.ts tests/schedule.test.ts package.json
git commit -m "feat: cadence scheduler - 3/day with 72h-per-URL gap, unit-tested"
```

---

### Task 2: `Scheduled date` field end-to-end (schema, live-DB migration, Notion layer)

**Files:**
- Modify: `src/schema.ts` (DB_PROPERTIES)
- Create: `scripts/add-scheduled-date.ts`
- Modify: `src/notion.ts` (PinRow, toNotionProperties, NotionPage, PinSummary, pageToSummary)

**Interfaces:**
- Consumes: existing `notionClient()`, `dbId()` from `src/notion.ts`.
- Produces: `PinRow.scheduledDate?: string`; `PinSummary` gains `source?: string`, `destinationLink?: string`, `pinUrl?: string`, `scheduledDate?: string`, `publishedDate?: string`, `imageUrls: string[]`. Tasks 3 and 5 rely on these exact names.

- [ ] **Step 1: Add the property to the schema**

In `src/schema.ts` `DB_PROPERTIES`, directly under the `"Published date"` line, add:

```ts
  "Scheduled date": { date: {} },
```

- [ ] **Step 2: Write the migration script**

Create `scripts/add-scheduled-date.ts`:

```ts
// One-shot migration: add the "Scheduled date" property to the live DB.
// The DB predates the field; setup-notion only runs on fresh databases.
import "dotenv/config";
import { notionClient, dbId } from "../src/notion.js";

const notion = notionClient();
await notion.databases.update({
  database_id: dbId(),
  properties: { "Scheduled date": { date: {} } } as never,
});
console.log('✓ "Scheduled date" added to the Clarity Pins database.');
```

- [ ] **Step 3: Run the migration against the live DB**

Run: `npx tsx scripts/add-scheduled-date.ts`
Expected: the ✓ line. Re-running is harmless (Notion upserts the property).

- [ ] **Step 4: Extend the Notion layer**

In `src/notion.ts`:

(a) In `PinRow`, after `publishedDate`, add:

```ts
  scheduledDate?: string; // YYYY-MM-DD — when the pin should go live on Pinterest
```

(b) In `toNotionProperties`, after the `publishedDate` line, add:

```ts
  if (row.scheduledDate) p["Scheduled date"] = { date: { start: row.scheduledDate } };
```

(c) Replace the `NotionPage` type with:

```ts
type NotionPage = {
  id: string;
  properties: Record<string, {
    title?: { plain_text: string }[];
    rich_text?: { plain_text: string }[];
    select?: { name: string } | null;
    url?: string | null;
    date?: { start: string } | null;
    files?: { file?: { url: string }; external?: { url: string } }[];
  }>;
};
```

(d) In `PinSummary`, after `listItems`, add:

```ts
  source?: string;
  destinationLink?: string;
  pinUrl?: string;
  scheduledDate?: string;
  publishedDate?: string;
  imageUrls: string[];
```

(e) In `pageToSummary`'s returned object, after `listItems`, add:

```ts
    source: p["Source"]?.select?.name,
    destinationLink: p["Destination link"]?.url ?? undefined,
    pinUrl: p["Pin URL"]?.url ?? undefined,
    scheduledDate: p["Scheduled date"]?.date?.start,
    publishedDate: p["Published date"]?.date?.start,
    imageUrls: (p["Pin image"]?.files ?? [])
      .map((f) => f.file?.url ?? f.external?.url)
      .filter((u): u is string => !!u),
```

- [ ] **Step 5: Verify against the live DB**

Run: `npx tsx -e "import('./src/notion.js').then(async n => { const r = await n.pinsByStatus('In Review'); console.log(r.length, 'rows;', r[0]?.imageUrls.length, 'images on first'); })"`
Expected: `5 rows; 2 images on first` (counts may differ; images must be > 0).

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add src/schema.ts scripts/add-scheduled-date.ts src/notion.ts
git commit -m "feat: Scheduled date field in schema + live DB; summaries carry images/urls/dates"
```

---

### Task 3: Publish rework — per-variant dated packs via the scheduler

**Files:**
- Modify: `src/stages/publish.ts` (full rewrite below)

**Interfaces:**
- Consumes: `assignDates`, `ScheduledEntry`, `QueueItem` from `src/schedule.js` (Task 1); `PinSummary` fields from Task 2; existing `listAllPins`, `pinsByStatus`, `updatePin`, `TEMPLATE_NAMES`.
- Produces: pack dirs `exports/packs/<date>--<slug>--<template>/` with `post.txt` whose first line is `POST ON: <date>` and which contains a `DESTINATION LINK: <url>` line (the batch-posting session and future publish runs parse these).

- [ ] **Step 1: Replace `src/stages/publish.ts` with:**

```ts
// Publish stage — Stage A (no Pinterest API): Approved → Published.
// Each PNG variant becomes its own dated pack in exports/packs/ — the
// scheduler (src/schedule.ts) assigns dates at 3/day with a 72h gap per
// destination URL. The packs directory is the calendar of record for
// scheduled-but-unposted pins; a row's Pin URL in Notion is the proof a
// pin is actually live. Stage B (direct API posting) replaces this once
// Pinterest Standard access lands.
import { cp, mkdir, writeFile, access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { listAllPins, pinsByStatus, updatePin, type PinSummary } from "../notion.js";
import { TEMPLATE_NAMES } from "../render/renderPin.js";
import { assignDates, type QueueItem, type ScheduledEntry } from "../schedule.js";

const PROFILE_URL = "https://www.pinterest.com/ClarityBucketLists/";

// Until the blog is live, each pin links to ITS BOARD's URL, not the profile:
// destinations stay unique per board, so the 72h-per-URL rule still lets
// several pins go out the same day. Slugs match data/rss/.
const BOARD_URLS: Record<string, string> = {
  "TV & Movie Bucket Lists": `${PROFILE_URL}tv-movie-bucket-lists/`,
  "Aesthetic Life Lists": `${PROFILE_URL}aesthetic-life-lists/`,
  "Travel & Festivals": `${PROFILE_URL}travel-festivals/`,
  "Books · Learning & Culture": `${PROFILE_URL}books-learning-culture/`,
  "Smart & Creative Projects": `${PROFILE_URL}smart-creative-projects/`,
  "Manifest & Magic Life": `${PROFILE_URL}manifest-magic-life/`,
  "Luxury & Lifestyle": `${PROFILE_URL}luxury-lifestyle/`,
  "Career & Learn New Skills": `${PROFILE_URL}career-learn-new-skills/`,
};

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const destFor = (row: PinSummary) => (row.board && BOARD_URLS[row.board]) || PROFILE_URL;

// Scheduled-but-unposted calendar = the pack dirs on disk.
async function readCalendarFromPacks(): Promise<ScheduledEntry[]> {
  const dir = path.join("exports", "packs");
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: ScheduledEntry[] = [];
  for (const name of names) {
    const m = /^(\d{4}-\d{2}-\d{2})--/.exec(name);
    if (!m) continue;
    try {
      const txt = await readFile(path.join(dir, name, "post.txt"), "utf8");
      const dest = /^DESTINATION LINK: (\S+)/m.exec(txt)?.[1];
      if (dest) out.push({ date: m[1], destUrl: dest });
    } catch {
      // pack without post.txt — ignore
    }
  }
  return out;
}

function postText(row: PinSummary, date: string, template: string, dest: string): string {
  return [
    `POST ON: ${date}   (native scheduler: toggle "Publish at a later date")`,
    ``,
    `IMAGE: ${template}.png`,
    ``,
    `TITLE (paste as pin title):`,
    row.pinTitle ?? row.name,
    ``,
    `DESCRIPTION (paste as pin description):`,
    row.pinDescription ?? "",
    ``,
    `ALT TEXT (paste into the pin's alt-text field):`,
    row.altText ?? "",
    ``,
    `BOARD: ${row.board ?? "(pick manually)"}`,
    `DESTINATION LINK: ${dest}   <- swap for the blog post URL once the blog is live`,
    ``,
    `TAGGED TOPICS: always add 10 (the max) in the pin builder. The taxonomy has no`,
    `"bucket list"/"self care" topics — search concrete nouns from the list items`,
    `(tea, baking, candles, movie night...) plus vibe topics (Cozy Living, Autumn Day).`,
    ``,
    `After posting: paste the live pin's URL into the row's "Pin URL" in Notion.`,
  ].join("\n");
}

export async function runPublish(limit = 10): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const all = await listAllPins();

  // Existing calendar: live pipeline pins + scheduled packs on disk.
  const existing: ScheduledEntry[] = [
    ...all
      .filter((r) => r.source === "pipeline" && r.pinUrl && r.publishedDate)
      .map((r) => ({ date: r.publishedDate!, destUrl: r.destinationLink ?? destFor(r) })),
    ...(await readCalendarFromPacks()),
  ];

  // Queue: date-less Published rows first (packs exported before scheduling
  // existed, still not live), then newly Approved rows.
  const needsDate = all.filter(
    (r) => r.source === "pipeline" && r.status === "Published" && !r.scheduledDate && !r.pinUrl,
  );
  const approved = await pinsByStatus("Approved");
  const rows = [...needsDate, ...approved].slice(0, limit);
  if (!rows.length) {
    console.log("Nothing to schedule — approve some In Review rows first (`clarity approve`).");
    return;
  }

  // One queue item per variant PNG — every variant is its own fresh pin.
  const queue: QueueItem[] = [];
  const rowsById = new Map<string, PinSummary>();
  for (const row of rows) {
    rowsById.set(row.pageId, row);
    for (const t of TEMPLATE_NAMES) queue.push({ id: `${row.pageId}#${t}`, destUrl: destFor(row) });
  }
  const assigned = assignDates(existing, queue, today);

  let packed = 0;
  const firstDate = new Map<string, string>();
  for (const a of assigned) {
    const [pageId, template] = a.id.split("#");
    const row = rowsById.get(pageId)!;
    const slug = slugify(row.name);
    const src = path.join("exports", "designs", slug, `${template}.png`);
    try {
      await access(src);
    } catch {
      console.warn(`⚠ Missing render ${src} — run \`clarity design\` again for this row.`);
      continue;
    }
    const packDir = path.join("exports", "packs", `${a.date}--${slug}--${template}`);
    await mkdir(packDir, { recursive: true });
    await cp(src, path.join(packDir, `${template}.png`));
    await writeFile(path.join(packDir, "post.txt"), postText(row, a.date, template, a.destUrl), "utf8");
    const prev = firstDate.get(pageId);
    if (!prev || a.date < prev) firstDate.set(pageId, a.date);
    packed++;
    console.log(`✓ ${a.date}  ${slug} (${template})`);
  }

  for (const [pageId, date] of firstDate) {
    const row = rowsById.get(pageId)!;
    await updatePin(pageId, {
      status: "Published",
      publishedDate: today,
      scheduledDate: date,
      destinationLink: destFor(row),
    });
  }
  console.log(`\n${packed} pack(s) scheduled in exports/packs/ — load them in the next batch posting session.`);
}
```

Notes for the implementer: the row's `Scheduled date` in Notion holds the **earliest** of its variants' dates (the second variant's date lives in its pack folder name — the packs dir is the full calendar). `Published date` keeps meaning "the day the row entered Published" (export day), not the live date.

- [ ] **Step 2: Verify it compiles and existing tests still pass**

Run: `npx tsc --noEmit` — expected clean.
Run: `npx tsx --test tests/schedule.test.ts` — expected 4 passing.
(No live run yet — Task 7 runs it against the real queue.)

- [ ] **Step 3: Commit**

```bash
git add src/stages/publish.ts
git commit -m "feat: publish schedules per-variant packs - 3/day, 72h/URL, packs dir as calendar"
```

---

### Task 4: Approve server + page (testable, Notion-free)

**Files:**
- Create: `src/approve/server.ts`
- Create: `src/approve/page.ts`
- Create: `tests/approve.test.ts`

**Interfaces:**
- Consumes: nothing from the pipeline (that's the point — Task 5 injects Notion).
- Produces: `createApproveServer(pins: ApprovePin[], onDecision: OnDecision, onAllDecided?: () => void): http.Server`; `ApprovePin { pageId, name, pinTitle, pinDescription, altText, board, listItems, imageUrls: string[] }`; `type Decision = "approve" | "reject"`; `type OnDecision = (pageId: string, decision: Decision, note?: string) => Promise<void>`; `renderApprovePage(pins: ApprovePin[]): string`. Task 5 uses these exact names.

- [ ] **Step 1: Write the failing tests**

Create `tests/approve.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { createApproveServer, type ApprovePin } from "../src/approve/server.js";

const pin = (id: string): ApprovePin => ({
  pageId: id,
  name: `name-${id}`,
  pinTitle: `Title ${id}`,
  pinDescription: "desc",
  altText: "alt",
  board: "Aesthetic Life Lists",
  listItems: "one\ntwo",
  imageUrls: [],
});

const listen = (server: http.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );

test("serves the review page containing each pin's title", async () => {
  const server = createApproveServer([pin("p1"), pin("p2")], async () => {});
  const port = await listen(server);
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /Title p1/);
  assert.match(html, /Title p2/);
  server.close();
});

test("a decision reaches the callback and counts down remaining", async () => {
  const calls: unknown[][] = [];
  const server = createApproveServer([pin("p1")], async (...a) => {
    calls.push(a);
  });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/decide`, {
    method: "POST",
    body: JSON.stringify({ pageId: "p1", decision: "approve", note: "nice" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, remaining: 0 });
  assert.deepEqual(calls, [["p1", "approve", "nice"]]);
  server.close();
});

test("unknown pin id is a 400 and never reaches the callback", async () => {
  let called = false;
  const server = createApproveServer([pin("p1")], async () => {
    called = true;
  });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/decide`, {
    method: "POST",
    body: JSON.stringify({ pageId: "nope", decision: "approve" }),
  });
  assert.equal(res.status, 400);
  assert.equal(called, false);
  server.close();
});

test("a failing callback returns 500 and keeps the pin pending for retry", async () => {
  let attempts = 0;
  const server = createApproveServer([pin("p1")], async () => {
    attempts++;
    if (attempts === 1) throw new Error("notion hiccup");
  });
  const port = await listen(server);
  const body = JSON.stringify({ pageId: "p1", decision: "reject" });
  const first = await fetch(`http://127.0.0.1:${port}/decide`, { method: "POST", body });
  assert.equal(first.status, 500);
  const second = await fetch(`http://127.0.0.1:${port}/decide`, { method: "POST", body });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: true, remaining: 0 });
  server.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/approve.test.ts`
Expected: FAIL — cannot find module `../src/approve/server.js`.

- [ ] **Step 3: Write the server**

Create `src/approve/server.ts`:

```ts
// The approve stage's HTTP core, kept free of Notion so it's testable:
// the stage injects pins and an onDecision callback. Decisions are
// written through the callback BEFORE the 200 goes back — the page's
// card state never gets ahead of Notion.
import http from "node:http";
import { renderApprovePage } from "./page.js";

export interface ApprovePin {
  pageId: string;
  name: string;
  pinTitle: string;
  pinDescription: string;
  altText: string;
  board: string;
  listItems: string;
  imageUrls: string[];
}

export type Decision = "approve" | "reject";
export type OnDecision = (pageId: string, decision: Decision, note?: string) => Promise<void>;

export function createApproveServer(
  pins: ApprovePin[],
  onDecision: OnDecision,
  onAllDecided?: () => void,
): http.Server {
  const remaining = new Set(pins.map((p) => p.pageId));
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderApprovePage(pins));
      return;
    }
    if (req.method === "POST" && req.url === "/decide") {
      let body = "";
      for await (const chunk of req) body += chunk;
      let parsed: { pageId?: string; decision?: string; note?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad JSON" }));
        return;
      }
      const { pageId, decision, note } = parsed;
      if (!pageId || !remaining.has(pageId) || (decision !== "approve" && decision !== "reject")) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unknown pin or bad decision" }));
        return;
      }
      try {
        await onDecision(pageId, decision, note || undefined);
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }
      remaining.delete(pageId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, remaining: remaining.size }));
      if (remaining.size === 0 && onAllDecided) setTimeout(onAllDecided, 500);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
}
```

- [ ] **Step 4: Write the page**

Create `src/approve/page.ts`:

```ts
// The review page: one self-contained HTML string — inline CSS/JS, no
// build step, no CDN. Pin text is our own generated content rendered
// into our own local page, so innerHTML is acceptable here.
import type { ApprovePin } from "./server.js";

export function renderApprovePage(pins: ApprovePin[]): string {
  const data = JSON.stringify(pins).replace(/</g, "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Clarity — review queue</title>
<style>
  :root { --paper:#faf7f2; --ink:#3a3340; --accent:#b8a1e3; --ok:#7fb69b; --no:#e39a9a; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:"Segoe UI",system-ui,sans-serif; background:var(--paper); color:var(--ink); padding:2rem 1rem 4rem; }
  header { max-width:960px; margin:0 auto 1.5rem; display:flex; justify-content:space-between; align-items:baseline; }
  h1 { font-size:1.4rem; }
  #progress { font-weight:600; color:var(--accent); }
  .card { max-width:960px; margin:0 auto 2rem; background:#fff; border-radius:16px; padding:1.2rem; box-shadow:0 2px 12px rgba(58,51,64,.08); outline:none; }
  .card:focus { box-shadow:0 0 0 3px var(--accent); }
  .card.decided { opacity:.45; }
  .imgs { display:flex; gap:1rem; margin-bottom:1rem; }
  .imgs img { width:50%; border-radius:10px; background:#eee; }
  .board { display:inline-block; background:var(--accent); color:#fff; border-radius:999px; padding:.15rem .7rem; font-size:.8rem; margin-bottom:.4rem; }
  h2 { font-size:1.1rem; margin:.2rem 0 .4rem; }
  p.desc { font-size:.92rem; white-space:pre-wrap; }
  p.alt { font-size:.8rem; color:#8a8292; margin-top:.4rem; }
  details { margin-top:.5rem; font-size:.85rem; }
  details pre { white-space:pre-wrap; }
  .actions { display:flex; gap:.8rem; margin-top:1rem; align-items:center; }
  button { border:0; border-radius:10px; padding:.6rem 1.4rem; font-size:1rem; font-weight:600; color:#fff; cursor:pointer; }
  .approve { background:var(--ok); } .reject { background:var(--no); }
  input.note { flex:1; border:1px solid #ddd; border-radius:10px; padding:.55rem .8rem; font-size:.9rem; }
  .verdict { font-weight:700; }
  .err { color:#c0392b; font-size:.85rem; margin-top:.4rem; }
  #summary { max-width:960px; margin:0 auto; text-align:center; font-size:1.2rem; display:none; padding:2rem; }
</style></head><body>
<header><h1>Clarity review queue</h1><div id="progress"></div></header>
<main id="cards"></main>
<div id="summary"></div>
<script>
const pins = ${data};
let decided = 0, approved = 0;
const cards = document.getElementById("cards");
const progress = document.getElementById("progress");
function updateProgress() {
  progress.textContent = decided + " of " + pins.length + " decided";
  if (decided === pins.length) {
    const s = document.getElementById("summary");
    s.style.display = "block";
    s.textContent = approved + " approved, " + (decided - approved) +
      " rejected — run clarity publish to schedule them. You can close this tab.";
  }
}
for (const pin of pins) {
  const el = document.createElement("section");
  el.className = "card"; el.tabIndex = 0; el.dataset.id = pin.pageId;
  el.innerHTML =
    '<div class="imgs">' + pin.imageUrls.map(u => '<img src="' + u + '">').join("") + '</div>' +
    '<span class="board">' + pin.board + '</span>' +
    '<h2>' + (pin.pinTitle || pin.name) + '</h2>' +
    '<p class="desc">' + pin.pinDescription + '</p>' +
    '<p class="alt">alt: ' + pin.altText + '</p>' +
    '<details><summary>List items</summary><pre>' + pin.listItems + '</pre></details>' +
    '<div class="actions">' +
      '<button class="approve">✓ Approve (A)</button>' +
      '<button class="reject">✗ Reject (R)</button>' +
      '<input class="note" placeholder="optional note — why?">' +
    '</div><div class="err"></div>';
  el.querySelector(".approve").onclick = () => decide(el, pin, "approve");
  el.querySelector(".reject").onclick = () => decide(el, pin, "reject");
  cards.appendChild(el);
}
async function decide(el, pin, decision) {
  const err = el.querySelector(".err");
  err.textContent = "";
  try {
    const res = await fetch("/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pageId: pin.pageId, decision, note: el.querySelector(".note").value.trim() }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    el.classList.add("decided");
    el.querySelector(".actions").innerHTML =
      '<span class="verdict">' + (decision === "approve" ? "✓ Approved" : "✗ Rejected") + "</span>";
    decided++; if (decision === "approve") approved++;
    updateProgress();
    const next = el.nextElementSibling;
    if (next && next.classList && next.classList.contains("card")) next.focus();
  } catch (e) {
    err.textContent = "Notion said no: " + e.message + " — try again.";
  }
}
document.addEventListener("keydown", (ev) => {
  if (ev.target.tagName === "INPUT") return;
  const el = document.activeElement && document.activeElement.closest
    ? document.activeElement.closest(".card") : null;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    const list = [...cards.children];
    const i = el ? list.indexOf(el) : -1;
    const next = list[i + (ev.key === "ArrowDown" ? 1 : -1)];
    if (next) { next.focus(); ev.preventDefault(); }
    return;
  }
  if (!el || el.classList.contains("decided")) return;
  const pin = pins.find(p => p.pageId === el.dataset.id);
  if (ev.key === "a" || ev.key === "A") decide(el, pin, "approve");
  if (ev.key === "r" || ev.key === "R") decide(el, pin, "reject");
});
updateProgress();
if (cards.firstElementChild) cards.firstElementChild.focus();
</script></body></html>`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test tests/approve.test.ts` — expected 4 passing.
Run: `npm test` — expected 8 passing (both files; the Task 1 script now resolves).

- [ ] **Step 6: Commit**

```bash
git add src/approve/server.ts src/approve/page.ts tests/approve.test.ts
git commit -m "feat: approve server + review page - injectable, Notion-free, tested"
```

---

### Task 5: `clarity approve` stage + CLI wiring

**Files:**
- Create: `src/stages/approve.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `createApproveServer`, `ApprovePin` (Task 4); `pinsByStatus`, `updatePin`, `PinSummary.imageUrls` (Task 2).
- Produces: `runApprove(port?: number): Promise<void>`, wired as the `approve` CLI command.

- [ ] **Step 1: Write the stage**

Create `src/stages/approve.ts`:

```ts
// Approve stage — In Review → Approved/Rejected via a local review page.
// Serves the queue at 127.0.0.1:<port>, writes each decision straight to
// Notion the moment it's clicked, and exits once every pin is decided.
// Rejection notes land in the row's Notes so generation can learn later.
import { exec } from "node:child_process";
import { pinsByStatus, updatePin } from "../notion.js";
import { createApproveServer, type ApprovePin } from "../approve/server.js";

function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* best-effort — the URL is printed either way */
  });
}

export async function runApprove(port = 4178): Promise<void> {
  const rows = await pinsByStatus("In Review");
  if (!rows.length) {
    console.log("No rows In Review — run `clarity review` first.");
    return;
  }
  const pins: ApprovePin[] = rows.map((r) => ({
    pageId: r.pageId,
    name: r.name,
    pinTitle: r.pinTitle ?? r.name,
    pinDescription: r.pinDescription ?? "",
    altText: r.altText ?? "",
    board: r.board ?? "(no board)",
    listItems: r.listItems ?? "",
    imageUrls: r.imageUrls,
  }));
  for (const p of pins) {
    if (!p.imageUrls.length) console.warn(`⚠ ${p.name} has no images — run \`clarity design\`?`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const server = createApproveServer(
    pins,
    async (pageId, decision, note) => {
      await updatePin(pageId, {
        status: decision === "approve" ? "Approved" : "Rejected",
        ...(note ? { notes: `review ${today}: ${note}` } : {}),
      });
    },
    () => {
      console.log("All decided — run `clarity publish` to schedule the approved pins.");
      server.close();
    },
  );
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Review queue: ${url} (${pins.length} pins) — Ctrl+C quits without finishing.`);
    openBrowser(url);
  });
}
```

Note: a rejection note **replaces** the row's Notes property (pipeline rows have empty Notes today, so nothing is lost; appending would cost an extra read per decision for no current benefit).

- [ ] **Step 2: Wire the CLI**

In `src/cli.ts`: add to the imports

```ts
import { runApprove } from "./stages/approve.js";
```

and add to `commands`, between `review` and `publish`:

```ts
  approve: { desc: "In Review → Approved/Rejected via local review page (arg: port, default 4178)", run: () => runApprove(arg ?? 4178) },
```

Also update the `publish` description to reflect scheduling:

```ts
  publish: { desc: "Approved → Published: schedule + write per-variant packs to exports/packs/ (API posting in Phase 4)", run: () => runPublish(arg ?? 10) },
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npx tsx src/cli.ts` — the command list shows `approve` with its description.
Smoke (talks to live Notion, serves for a moment): `npx tsx src/cli.ts approve` — expect "Review queue: http://127.0.0.1:4178/ (5 pins)" and the browser opening; Ctrl+C without deciding anything.

- [ ] **Step 4: Commit**

```bash
git add src/stages/approve.ts src/cli.ts
git commit -m "feat: clarity approve - local review page wired to Notion"
```

---

### Task 6: DESIGN.md — the pin design system on paper

**Files:**
- Create: `DESIGN.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write `DESIGN.md`**

Write it from the code, not from memory — verify each fact in `src/render/renderPin.ts`, `src/stages/publish.ts`, `src/schedule.ts`. Structure and required content:

```markdown
# Clarity pin design system

## Templates
- `classic-checklist` — the signature pastel look [one paragraph describing its layout, read from renderPin.ts, and when it wins]
- `bold-panel` — white-card variant [likewise]
- **Standing rule:** serif looks are out — `soft-editorial` was piloted 2026-08-22 and rejected by the user. A third template (research says 3–5 variants/list) gets designed fresh, never resurrected.

## Uniqueness invariant ("no twins")
- 9 theme-keyed palettes; 3 palette variants per theme, picked deterministically per list name, collision-bumped within a batch.
- Emoji is subject-first from the list name.
- Hard constraint on every future template or palette.

## Copy playbook (2026)
- Title 40–60 chars, keyword-first; hard cap <100.
- Description <500 chars with 3–5 hashtags; 1–2 emoji.
- Alt text 80–140 chars.
- Keyword visibly on the image; open slot renders as comment bait.

## Posting rules
- 3 fresh pins/day, held for 90 days; never the same destination URL twice within 72h (`src/schedule.ts` enforces both).
- 1 list = 2 scheduled pins — one per template variant, each its own pack.
- Tagged topics: fill all 10; concrete nouns from list items + vibe topics — the taxonomy has no "bucket list"/"self care".
- Rhythm: batch posting sessions ~2×/week via Pinterest's native "Publish at a later date".

## Render facts
- 2000×3000 PNG via playwright-core on installed Chrome/Edge (no browser download).
- Vendored woff2 fonts: Fredoka, Patrick Hand SC — deterministic offline renders.
- Reference pins vendored in `data/reference/`; long titles auto-shrink; only bold action heads go on the image.
```

The two `[one paragraph ...]` markers are the only content not given verbatim — fill them from `renderPin.ts`.

- [ ] **Step 2: Verify facts against code**

Cross-check every number and name against `src/render/renderPin.ts` (template names, dimensions, fonts), `src/schedule.ts` (3/day, 72h), and `src/stages/publish.ts` (tagged-topics text, board URLs). Fix any drift **in DESIGN.md**, not in code.

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md
git commit -m "docs: pin design system - templates, no-twins invariant, copy + posting rules"
```

---

### Task 7: Acceptance on the real queue (user in the loop)

**Files:** none created — this task runs the built system against the live backlog.

- [ ] **Step 1: Delete the 5 superseded old-format packs**

The pre-scheduling packs (dated `2026-08-22--<slug>`, two PNGs each) would double-count in the pack-dir calendar. The Slow October pin is live and recorded in Notion (its calendar entry now comes from the Notion side); the other 4 rows get fresh per-variant packs in Step 3.

```bash
rm -rf exports/packs/2026-08-22--the-ai-skills-bucket-list-12-things-to-build-with-ai-zero-co \
       exports/packs/2026-08-22--the-bridgerton-bucket-list-20-ways-to-live-your-regency-diam \
       exports/packs/2026-08-22--the-cottage-witch-autumn-bucket-list-13-rituals-to-do-before \
       exports/packs/2026-08-22--the-slow-october-bucket-list-15-cozy-sunday-rituals-to-reset \
       exports/packs/2026-08-22--the-stargazing-bucket-list-12-dark-sky-trips-you-can-actuall
```

- [ ] **Step 2: `npx tsx src/cli.ts approve` — the user decides the 5 In Review rows**

Hand the browser to the user. Expected: decisions land in Notion as they click; console prints the all-decided line; server exits.

- [ ] **Step 3: `npx tsx src/cli.ts publish` — schedule everything**

Expected: per-variant packs for the 4 date-less Published rows **first**, then the newly approved rows; console lists `<date> <slug> (<template>)` lines honoring 3/day and 72h/board; each row in Notion gains `Scheduled date` (earliest variant).

- [ ] **Step 4: Inspect**

- `ls exports/packs/` — names sorted by date read as a plausible calendar (≤3 per date; packs sharing a board sit ≥3 days apart — variants of one list share a board, so this includes them).
- Open one `post.txt` — starts with `POST ON:`, has one `IMAGE:` line, tagged-topics block present.
- Spot-check 2 rows in Notion: Status/Scheduled date correct; a rejected row shows its note in Notes.

- [ ] **Step 5: Update docs and commit**

Update `CLARITY_PLAN.md` + `.html` Status (M1 built, acceptance state) and the auto-memory file.

```bash
git add -A && git commit -m "chore: M1 acceptance - live queue scheduled through approve + publish"
```

- [ ] **Step 6 (separate session activity): first batch posting session**

Not a code step: per the spec's Component 3, load the due packs into Pinterest's native scheduler in the logged-in Chrome, write each `Pin URL` back to Notion after Pinterest confirms. This is where M1 is truly done.
