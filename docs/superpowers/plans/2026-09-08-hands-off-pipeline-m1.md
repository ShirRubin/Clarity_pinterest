# Hands-off pipeline — Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `Scheduled` state and the four CLI commands (`ship`, `post-plan`, `posted`, `reconcile`) that let one skill, `/clarity-post`, take every Approved list from Notion to Pinterest's scheduler with nothing worked out by hand.

**Architecture:** Every deterministic step is a CLI stage with a pure, unit-tested core (`src/*.ts`) and a thin I/O wrapper (`src/stages/*.ts`), matching how `schedule.ts`/`publish.ts` and `status.ts` are already split. The only non-deterministic step — driving Pinterest's pin builder — stays with Claude, following a checklist written into the skill; bookkeeping after each pin goes through `clarity posted` so no file or Notion row is ever edited by hand. `exports/packs/` (to post) and `exports/posted/` (in Pinterest's scheduler) remain the calendar of record.

**Tech Stack:** Node 22 / TypeScript (ESM, `NodeNext`), `tsx`, `node:test`, `@notionhq/client`, Astro + wrangler in `../Clarity_blog`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-hands-off-pipeline-design.md` — sections 1, 4, 6, 7, 8 and build-order step 1. Milestones 2 (review Worker) and 3 (nightly job + migration) get their own plans after this one lands.

## Global Constraints

- Working directory for every command is `Clarity_pinterest/` (its own git repo). Commit there.
- Tests: `npm test` runs `tsx --test` over an explicit file list in `package.json` — **every new test file must be added to that list** or it never runs. Typecheck: `npx tsc --noEmit`.
- Pure logic never imports `notion.ts` or touches the filesystem; stages do the I/O.
- Time slots are `09:00 AM`, `01:00 PM`, `06:00 PM` in `Asia/Jerusalem`. **12:00 PM is never a slot** — it is Pinterest's default and the source of the duplicate defect.
- Pinterest's scheduler accepts dates at most **29 days** ahead.
- Pack directory names stay `YYYY-MM-DD--<slug>--<template>`; `slug = slugify(row.name)` (60 chars).
- A row becomes `Scheduled` only when **all `TEMPLATE_NAMES.length` (4)** of its variants are posted.
- Notion `Notes` are appended with ` | `, never overwritten (`appendNote`).
- `publish` remains as a deprecated alias of `pack` for this release.
- Commit messages: imperative, one line + optional body; end with the session's `Co-Authored-By` / `Claude-Session` trailers.

---

## File structure

| File | Responsibility | Status |
|---|---|---|
| `src/schema.ts` | `STATUSES` gains `Scheduled`; `PINTEREST_BOARD_NAMES` (Notion select → Pinterest board title) | modify |
| `src/schedule.ts` | `assignDates` also returns a per-day `slot`; `SLOT_TIMES`, `POST_TZ`, `localParts()` | modify |
| `src/packText.ts` | `postText()` (writer) + `parsePostText()` (reader) for `post.txt` — one module so the two can't drift | create (moved out of publish.ts) |
| `src/packs.ts` | `PackInfo`, `readPacks("packs" \| "posted")`, `slugOfPack`, `templateOfPack` | create |
| `src/stages/pack.ts` | The old `publish.ts`: writes dated + slotted packs, **leaves the row `Approved`**, writes `PAGE:` into `post.txt` | rename + modify |
| `src/queue.ts` | Approved rows whose packs already exist are not "in flight" | modify |
| `src/posted.ts` | `postedTransition()` — the 3/4 vs 4/4 rule | create |
| `src/stages/posted.ts` | `clarity posted <pack-dir> <pin-id>`: move dir, append `POSTED:`, Notion note, flip to `Scheduled` | create |
| `src/topics.ts` | `suggestTopics(listItems, theme)` → up to 10 tag candidates | create |
| `src/postplan.ts` | `buildPostPlan()` — order, 29-day window, board mapping; `formatPostPlan()` | create |
| `src/stages/postplan.ts` | `clarity post-plan [--json]` | create |
| `src/reconcile.ts` | `reconcile()` — diff Pinterest JSON vs packs; `formatReconcile()` | create |
| `src/stages/reconcile.ts` | `clarity reconcile <scheduled.json> <created.json> [--apply]` | create |
| `src/stages/blogpost.ts` | returns the number of posts written; `Scheduled` rows eligible | modify |
| `src/stages/ship.ts` | `clarity ship`: blogpost → pack → deploy blog if anything new | create |
| `src/cli.ts` | string args; new commands; `publish` alias | modify |
| `src/status.ts` | "approved — /clarity-post", "n/4 posted", "waiting for window", Scheduled/packs agreement | modify |
| `tests/schema.test.ts`, `tests/packText.test.ts`, `tests/posted.test.ts`, `tests/topics.test.ts`, `tests/postplan.test.ts`, `tests/reconcile.test.ts` | new suites | create |
| `tests/schedule.test.ts`, `tests/queue.test.ts`, `tests/status.test.ts` | extended | modify |
| `~/.claude/skills/clarity-post/SKILL.md` | the skill: commands + the browser checklist | create |
| `~/.claude/skills/clarity-status/SKILL.md`, `CLAUDE.md`, `../CLARITY_PLAN.md` | docs | modify |

---

### Task 1: Commit the pending `clarity status` work

The status card from the previous session is uncommitted (`src/status.ts`, `tests/status.test.ts`, edits to `CLAUDE.md`, `package.json`, `src/cli.ts`, `src/queue.ts`). Land it first so every later diff is about this milestone.

**Files:** none new.

- [ ] **Step 1: Verify it is green**

Run: `npm test && npx tsc --noEmit`
Expected: all suites pass (schedule, approve, queue, revise, destination, status), tsc silent.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md package.json src/cli.ts src/queue.ts src/status.ts tests/status.test.ts
git commit -m "Add clarity status: one card for queues, calendar, blog and open tasks"
```

---

### Task 2: `Scheduled` status + Pinterest board names in the schema

**Files:**
- Modify: `src/schema.ts`
- Create: `tests/schema.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Produces: `STATUSES` includes `"Scheduled"` (between `"Approved"` and `"Published"`); `Status` type widens accordingly. `PINTEREST_BOARD_NAMES: Record<Board, string>` — the exact board title as Pinterest's pin builder shows it (`board-row-<Name>` test id).

- [ ] **Step 1: Write the failing test**

```ts
// tests/schema.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUSES, BOARDS, PINTEREST_BOARD_NAMES } from "../src/schema.js";

test("Scheduled sits between Approved and Published", () => {
  const i = STATUSES.indexOf("Scheduled");
  assert.ok(i > 0);
  assert.equal(STATUSES[i - 1], "Approved");
  assert.equal(STATUSES[i + 1], "Published");
});

test("every Notion board has a Pinterest board title, and none contains the middle dot", () => {
  for (const b of BOARDS) {
    const name = PINTEREST_BOARD_NAMES[b];
    assert.ok(name, `missing Pinterest name for ${b}`);
    assert.ok(!name.includes("·"), `${name} still has the Notion-only separator`);
  }
  assert.equal(PINTEREST_BOARD_NAMES["Books · Learning & Culture"], "Books, Learning & Culture");
});
```

- [ ] **Step 2: Add the file to `package.json`'s test script and run it to see it fail**

Edit the `"test"` script: append ` tests/schema.test.ts` to the list.

Run: `npx tsx --test tests/schema.test.ts`
Expected: FAIL — `PINTEREST_BOARD_NAMES` is not exported / `Scheduled` index is -1.

- [ ] **Step 3: Implement**

In `src/schema.ts`, replace the `STATUSES` block and add the map after `BOARDS`:

```ts
export const STATUSES = [
  "Idea",
  "Drafted",
  "Designed",
  "In Review",
  "Needs changes",
  "Approved",
  // All four variants sit in Pinterest's scheduler (set by `clarity posted`).
  "Scheduled",
  // The first variant's date has passed — it is live (flipped by the nightly job).
  "Published",
  "Rejected",
  "Archived",
] as const;
```

```ts
// The board title exactly as Pinterest's pin builder shows it. Notion select
// options forbid commas, so the one board with a comma is spelled with "·" in
// Notion and mapped back here for the browser step.
export const PINTEREST_BOARD_NAMES: Record<Board, string> = {
  "TV & Movie Bucket Lists": "TV & Movie Bucket Lists",
  "Aesthetic Life Lists": "Aesthetic Life Lists",
  "Travel & Festivals": "Travel & Festivals",
  "Books · Learning & Culture": "Books, Learning & Culture",
  "Smart & Creative Projects": "Smart & Creative Projects",
  "Manifest & Magic Life": "Manifest & Magic Life",
  "Luxury & Lifestyle": "Luxury & Lifestyle",
  "Career & Learn New Skills": "Career & Learn New Skills",
};
```

(`PINTEREST_BOARD_NAMES` must be declared after `Board` — place it right under the `Board` type.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. (`ensureStatusOptions()` will push `Scheduled` into the live DB on the next `clarity approve`/`posted` run — nothing to do now.)

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts tests/schema.test.ts package.json
git commit -m "schema: add Scheduled status and Pinterest board-name map"
```

---

### Task 3: Time slots in `schedule.ts`

**Files:**
- Modify: `src/schedule.ts`
- Modify: `tests/schedule.test.ts`

**Interfaces:**
- Produces:
  - `export const SLOT_TIMES = ["09:00 AM", "01:00 PM", "06:00 PM"] as const;`
  - `export const POST_TZ = "Asia/Jerusalem";`
  - `export interface Assignment extends QueueItem { date: string; slot: number; }` — `slot` is 0..2, the index into `SLOT_TIMES`.
  - `export const slotTime = (slot: number) => SLOT_TIMES[slot];`
  - `export function localParts(unixSeconds: number, tz = POST_TZ): { date: string; hour: number }` — the wall-clock date (`YYYY-MM-DD`) and 0-23 hour of a unix timestamp in `tz`. Used by reconcile to spot 12:00 pins.

- [ ] **Step 1: Write the failing tests** (append to `tests/schedule.test.ts`)

```ts
import { assignDates, SLOT_TIMES, slotTime, localParts, PINS_PER_DAY } from "../src/schedule.js";

test("assigns slots 0,1,2 within a day and never a fourth", () => {
  const q = ["a", "b", "c", "d"].map((id) => ({ id, destUrl: `https://x/${id}/` }));
  const r = assignDates([], q, "2026-09-01");
  assert.deepEqual(r.map((x) => x.slot), [0, 1, 2, 0]);
  assert.equal(SLOT_TIMES.length, PINS_PER_DAY);
});

test("existing pins on a day occupy the earliest slots", () => {
  const existing = [{ date: "2026-09-01", destUrl: "https://x/a/" }];
  const r = assignDates(existing, [{ id: "n", destUrl: "https://x/b/" }], "2026-09-01");
  assert.equal(r[0].date, "2026-09-01");
  assert.equal(r[0].slot, 1);
});

test("slot times are the real posting slots and never noon", () => {
  assert.deepEqual([...SLOT_TIMES], ["09:00 AM", "01:00 PM", "06:00 PM"]);
  assert.equal(slotTime(2), "06:00 PM");
  assert.ok(!SLOT_TIMES.some((t) => t.startsWith("12:")));
});

test("localParts reads the wall clock in Asia/Jerusalem", () => {
  // 2026-09-08 09:00 UTC = 12:00 in Jerusalem (UTC+3, summer time)
  const ts = Date.UTC(2026, 8, 8, 9, 0, 0) / 1000;
  assert.deepEqual(localParts(ts), { date: "2026-09-08", hour: 12 });
  // 2026-09-08 22:30 UTC = 01:30 next day in Jerusalem
  const late = Date.UTC(2026, 8, 8, 22, 30, 0) / 1000;
  assert.deepEqual(localParts(late), { date: "2026-09-09", hour: 1 });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx tsx --test tests/schedule.test.ts`
Expected: FAIL — `SLOT_TIMES` not exported; `slot` undefined.

- [ ] **Step 3: Implement**

In `src/schedule.ts`: change `Assignment`, add the constants, set `slot` when booking, add `localParts`.

```ts
export interface Assignment extends QueueItem {
  date: string;
  /** 0..PINS_PER_DAY-1 — index into SLOT_TIMES. */
  slot: number;
}

export const PINS_PER_DAY = 3;
export const URL_GAP_DAYS = 3;

/** Pinterest's scheduler time labels for the day's three slots. Never 12:00 PM —
 *  that is the builder's default and how the duplicate-pin defect was born. */
export const SLOT_TIMES = ["09:00 AM", "01:00 PM", "06:00 PM"] as const;
export const POST_TZ = "Asia/Jerusalem";
export const slotTime = (slot: number) => SLOT_TIMES[slot];
```

Inside `assignDates`, the loop tail becomes:

```ts
    const date = toDate(ms);
    const slot = perDay.get(date) ?? 0; // existing pins hold the earliest slots
    book(date, item.destUrl);
    out.push({ ...item, date, slot });
```

And at the end of the file:

```ts
/** Wall-clock date + hour of a unix timestamp in `tz` (default: the posting zone). */
export function localParts(unixSeconds: number, tz = POST_TZ): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(unixSeconds * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: parseInt(get("hour"), 10) };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. (`publish.ts` still compiles — it ignores `slot` for now.)

- [ ] **Step 5: Commit**

```bash
git add src/schedule.ts tests/schedule.test.ts
git commit -m "schedule: assign a time slot per pin; localParts for the posting zone"
```

---

### Task 4: `post.txt` writer + parser in one module

**Files:**
- Create: `src/packText.ts`
- Create: `tests/packText.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Produces:
  ```ts
  export interface PackText {
    date: string;          // YYYY-MM-DD
    time?: string;         // "09:00 AM" — absent in packs written before this milestone
    pageId?: string;       // Notion page id — absent in older packs
    image: string;         // "classic-checklist.png"
    title: string;
    description: string;
    alt: string;
    board: string;         // Notion spelling
    link: string;
    posted?: { at: string; pinId: string }; // present once `clarity posted` ran
  }
  export function postText(t: Omit<PackText, "posted">): string;
  export function parsePostText(txt: string): PackText;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/packText.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { postText, parsePostText } from "../src/packText.js";

const sample = {
  date: "2026-09-08",
  time: "09:00 AM",
  pageId: "26b23760-024b-81e5-938d-e19a4e93f97c",
  image: "classic-checklist.png",
  title: "Handmade Gift Bucket List: 12 Presents to Start Making",
  description: "Line one.\nLine two with #hashtag",
  alt: "Checklist graphic titled Handmade Gift",
  board: "Books · Learning & Culture",
  link: "https://clarity-lists.com/posts/the-handmade-gift-bucket-list",
};

test("postText → parsePostText round-trips every field", () => {
  assert.deepEqual(parsePostText(postText(sample)), sample);
});

test("parses a pre-milestone pack (no POST AT, no PAGE)", () => {
  const legacy = [
    `POST ON: 2026-08-27   (native scheduler: toggle "Publish at a later date")`,
    ``,
    `IMAGE: classic-checklist.png`,
    ``,
    `TITLE (paste as pin title):`,
    `Bridgerton Bucket List: 20 Ways to Live Your Diamond Era`,
    ``,
    `DESCRIPTION (paste as pin description):`,
    `Your Bridgerton era ✨`,
    `#bucketlist #regencycore`,
    ``,
    `ALT TEXT (paste into the pin's alt-text field):`,
    `Pastel checklist graphic`,
    ``,
    `BOARD: TV & Movie Bucket Lists`,
    `DESTINATION LINK: https://clarity-lists.com/posts/the-bridgerton-bucket-list`,
    ``,
    `TAGGED TOPICS: always add 10 (the max) in the pin builder. The taxonomy has no`,
    `"bucket list"/"self care" topics — search concrete nouns from the list items`,
    ``,
    `After posting: paste the live pin's URL into the row's "Pin URL" in Notion.`,
  ].join("\n");
  const p = parsePostText(legacy);
  assert.equal(p.date, "2026-08-27");
  assert.equal(p.time, undefined);
  assert.equal(p.pageId, undefined);
  assert.equal(p.title, "Bridgerton Bucket List: 20 Ways to Live Your Diamond Era");
  assert.equal(p.description, "Your Bridgerton era ✨\n#bucketlist #regencycore");
  assert.equal(p.alt, "Pastel checklist graphic");
  assert.equal(p.board, "TV & Movie Bucket Lists");
  assert.equal(p.link, "https://clarity-lists.com/posts/the-bridgerton-bucket-list");
});

test("reads a POSTED line appended by clarity posted", () => {
  const txt = postText(sample) + `\nPOSTED: 2026-09-08T10:12:00.000Z pin 3826344098274829184\n`;
  assert.deepEqual(parsePostText(txt).posted, { at: "2026-09-08T10:12:00.000Z", pinId: "3826344098274829184" });
});
```

- [ ] **Step 2: Add to the test list, run, see it fail**

Append ` tests/packText.test.ts` to the `"test"` script.

Run: `npx tsx --test tests/packText.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/packText.ts — the post.txt inside every pack. Writer and reader live
// together so a field added to one cannot be forgotten by the other. The file
// is also read by a human during a manual posting session, hence the prose.
export interface PackText {
  date: string;
  time?: string;
  pageId?: string;
  image: string;
  title: string;
  description: string;
  alt: string;
  board: string;
  link: string;
  posted?: { at: string; pinId: string };
}

const TOPICS_HELP = [
  `TAGGED TOPICS: always add 10 (the max) in the pin builder. The taxonomy has no`,
  `"bucket list"/"self care" topics — search concrete nouns from the list items`,
  `(tea, baking, candles, movie night...) plus vibe topics (Cozy Living, Autumn Day).`,
];

export function postText(t: Omit<PackText, "posted">): string {
  return [
    `POST ON: ${t.date}   (native scheduler: toggle "Publish at a later date")`,
    ...(t.time ? [`POST AT: ${t.time}`] : []),
    ...(t.pageId ? [`PAGE: ${t.pageId}`] : []),
    ``,
    `IMAGE: ${t.image}`,
    ``,
    `TITLE (paste as pin title):`,
    t.title,
    ``,
    `DESCRIPTION (paste as pin description):`,
    t.description,
    ``,
    `ALT TEXT (paste into the pin's alt-text field):`,
    t.alt,
    ``,
    `BOARD: ${t.board}`,
    `DESTINATION LINK: ${t.link}`,
    ``,
    ...TOPICS_HELP,
    ``,
    `After posting: paste the live pin's URL into the row's "Pin URL" in Notion.`,
  ].join("\n");
}

/** Text between a `HEADER:` line and the next blank line. */
function block(lines: string[], header: string): string {
  const i = lines.findIndex((l) => l.startsWith(header));
  if (i < 0) return "";
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && lines[j] !== ""; j++) out.push(lines[j]);
  return out.join("\n");
}

const field = (txt: string, key: string) => new RegExp(`^${key}: (.+?)\\s*(?:\\(|$)`, "m").exec(txt)?.[1]?.trim();

export function parsePostText(txt: string): PackText {
  const lines = txt.split(/\r?\n/);
  const posted = /^POSTED: (\S+) pin (\d+)/m.exec(txt);
  return {
    date: field(txt, "POST ON") ?? "",
    time: field(txt, "POST AT"),
    pageId: field(txt, "PAGE"),
    image: field(txt, "IMAGE") ?? "",
    title: block(lines, "TITLE"),
    description: block(lines, "DESCRIPTION"),
    alt: block(lines, "ALT TEXT"),
    board: field(txt, "BOARD") ?? "",
    link: /^DESTINATION LINK: (\S+)/m.exec(txt)?.[1] ?? "",
    ...(posted ? { posted: { at: posted[1], pinId: posted[2] } } : {}),
  };
}
```

Note `field()` stops at ` (` so `POST ON: 2026-09-08   (native scheduler…)` yields the date alone. The round-trip test's `deepEqual` requires that undefined `time`/`pageId` are **absent**, not present-as-undefined — the object literal above always sets them, so rewrite the return to spread conditionally:

```ts
  const time = field(txt, "POST AT");
  const pageId = field(txt, "PAGE");
  return {
    date: field(txt, "POST ON") ?? "",
    ...(time ? { time } : {}),
    ...(pageId ? { pageId } : {}),
    image: field(txt, "IMAGE") ?? "",
    // …rest unchanged
  };
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/packText.ts tests/packText.test.ts package.json
git commit -m "packText: post.txt writer and parser in one module"
```

---

### Task 5: `src/packs.ts` — read pack directories

**Files:**
- Create: `src/packs.ts`
- Modify: `tests/packText.test.ts` (add pure-name tests; the async reader is exercised by later stages)

**Interfaces:**
- Produces:
  ```ts
  export interface PackInfo {
    where: "packs" | "posted";
    dir: string;        // directory name only, e.g. "2026-09-08--the-handmade…--classic-checklist"
    path: string;       // "exports/packs/<dir>"
    date: string;       // from the name
    slug: string;       // from the name
    template: string;   // from the name
    text: PackText;     // parsed post.txt
  }
  export function splitPackName(dir: string): { date: string; slug: string; template: string } | undefined;
  export async function readPacks(where: "packs" | "posted"): Promise<PackInfo[]>; // sorted by date, then dir
  ```

- [ ] **Step 1: Write the failing test** (append to `tests/packText.test.ts`)

```ts
import { splitPackName } from "../src/packs.js";

test("splitPackName reads date, slug and template; rejects legacy two-part names", () => {
  assert.deepEqual(
    splitPackName("2026-09-08--the-handmade-gift-bucket-list-12-presents--classic-checklist"),
    { date: "2026-09-08", slug: "the-handmade-gift-bucket-list-12-presents", template: "classic-checklist" },
  );
  assert.equal(splitPackName("2026-08-01--old-style-pack"), undefined);
  assert.equal(splitPackName("not-a-pack"), undefined);
});
```

- [ ] **Step 2: Run, see it fail**

Run: `npx tsx --test tests/packText.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/packs.ts — the pack directories are the posting calendar of record.
// exports/packs/ = still to hand to Pinterest; exports/posted/ = already in its
// scheduler. This is the one place that knows the directory-name format.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parsePostText, type PackText } from "./packText.js";

export interface PackInfo {
  where: "packs" | "posted";
  dir: string;
  path: string;
  date: string;
  slug: string;
  template: string;
  text: PackText;
}

const NAME = /^(\d{4}-\d{2}-\d{2})--(.+)--([a-z-]+)$/;

export function splitPackName(dir: string): { date: string; slug: string; template: string } | undefined {
  const m = NAME.exec(dir);
  return m ? { date: m[1], slug: m[2], template: m[3] } : undefined;
}

export async function readPacks(where: "packs" | "posted"): Promise<PackInfo[]> {
  const base = path.join("exports", where);
  let names: string[] = [];
  try {
    names = await readdir(base);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return [];
  }
  const out: PackInfo[] = [];
  for (const dir of names.sort()) {
    const parts = splitPackName(dir);
    if (!parts) continue;
    let txt: string;
    try {
      txt = await readFile(path.join(base, dir, "post.txt"), "utf8");
    } catch {
      continue; // a pack without post.txt is not a pack
    }
    out.push({ where, dir, path: path.join(base, dir), ...parts, text: parsePostText(txt) });
  }
  return out;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/packs.ts tests/packText.test.ts
git commit -m "packs: one reader for the pack directories"
```

---

### Task 6: `publish` → `pack`: slots, `PAGE:` line, row stays Approved

**Files:**
- Rename: `src/stages/publish.ts` → `src/stages/pack.ts` (`git mv`)
- Modify: `src/stages/pack.ts`
- Modify: `src/cli.ts` (import path only — full wiring is Task 12)

**Interfaces:**
- Consumes: `postText` (Task 4), `Assignment.slot` + `slotTime` (Task 3), `readPacks` (Task 5).
- Produces: `export async function runPack(limit = 10): Promise<void>`. Packs now carry `POST AT:` and `PAGE:`. The row is **not** flipped to `Published`; `Scheduled date` (earliest pack date) and `Destination link` are still written when all variants are packed.

- [ ] **Step 1: Rename and rewire**

```bash
git mv src/stages/publish.ts src/stages/pack.ts
```

In `src/cli.ts` change `import { runPublish } from "./stages/publish.js";` to `import { runPack } from "./stages/pack.js";` and the `publish:` entry to `run: () => runPack(arg ?? 10)` (keep the key `publish` for now).

- [ ] **Step 2: Edit `src/stages/pack.ts`**

Header comment: replace the first paragraph with

```ts
// Pack stage — Approved → packs on disk (the row stays Approved).
// Each PNG variant becomes its own dated + time-slotted pack in exports/packs/;
// the scheduler (src/schedule.ts) assigns 3/day with a 72h gap per destination
// URL. `clarity posted` moves a pack to exports/posted/ once it is in Pinterest's
// scheduler and flips the row to Scheduled when all four variants are there.
```

Imports: drop the local `postText` function and `readCalendarFromPacks`; import instead:

```ts
import { postText } from "../packText.js";
import { readPacks } from "../packs.js";
import { assignDates, slotTime, type QueueItem, type ScheduledEntry } from "../schedule.js";
```

Replace `readCalendarFromPacks()` with:

```ts
// The posting calendar = every pack on disk, both directories (see src/packs.ts).
async function readCalendarFromPacks(): Promise<ScheduledEntry[]> {
  const all = [...(await readPacks("packs")), ...(await readPacks("posted"))];
  return all.filter((p) => p.text.link).map((p) => ({ date: p.date, destUrl: p.text.link }));
}
```

Replace the `alreadyPacked` pre-scan with:

```ts
  const alreadyPacked = new Map<string, string>(); // "slug--template" -> date
  for (const p of await readPacks("packs")) alreadyPacked.set(`${p.slug}--${p.template}`, p.date);
```

Replace the `needsDate` filter (rows `Published` without date/url no longer exist after this milestone) with just the Approved rows:

```ts
  const rows = (await pinsByStatus("Approved")).slice(0, limit);
```

Replace the `writeFile(... postText(row, a.date, template, a.destUrl) ...)` call with:

```ts
    await writeFile(
      path.join(packDir, "post.txt"),
      postText({
        date: a.date,
        time: slotTime(a.slot),
        pageId,
        image: `${template}.png`,
        title: row.pinTitle ?? row.name,
        description: row.pinDescription ?? "",
        alt: row.altText ?? "",
        board: row.board ?? "(pick manually)",
        link: a.destUrl,
      }),
      "utf8",
    );
```

And the final Notion update no longer sets status or `publishedDate`:

```ts
      await updatePin(pageId, {
        scheduledDate: date,
        destinationLink: await destFor(row),
      });
```

Rename the exported function `runPublish` → `runPack`, and the closing log line to
`` `\n${packed} pack(s) written to exports/packs/ — run /clarity-post to put them on Pinterest.` ``.

- [ ] **Step 3: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean. (`status.ts`'s `readyToPublish` still compiles; it is replaced in Task 13.)

- [ ] **Step 4: Smoke it against the real queue (dry)**

Run: `npm run clarity -- publish 0`
Expected: prints `Nothing to schedule — approve some In Review rows first (clarity approve).` — because `limit 0` slices to nothing. No files written. (This just proves the stage boots with the new imports.)

- [ ] **Step 5: Commit**

```bash
git add -A src/stages/pack.ts src/cli.ts
git commit -m "pack: rename publish; time slots and PAGE id in post.txt; row stays Approved"
```

---

### Task 7: Queue health — packed Approved rows are not in flight

With rows staying `Approved` after packing, `queueHealth` would count them twice (as in-flight lists *and* as packs). Exclude Approved rows whose slug already has a pack in either directory.

**Files:**
- Modify: `src/queue.ts`
- Modify: `tests/queue.test.ts`

**Interfaces:**
- Produces: `export function inFlightFrom(rows: Pick<PinSummary, "name" | "status" | "source">[], packNames: string[]): Partial<Record<Status, number>>` — pure; `queueHealth` calls it.

- [ ] **Step 1: Write the failing test** (append to `tests/queue.test.ts`)

```ts
import { inFlightFrom } from "../src/queue.js";

test("an Approved row whose packs exist is no longer in flight", () => {
  const rows = [
    { name: "The Handmade Gift Bucket List: 12 Presents", status: "Approved", source: "pipeline" },
    { name: "The Tarot Beginner Bucket List: 12 Spreads", status: "Approved", source: "pipeline" },
    { name: "Some Idea", status: "Idea", source: "pipeline" },
    { name: "Old pin", status: "Approved", source: "backfill" },
  ];
  const packs = ["2026-09-08--the-handmade-gift-bucket-list-12-presents--classic-checklist"];
  assert.deepEqual(inFlightFrom(rows, packs), { Approved: 1, Idea: 1 });
});
```

- [ ] **Step 2: Run, see it fail**

Run: `npx tsx --test tests/queue.test.ts`
Expected: FAIL — `inFlightFrom` not exported.

- [ ] **Step 3: Implement**

In `src/queue.ts`, import `slugify` from `./destination.js` and `splitPackName` from `./packs.js`, then add above `queueHealth`:

```ts
/**
 * Rows still to become packs, by status. An Approved row whose packs are already
 * on disk is counted by the runway, not here — otherwise it would count twice.
 */
export function inFlightFrom(
  rows: Pick<PinSummary, "name" | "status" | "source">[],
  packNames: string[],
): Partial<Record<Status, number>> {
  const packed = new Set(packNames.map((n) => splitPackName(n)?.slug).filter(Boolean));
  const inFlight: Partial<Record<Status, number>> = {};
  for (const row of rows) {
    if (row.source === "backfill") continue;
    const status = row.status as Status | undefined;
    if (!status || !IN_FLIGHT_STATUSES.includes(status)) continue;
    if (status === "Approved" && packed.has(slugify(row.name))) continue;
    inFlight[status] = (inFlight[status] ?? 0) + 1;
  }
  return inFlight;
}
```

And in `queueHealth`, replace the `inFlight` loop with:

```ts
  const inFlight = inFlightFrom(rows ?? (await listAllPins()), [...pending, ...submitted]);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/queue.ts tests/queue.test.ts
git commit -m "queue: packed Approved rows are runway, not in-flight"
```

---

### Task 8: `posted` — the 3/4 vs 4/4 rule and the bookkeeping stage

**Files:**
- Create: `src/posted.ts`
- Create: `src/stages/posted.ts`
- Create: `tests/posted.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Consumes: `readPacks`/`PackInfo` (Task 5), `appendNote` from `src/stages/approve.ts`, `updatePin`, `listAllPins`, `TEMPLATE_NAMES`.
- Produces:
  ```ts
  // src/posted.ts
  export const pinUrl = (pinId: string) => `https://www.pinterest.com/pin/${pinId}/`;
  export interface PostedInput {
    postedTemplates: string[];   // templates of this row now in exports/posted/ (incl. the one just moved)
    totalTemplates: number;      // TEMPLATE_NAMES.length
    firstPinId: string;          // pin id of the earliest-dated posted variant
    earliestPackDate: string;    // YYYY-MM-DD across all this row's packs
    existingScheduledDate?: string;
  }
  export interface PostedPatch { status?: "Scheduled"; pinUrl?: string; pinterestPinId?: string; scheduledDate?: string }
  export function postedTransition(i: PostedInput): PostedPatch;
  // src/stages/posted.ts
  export async function runPosted(packDir: string, pinId: string): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/posted.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { postedTransition, pinUrl } from "../src/posted.js";

test("fewer than all variants posted → nothing changes on the row", () => {
  const p = postedTransition({
    postedTemplates: ["classic-checklist", "bold-panel", "sticky-note"],
    totalTemplates: 4,
    firstPinId: "1",
    earliestPackDate: "2026-09-08",
  });
  assert.deepEqual(p, {});
});

test("all variants posted → Scheduled with the first pin's URL and the earliest date", () => {
  const p = postedTransition({
    postedTemplates: ["classic-checklist", "bold-panel", "sticky-note", "big-numbers"],
    totalTemplates: 4,
    firstPinId: "3826344098274829184",
    earliestPackDate: "2026-09-08",
  });
  assert.deepEqual(p, {
    status: "Scheduled",
    pinUrl: "https://www.pinterest.com/pin/3826344098274829184/",
    pinterestPinId: "3826344098274829184",
    scheduledDate: "2026-09-08",
  });
});

test("an existing Scheduled date is kept", () => {
  const p = postedTransition({
    postedTemplates: ["a", "b", "c", "d"],
    totalTemplates: 4,
    firstPinId: "9",
    earliestPackDate: "2026-09-10",
    existingScheduledDate: "2026-09-08",
  });
  assert.equal(p.scheduledDate, "2026-09-08");
});

test("duplicate template names do not count twice", () => {
  const p = postedTransition({
    postedTemplates: ["a", "a", "b", "c"],
    totalTemplates: 4,
    firstPinId: "9",
    earliestPackDate: "2026-09-10",
  });
  assert.deepEqual(p, {});
});

test("pinUrl formats Pinterest's canonical pin URL", () => {
  assert.equal(pinUrl("42"), "https://www.pinterest.com/pin/42/");
});
```

- [ ] **Step 2: Add to the test list, run, see it fail**

Append ` tests/posted.test.ts` to the `"test"` script.

Run: `npx tsx --test tests/posted.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure part**

```ts
// src/posted.ts — what changes on a Notion row after one more of its variants
// lands in Pinterest's scheduler. Pure; the stage does the I/O.
export const pinUrl = (pinId: string) => `https://www.pinterest.com/pin/${pinId}/`;

export interface PostedInput {
  postedTemplates: string[];
  totalTemplates: number;
  firstPinId: string;
  earliestPackDate: string;
  existingScheduledDate?: string;
}

export interface PostedPatch {
  status?: "Scheduled";
  pinUrl?: string;
  pinterestPinId?: string;
  scheduledDate?: string;
}

/** A row is Scheduled only once every variant is on Pinterest — a half-posted
 *  list stays Approved so the status card can show "3/4 posted". */
export function postedTransition(i: PostedInput): PostedPatch {
  if (new Set(i.postedTemplates).size < i.totalTemplates) return {};
  return {
    status: "Scheduled",
    pinUrl: pinUrl(i.firstPinId),
    pinterestPinId: i.firstPinId,
    scheduledDate: i.existingScheduledDate ?? i.earliestPackDate,
  };
}
```

- [ ] **Step 4: Run the pure tests**

Run: `npx tsx --test tests/posted.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the stage**

```ts
// src/stages/posted.ts — bookkeeping after one pin is in Pinterest's scheduler:
//   clarity posted <pack-dir-name> <pin-id>
// Moves the pack to exports/posted/, appends a POSTED line, notes the row, and
// flips it to Scheduled when all variants are there. Claude runs this after every
// pin so no file or Notion row is ever edited by hand.
import { appendFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { listAllPins, updatePin, ensureStatusOptions, type PinSummary } from "../notion.js";
import { readPacks, splitPackName, type PackInfo } from "../packs.js";
import { postedTransition, pinUrl } from "../posted.js";
import { appendNote } from "./approve.js";
import { TEMPLATE_NAMES } from "../render/renderPin.js";
import { slugify } from "../destination.js";

/** The Notion row a pack belongs to: the PAGE line when present, else the slug. */
function rowFor(pack: PackInfo, rows: PinSummary[]): PinSummary | undefined {
  if (pack.text.pageId) return rows.find((r) => r.pageId === pack.text.pageId);
  return rows.find((r) => r.source !== "backfill" && slugify(r.name) === pack.slug);
}

export async function runPosted(packDir: string, pinId: string): Promise<void> {
  const dir = path.basename(packDir); // accept "exports/packs/<dir>" or "<dir>"
  if (!splitPackName(dir)) throw new Error(`Not a pack directory name: ${dir}`);
  if (!/^\d+$/.test(pinId)) throw new Error(`Pin id must be numeric, got: ${pinId}`);

  const pending = await readPacks("packs");
  const pack = pending.find((p) => p.dir === dir);
  if (!pack) throw new Error(`No such pack in exports/packs/: ${dir}`);

  await ensureStatusOptions();
  const rows = await listAllPins();
  const row = rowFor(pack, rows);
  if (!row) throw new Error(`No Notion row for pack ${dir} — add a PAGE: line to its post.txt`);

  // 1. Move the pack and stamp it.
  await mkdir(path.join("exports", "posted"), { recursive: true });
  const dest = path.join("exports", "posted", dir);
  await rename(pack.path, dest);
  await appendFile(path.join(dest, "post.txt"), `\nPOSTED: ${new Date().toISOString()} pin ${pinId}\n`, "utf8");
  console.log(`✓ moved to exports/posted/${dir}`);

  // 2. Everything of this row now in posted/ (including the one just moved).
  const posted = (await readPacks("posted")).filter((p) => rowFor(p, rows)?.pageId === row.pageId);
  const stillPending = pending.filter((p) => p.dir !== dir && rowFor(p, rows)?.pageId === row.pageId);
  const earliest = [...posted, ...stillPending].map((p) => p.date).sort()[0];
  const first = [...posted].sort((a, b) => a.date.localeCompare(b.date) || a.dir.localeCompare(b.dir))[0];

  const patch = postedTransition({
    postedTemplates: posted.map((p) => p.template),
    totalTemplates: TEMPLATE_NAMES.length,
    firstPinId: first.text.posted?.pinId ?? pinId,
    earliestPackDate: earliest,
    existingScheduledDate: row.scheduledDate,
  });

  // 3. Notion: always a note; status only on the last variant.
  const today = new Date().toISOString().slice(0, 10);
  await updatePin(row.pageId, {
    notes: appendNote(row.notes, `posted ${today}: ${pack.template} → ${pinUrl(pinId)}`),
    ...patch,
  });
  const n = new Set(posted.map((p) => p.template)).size;
  console.log(
    patch.status
      ? `✓ ${row.name.slice(0, 60)} → Scheduled (${n}/${TEMPLATE_NAMES.length} variants on Pinterest)`
      : `  ${row.name.slice(0, 60)}: ${n}/${TEMPLATE_NAMES.length} variants posted — row stays Approved`,
  );
}
```

`appendNote` is currently exported from `src/stages/approve.ts` — leave it there (the Worker milestone moves it).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (CLI wiring is Task 12.)

- [ ] **Step 7: Commit**

```bash
git add src/posted.ts src/stages/posted.ts tests/posted.test.ts package.json
git commit -m "posted: bookkeeping after each pin; Scheduled once all variants are up"
```

---

### Task 9: Topic suggestions

**Files:**
- Create: `src/topics.ts`
- Create: `tests/topics.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Produces: `export function suggestTopics(listItems: string, theme?: string): string[]` — up to 10 short, distinct, lower-case candidates: the bold heads of the list items (first two words each) followed by the theme's vibe words. Pinterest's taxonomy is fuzzy-searched by Claude with these.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/topics.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestTopics } from "../src/topics.js";

const items = [
  "1. **Hand-poured candles** — melt, scent, pour.",
  "2. **Sourdough starter** — feed it daily.",
  "3. **Knitted scarf** — one skein, one weekend.",
  "4. **Your turn** — what would you add?",
].join("\n");

test("takes the bold heads of the list items, first two words, lower-case", () => {
  const t = suggestTopics(items);
  assert.deepEqual(t.slice(0, 3), ["hand-poured candles", "sourdough starter", "knitted scarf"]);
});

test("drops the open 'your turn' slot and appends the theme's vibe words", () => {
  const t = suggestTopics(items, "Seasonal");
  assert.ok(!t.includes("your turn"));
  assert.ok(t.includes("cozy living"));
});

test("never more than 10, never duplicates", () => {
  const many = Array.from({ length: 15 }, (_, i) => `${i + 1}. **Thing ${i % 5}** — x`).join("\n");
  const t = suggestTopics(many, "Travel");
  assert.ok(t.length <= 10);
  assert.equal(new Set(t).size, t.length);
});

test("plain lines without bold still yield something", () => {
  assert.deepEqual(suggestTopics("1. Tea tasting at home\n2. Baking bread"), ["tea tasting", "baking bread"]);
});
```

- [ ] **Step 2: Add to the test list, run, see it fail**

Append ` tests/topics.test.ts`. Run: `npx tsx --test tests/topics.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/topics.ts — candidates for the pin builder's 10 tagged topics. Pinterest's
// taxonomy has no "bucket list"/"self care": concrete nouns from the items plus
// a few vibe words per theme work best (learned on the first live pin).
const VIBES: Record<string, string[]> = {
  "Pop culture": ["movie night", "tv shows", "fandom"],
  Manifestation: ["manifestation", "vision board", "journaling"],
  Seasonal: ["cozy living", "autumn day", "holiday season"],
  "It-girl / Aesthetic": ["it girl", "aesthetic", "glow up"],
  Travel: ["travel", "adventure", "weekend trip"],
  "Books & Learning": ["reading", "book club", "learning"],
  "Creative projects": ["diy", "crafts", "handmade"],
  "Career & Skills": ["career", "productivity", "skills"],
  "Luxury & Lifestyle": ["luxury lifestyle", "fine dining", "self care"],
};

const OPEN_SLOT = /your turn|what would you add/i;

export function suggestTopics(listItems: string, theme?: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim().toLowerCase();
    if (v && !out.includes(v) && out.length < 10) out.push(v);
  };
  for (const line of listItems.split(/\r?\n/)) {
    if (OPEN_SLOT.test(line)) continue;
    const head = /\*\*(.+?)\*\*/.exec(line)?.[1] ?? line.replace(/^\s*\d+[.)]\s*/, "").split(/[—–-]{1,2}\s/)[0];
    const words = head.replace(/[^\p{L}\p{N}\s-]/gu, "").trim().split(/\s+/).slice(0, 2).join(" ");
    push(words);
  }
  for (const v of VIBES[theme ?? ""] ?? []) push(v);
  return out;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/topics.ts tests/topics.test.ts package.json
git commit -m "topics: suggest tagged-topic candidates from list items and theme"
```

---

### Task 10: `post-plan` — what to post, in order, inside the 29-day window

**Files:**
- Create: `src/postplan.ts`
- Create: `src/stages/postplan.ts`
- Create: `tests/postplan.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Consumes: `PackInfo` (Task 5), `PINTEREST_BOARD_NAMES` (Task 2), `SLOT_TIMES` (Task 3), `suggestTopics` (Task 9).
- Produces:
  ```ts
  export const SCHEDULER_WINDOW_DAYS = 29;
  export interface PlanEntry {
    n: number; total: number;
    pack: string;         // dir name — the argument for `clarity posted`
    pageId?: string;
    date: string; time: string;   // time defaults to the slot for older packs
    image: string;        // path to the PNG
    board: string;        // Pinterest spelling
    link: string; title: string; description: string; alt: string;
    topics: string[];
  }
  export interface PostPlan { entries: PlanEntry[]; deferred: PackInfo[] }
  export function buildPostPlan(pending: PackInfo[], today: string, topicsFor: (p: PackInfo) => string[], windowDays?: number): PostPlan;
  export function formatPostPlan(plan: PostPlan): string;
  // stage
  export async function runPostPlan(json: boolean): Promise<void>;
  ```
  Older packs without `POST AT:` get a time by their position among that day's packs (`SLOT_TIMES[index]`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/postplan.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPostPlan, formatPostPlan, SCHEDULER_WINDOW_DAYS } from "../src/postplan.js";
import type { PackInfo } from "../src/packs.js";

const pack = (date: string, template: string, extra: Partial<PackInfo["text"]> = {}): PackInfo => ({
  where: "packs",
  dir: `${date}--the-tea-bucket-list--${template}`,
  path: `exports/packs/${date}--the-tea-bucket-list--${template}`,
  date,
  slug: "the-tea-bucket-list",
  template,
  text: {
    date,
    image: `${template}.png`,
    title: "Tea Bucket List",
    description: "d",
    alt: "a",
    board: "Books · Learning & Culture",
    link: "https://clarity-lists.com/posts/the-tea-bucket-list",
    ...extra,
  },
});

test("orders by date then time, and maps the board to Pinterest's spelling", () => {
  const plan = buildPostPlan(
    [pack("2026-09-09", "bold-panel", { time: "01:00 PM" }), pack("2026-09-08", "classic-checklist", { time: "06:00 PM" }), pack("2026-09-08", "sticky-note", { time: "09:00 AM" })],
    "2026-09-08",
    () => ["tea"],
  );
  assert.deepEqual(plan.entries.map((e) => [e.date, e.time]), [
    ["2026-09-08", "09:00 AM"],
    ["2026-09-08", "06:00 PM"],
    ["2026-09-09", "01:00 PM"],
  ]);
  assert.equal(plan.entries[0].board, "Books, Learning & Culture");
  assert.equal(plan.entries[0].image, "exports/packs/2026-09-08--the-tea-bucket-list--sticky-note/sticky-note.png");
  assert.deepEqual(plan.entries.map((e) => e.n), [1, 2, 3]);
  assert.equal(plan.entries[0].total, 3);
});

test("packs beyond the scheduler window are deferred, not planned", () => {
  const plan = buildPostPlan([pack("2026-09-08", "a"), pack("2026-10-07", "b"), pack("2026-10-08", "c")], "2026-09-08", () => []);
  assert.equal(SCHEDULER_WINDOW_DAYS, 29);
  assert.deepEqual(plan.entries.map((e) => e.date), ["2026-09-08", "2026-10-07"]);
  assert.deepEqual(plan.deferred.map((p) => p.date), ["2026-10-08"]);
});

test("packs without POST AT get slot times by position within the day", () => {
  const plan = buildPostPlan([pack("2026-09-08", "a"), pack("2026-09-08", "b")], "2026-09-08", () => []);
  assert.deepEqual(plan.entries.map((e) => e.time), ["09:00 AM", "01:00 PM"]);
});

test("overdue packs (dated before today) come first and keep their date for the note", () => {
  const plan = buildPostPlan([pack("2026-09-08", "a"), pack("2026-09-06", "b")], "2026-09-08", () => []);
  assert.deepEqual(plan.entries.map((e) => e.date), ["2026-09-06", "2026-09-08"]);
});

test("formatPostPlan prints one block per entry and a deferred line", () => {
  const plan = buildPostPlan([pack("2026-09-08", "a", { time: "09:00 AM" }), pack("2026-10-20", "b")], "2026-09-08", () => ["tea", "baking"]);
  const s = formatPostPlan(plan);
  assert.match(s, /1\/1 {2}2026-09-08 {2}09:00 AM/);
  assert.match(s, /board: Books, Learning & Culture/);
  assert.match(s, /topics: tea \| baking/);
  assert.match(s, /1 more pack waiting for the 29-day window/);
});
```

- [ ] **Step 2: Add to the test list, run, see it fail**

Append ` tests/postplan.test.ts`. Run: `npx tsx --test tests/postplan.test.ts` → FAIL.

- [ ] **Step 3: Implement the pure module**

```ts
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
const timeIndex = (t: string) => Math.max(0, (SLOT_TIMES as readonly string[]).indexOf(t));

export function buildPostPlan(
  pending: PackInfo[],
  today: string,
  topicsFor: (p: PackInfo) => string[],
  windowDays = SCHEDULER_WINDOW_DAYS,
): PostPlan {
  const limit = toMs(today) + windowDays * DAY_MS;
  const inWindow = pending.filter((p) => toMs(p.date) <= limit);
  const deferred = pending.filter((p) => toMs(p.date) > limit);

  // Older packs carry no POST AT; give them slots by position within their day.
  const perDay = new Map<string, number>();
  const timed = [...inWindow]
    .sort((a, b) => a.date.localeCompare(b.date) || a.dir.localeCompare(b.dir))
    .map((p) => {
      const used = perDay.get(p.date) ?? 0;
      perDay.set(p.date, used + 1);
      return { p, time: p.text.time ?? SLOT_TIMES[Math.min(used, SLOT_TIMES.length - 1)] };
    })
    .sort((a, b) => a.p.date.localeCompare(b.p.date) || timeIndex(a.time) - timeIndex(b.time));

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
```

- [ ] **Step 4: Run the pure tests**

Run: `npx tsx --test tests/postplan.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the stage**

```ts
// src/stages/postplan.ts — `clarity post-plan [--json]`
import { listAllPins } from "../notion.js";
import { readPacks, type PackInfo } from "../packs.js";
import { buildPostPlan, formatPostPlan } from "../postplan.js";
import { suggestTopics } from "../topics.js";
import { slugify } from "../destination.js";

export async function runPostPlan(json = false): Promise<void> {
  const [pending, rows] = await Promise.all([readPacks("packs"), listAllPins()]);
  const today = new Date().toISOString().slice(0, 10);
  const rowFor = (p: PackInfo) =>
    rows.find((r) => (p.text.pageId ? r.pageId === p.text.pageId : r.source !== "backfill" && slugify(r.name) === p.slug));
  const plan = buildPostPlan(pending, today, (p) => {
    const r = rowFor(p);
    return suggestTopics(r?.listItems ?? "", r?.theme);
  });
  console.log(json ? JSON.stringify(plan.entries, null, 2) : formatPostPlan(plan));
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/postplan.ts src/stages/postplan.ts tests/postplan.test.ts package.json
git commit -m "post-plan: ordered, windowed posting plan with every field the browser step needs"
```

---

### Task 11: `reconcile` — diff Pinterest's own JSON against the packs

**Files:**
- Create: `src/reconcile.ts`
- Create: `src/stages/reconcile.ts`
- Create: `tests/reconcile.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Consumes: `PackInfo` (Task 5), `localParts` (Task 3), `runPosted` (Task 8).
- Produces:
  ```ts
  /** One pin as the skill's browser snippet normalises it from Pinterest's resources. */
  export interface PinterestPin { id: string; title: string; link?: string; ts: number /* unix seconds */; kind: "scheduled" | "published" }
  export interface Reconciliation {
    alreadyLive: { pack: PackInfo; pin: PinterestPin }[];   // in packs/ but Pinterest already has it
    noon: PinterestPin[];                                   // scheduled at 12:00 local — duplicates
    sameDay: { date: string; title: string; ids: string[] }[];
    missing: PackInfo[];                                    // in posted/, dated today or later, not on Pinterest
  }
  export function reconcile(pins: PinterestPin[], pending: PackInfo[], posted: PackInfo[], today: string): Reconciliation;
  export function formatReconcile(r: Reconciliation): string;
  export async function runReconcile(scheduledFile: string, createdFile: string, apply: boolean): Promise<void>;
  ```
  Matching rule: a pack matches a pin when their titles are equal after trimming and lower-casing **and** the pin's local date equals the pack's date.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/reconcile.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, formatReconcile, type PinterestPin } from "../src/reconcile.js";
import type { PackInfo } from "../src/packs.js";

// 2026-09-10 09:00 Jerusalem = 06:00 UTC
const at = (date: string, hourLocal: number) => Date.parse(`${date}T${String(hourLocal - 3).padStart(2, "0")}:00:00Z`) / 1000;

const pack = (where: "packs" | "posted", date: string, title: string, template = "classic-checklist"): PackInfo => ({
  where,
  dir: `${date}--${title.toLowerCase().replace(/\W+/g, "-")}--${template}`,
  path: `exports/${where}/x`,
  date,
  slug: title.toLowerCase().replace(/\W+/g, "-"),
  template,
  text: { date, image: `${template}.png`, title, description: "", alt: "", board: "Travel & Festivals", link: "https://clarity-lists.com/posts/x" },
});

const pin = (id: string, title: string, ts: number, kind: PinterestPin["kind"] = "scheduled"): PinterestPin => ({ id, title, ts, kind });

test("a pending pack whose title+date already exists on Pinterest is 'already live'", () => {
  const r = reconcile([pin("1", "Tea Bucket List", at("2026-09-10", 9))], [pack("packs", "2026-09-10", "Tea Bucket List")], [], "2026-09-08");
  assert.equal(r.alreadyLive.length, 1);
  assert.equal(r.alreadyLive[0].pin.id, "1");
  assert.deepEqual(r.missing, []);
});

test("a pin scheduled at 12:00 local is flagged as a noon duplicate", () => {
  const r = reconcile([pin("1", "A", at("2026-09-10", 9)), pin("2", "A", at("2026-09-10", 12))], [], [], "2026-09-08");
  assert.deepEqual(r.noon.map((p) => p.id), ["2"]);
  assert.deepEqual(r.sameDay, [{ date: "2026-09-10", title: "A", ids: ["1", "2"] }]);
});

test("a posted pack dated today or later with no pin on Pinterest is missing; past ones are not", () => {
  const r = reconcile([], [], [pack("posted", "2026-09-06", "Old"), pack("posted", "2026-09-09", "Gone")], "2026-09-08");
  assert.deepEqual(r.missing.map((p) => p.text.title), ["Gone"]);
});

test("a pending pack is never 'missing' — it has not been posted yet", () => {
  const r = reconcile([], [pack("packs", "2026-09-09", "Soon")], [], "2026-09-08");
  assert.deepEqual(r.missing, []);
});

test("matching ignores case and surrounding whitespace", () => {
  const r = reconcile([pin("1", "  tea bucket list ", at("2026-09-10", 13))], [], [pack("posted", "2026-09-10", "Tea Bucket List")], "2026-09-08");
  assert.deepEqual(r.missing, []);
});

test("formatReconcile names every problem with the URL to act on", () => {
  const r = reconcile(
    [pin("7", "A", at("2026-09-10", 12))],
    [pack("packs", "2026-09-10", "A")],
    [pack("posted", "2026-09-11", "B")],
    "2026-09-08",
  );
  const s = formatReconcile(r);
  assert.match(s, /already on Pinterest/);
  assert.match(s, /12:00 PM duplicate.*\/ClarityBucketLists\/scheduled-pin\/7\//);
  assert.match(s, /missing.*B/);
});

test("a clean state prints a clean line", () => {
  assert.match(formatReconcile(reconcile([], [], [], "2026-09-08")), /nothing to fix/);
});
```

- [ ] **Step 2: Add to the test list, run, see it fail**

Append ` tests/reconcile.test.ts`. Run: `npx tsx --test tests/reconcile.test.ts` → FAIL.

- [ ] **Step 3: Implement the pure module**

```ts
// src/reconcile.ts — Pinterest's own pin lists are the truth; packs on disk are
// what we *think* happened. Diff them before and after every posting session.
// Pure; the stage reads the JSON files and can apply the "already live" fixes.
import { localParts } from "./schedule.js";
import type { PackInfo } from "./packs.js";

export interface PinterestPin {
  id: string;
  title: string;
  link?: string;
  ts: number;
  kind: "scheduled" | "published";
}

export interface Reconciliation {
  alreadyLive: { pack: PackInfo; pin: PinterestPin }[];
  noon: PinterestPin[];
  sameDay: { date: string; title: string; ids: string[] }[];
  missing: PackInfo[];
}

const norm = (s: string) => s.trim().toLowerCase();
const key = (title: string, date: string) => `${norm(title)}@${date}`;

export function reconcile(pins: PinterestPin[], pending: PackInfo[], posted: PackInfo[], today: string): Reconciliation {
  const byKey = new Map<string, PinterestPin>();
  const sameDayGroups = new Map<string, PinterestPin[]>();
  const noon: PinterestPin[] = [];
  for (const pin of pins) {
    const { date, hour } = localParts(pin.ts);
    const k = key(pin.title, date);
    if (!byKey.has(k)) byKey.set(k, pin);
    sameDayGroups.set(k, [...(sameDayGroups.get(k) ?? []), pin]);
    if (pin.kind === "scheduled" && hour === 12) noon.push(pin);
  }

  const alreadyLive = pending.flatMap((pack) => {
    const pin = byKey.get(key(pack.text.title, pack.date));
    return pin ? [{ pack, pin }] : [];
  });

  const sameDay = [...sameDayGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([k, group]) => ({ date: k.slice(k.lastIndexOf("@") + 1), title: group[0].title, ids: group.map((p) => p.id) }));

  const missing = posted.filter((pack) => pack.date >= today && !byKey.has(key(pack.text.title, pack.date)));

  return { alreadyLive, noon, sameDay, missing };
}

const schedUrl = (id: string) => `https://www.pinterest.com/ClarityBucketLists/scheduled-pin/${id}/`;

export function formatReconcile(r: Reconciliation): string {
  const L: string[] = [];
  for (const { pack, pin } of r.alreadyLive) L.push(`already on Pinterest  ${pack.dir}  → pin ${pin.id}  (run: clarity posted ${pack.dir} ${pin.id})`);
  for (const pin of r.noon) L.push(`12:00 PM duplicate    "${pin.title}"  delete at ${schedUrl(pin.id)}`);
  for (const g of r.sameDay) L.push(`same title twice      ${g.date}  "${g.title}"  ids ${g.ids.join(", ")}`);
  for (const pack of r.missing) L.push(`missing on Pinterest  ${pack.dir}  ("${pack.text.title}") — repost`);
  if (!L.length) L.push("Pinterest and the packs agree — nothing to fix.");
  return L.join("\n");
}
```

- [ ] **Step 4: Run the pure tests**

Run: `npx tsx --test tests/reconcile.test.ts` → PASS.

- [ ] **Step 5: Write the stage**

```ts
// src/stages/reconcile.ts — `clarity reconcile <scheduled.json> <created.json> [--apply]`
// The two files are Pinterest's ScheduledPinsResource / UserActivityPinsResource
// data, normalised by the /clarity-post skill's browser snippet to PinterestPin[].
import { readFile } from "node:fs/promises";
import { readPacks } from "../packs.js";
import { reconcile, formatReconcile, type PinterestPin } from "../reconcile.js";
import { runPosted } from "./posted.js";

async function readPins(file: string, kind: PinterestPin["kind"]): Promise<PinterestPin[]> {
  const raw = JSON.parse(await readFile(file, "utf8")) as Partial<PinterestPin>[];
  return raw.map((p) => {
    if (!p.id || typeof p.ts !== "number") throw new Error(`${file}: every entry needs id and ts (unix seconds)`);
    return { id: String(p.id), title: p.title ?? "", link: p.link, ts: p.ts, kind };
  });
}

export async function runReconcile(scheduledFile: string, createdFile: string, apply = false): Promise<void> {
  const pins = [...(await readPins(scheduledFile, "scheduled")), ...(await readPins(createdFile, "published"))];
  const [pending, posted] = await Promise.all([readPacks("packs"), readPacks("posted")]);
  const today = new Date().toISOString().slice(0, 10);
  const r = reconcile(pins, pending, posted, today);
  console.log(formatReconcile(r));
  if (apply && r.alreadyLive.length) {
    console.log(`\nApplying ${r.alreadyLive.length} already-live pack(s):`);
    for (const { pack, pin } of r.alreadyLive) await runPosted(pack.dir, pin.id);
  }
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/reconcile.ts src/stages/reconcile.ts tests/reconcile.test.ts package.json
git commit -m "reconcile: diff Pinterest's pin lists against the packs on disk"
```

---

### Task 12: `ship` — blog post → packs → deploy, and the CLI wiring

**Files:**
- Modify: `src/stages/blogpost.ts` (return count; `Scheduled` eligible)
- Create: `src/stages/ship.ts`
- Modify: `src/cli.ts`
- Modify: `CLAUDE.md` (commands block)

**Interfaces:**
- Consumes: `runBlogpost`, `runPack`, `runPostPlan`, `runPosted`, `runReconcile`, `runStatus`.
- Produces: `export async function runBlogpost(limit = 20): Promise<number>` (posts written); `export async function runShip(): Promise<void>`; CLI commands `ship`, `pack`, `publish` (alias), `post-plan [--json]`, `posted <pack-dir> <pin-id>`, `reconcile <scheduled.json> <created.json> [--apply]`.

- [ ] **Step 1: `blogpost` returns the count and accepts Scheduled rows**

In `src/stages/blogpost.ts`:
- signature → `export async function runBlogpost(limit = 20): Promise<number> {`
- eligibility: `(r.status === "Approved" || r.status === "Scheduled" || r.status === "Published")`
- last line of the function: `return written;`

Run: `npx tsc --noEmit` → clean (the `cli.ts` entry ignores the return value).

- [ ] **Step 2: Write `ship`**

```ts
// src/stages/ship.ts — `clarity ship`: everything after approval that needs no
// browser. Blog post → packs → deploy the blog if anything new was written.
// Every step skips what exists, so rerunning after a failure is safe.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { runBlogpost } from "./blogpost.js";
import { runPack } from "./pack.js";

const BLOG_DIR = process.env.CLARITY_BLOG_DIR ?? path.join("..", "Clarity_blog");

function deployBlog(): void {
  // npx is a .cmd on Windows — shell:true is what makes it resolvable there.
  const run = (args: string[]) => execFileSync("npx", args, { cwd: BLOG_DIR, stdio: "inherit", shell: true });
  run(["astro", "build"]);
  run(["wrangler", "deploy"]);
}

export async function runShip(): Promise<void> {
  console.log("--- blog posts ---");
  const written = await runBlogpost(50);
  console.log("\n--- packs ---");
  await runPack(50);
  if (written) {
    console.log(`\n--- deploying the blog (${written} new post${written === 1 ? "" : "s"}) ---`);
    deployBlog();
  } else {
    console.log("\nNo new blog posts — blog not redeployed.");
  }
  console.log("\nShip done — run `clarity post-plan` for what goes to Pinterest.");
}
```

- [ ] **Step 3: Rewire `src/cli.ts`**

Replace the header comment's state line and the arg parsing, and add the commands:

```ts
// clarity — the pipeline CLI. Usage: npm run clarity -- <command> [args]
// Stages advance rows through the Notion Status state machine:
// Idea → Drafted → Designed → In Review → Approved → Scheduled → Published
import "dotenv/config";
import { runIdeas } from "./stages/ideas.js";
import { runDraft } from "./stages/draft.js";
import { runDesign, runDesignTopUp } from "./stages/design.js";
import { runReview } from "./stages/review.js";
import { runApprove } from "./stages/approve.js";
import { runRevise } from "./stages/revise.js";
import { runPack } from "./stages/pack.js";
import { runBlogpost } from "./stages/blogpost.js";
import { runShip } from "./stages/ship.js";
import { runPostPlan } from "./stages/postplan.js";
import { runPosted } from "./stages/posted.js";
import { runReconcile } from "./stages/reconcile.js";
import { runQueue } from "./queue.js";
import { runStatus } from "./status.js";

const argv = process.argv.slice(3);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const words = argv.filter((a) => !a.startsWith("--"));
// Most commands take one optional number; a few take words.
const arg = words[0] && /^\d+$/.test(words[0]) ? parseInt(words[0], 10) : undefined;

const need = (n: number, usage: string) => {
  if (words.length < n) {
    console.error(`usage: clarity ${usage}`);
    process.exit(2);
  }
};
```

Commands map — replace the `publish:` line with these entries (keep the rest):

```ts
  ship: { desc: "Approved → blog post + packs + blog deploy, in one go (no browser)", run: () => runShip() },
  pack: { desc: "Approved → dated, time-slotted packs in exports/packs/ (arg: limit, default 10)", run: () => runPack(arg ?? 10) },
  publish: {
    desc: "(deprecated alias of pack)",
    run: () => {
      console.warn("`publish` is now `pack` — it no longer marks rows Published; `clarity posted` marks them Scheduled.");
      return runPack(arg ?? 10);
    },
  },
  "post-plan": { desc: "Packs to put on Pinterest, in order, inside the 29-day window (--json for the skill)", run: () => runPostPlan(flags.has("--json")) },
  posted: {
    desc: "Bookkeeping after one pin is scheduled: posted <pack-dir> <pin-id>",
    run: () => {
      need(2, "posted <pack-dir> <pin-id>");
      return runPosted(words[0], words[1]);
    },
  },
  reconcile: {
    desc: "Diff Pinterest's pin JSON against the packs: reconcile <scheduled.json> <created.json> [--apply]",
    run: () => {
      need(2, "reconcile <scheduled.json> <created.json> [--apply]");
      return runReconcile(words[0], words[1], flags.has("--apply"));
    },
  },
```

The `run:` composite command and everything else stay as they are.

- [ ] **Step 4: Typecheck, tests, and boot every new command**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all green.

Run each of these and check the expected output:
- `npm run clarity -- posted` → `usage: clarity posted <pack-dir> <pin-id>`, exit 2.
- `npm run clarity -- reconcile` → usage line, exit 2.
- `npm run clarity -- post-plan` → the 19 current packs (all older-format, so times are filled by position) in date order, plus a deferred line if any is past 29 days.
- `npm run clarity -- post-plan --json` → a JSON array, first element has `n: 1`.
- `npm run clarity -- publish 0` → the deprecation warning, then "Nothing to schedule".

- [ ] **Step 5: Update `CLAUDE.md`'s Commands block**

Replace the `clarity` line and add the new ones:

```
npm run clarity -- <cmd>   # status | queue | ideas | draft | design | topup | review | approve | revise | ship | pack | post-plan | posted | reconcile | blogpost | stats | run
clarity ship               # Approved → blog post + packs + blog deploy (everything after approval that needs no browser)
clarity post-plan [--json] # packs to post, in order, inside Pinterest's 29-day window — what /clarity-post reads
clarity posted <pack> <id> # after one pin is scheduled: move the pack, note the row, Scheduled once all 4 variants are up
clarity reconcile <s.json> <c.json> [--apply]  # diff Pinterest's pin lists vs the packs; --apply marks already-live packs posted
```

In the Architecture section, change the state machine line to
`` `Idea → Drafted → Designed → In Review → Approved → Scheduled → Published` (+ `Needs changes`, `Rejected`, `Archived`) `` and add one bullet:

```
- **`Scheduled` vs `Published`**: `clarity posted` sets `Scheduled` when all four variants are in Pinterest's scheduler; `Published` means the first variant's date has passed (flipped by the nightly job — milestone 3). `pack` (ex-`publish`) never changes status.
```

- [ ] **Step 6: Commit**

```bash
git add src/stages/blogpost.ts src/stages/ship.ts src/cli.ts CLAUDE.md
git commit -m "ship + CLI: one command after approval; wire pack, post-plan, posted, reconcile"
```

---

### Task 13: Status card — approved, partial, window, agreement

**Files:**
- Modify: `src/status.ts`
- Modify: `tests/status.test.ts`

**Interfaces:**
- Consumes: `readPacks` (Task 5), `SCHEDULER_WINDOW_DAYS` (Task 10), `TEMPLATE_NAMES`.
- Produces (changes to `ClarityStatus`):
  - remove `readyToPublish`; add `approved: number` (Approved pipeline rows — all of them, packed or not, because `/clarity-post` clears both).
  - add `partiallyPosted: { name: string; posted: number; total: number }[]`.
  - add `packsBeyondWindow: number`.
  - add `scheduledRows: number` (Notion `Scheduled` count).
  - pure helpers: `partiallyPosted(pending: string[], submitted: string[], total: number): {slug: string; posted: number; total: number}[]` and `beyondWindow(names: string[], today: string, windowDays: number): number`.

- [ ] **Step 1: Write the failing tests** (replace the `readyToPublish` block in `tests/status.test.ts` and add these)

```ts
import { partiallyPosted, beyondWindow } from "../src/status.js";

test("partiallyPosted lists rows with some variants in posted/ and the rest still pending", () => {
  const pending = ["2026-09-12--the-tea-bucket-list--big-numbers"];
  const submitted = [
    "2026-09-08--the-tea-bucket-list--classic-checklist",
    "2026-09-09--the-tea-bucket-list--bold-panel",
    "2026-09-10--the-tea-bucket-list--sticky-note",
    "2026-09-08--the-done-list--classic-checklist", // fully posted rows are not partial
  ];
  assert.deepEqual(partiallyPosted(pending, submitted, 4), [{ slug: "the-tea-bucket-list", posted: 3, total: 4 }]);
});

test("beyondWindow counts pending packs past the scheduler window", () => {
  const names = ["2026-09-08--a--x", "2026-10-07--b--x", "2026-10-08--c--x"];
  assert.equal(beyondWindow(names, "2026-09-08", 29), 1);
});

test("the card names approved lists, partial rows and the window", () => {
  const s = { ...clear, approved: 2, packsWaiting: 5, partiallyPosted: [{ name: "The Tea Bucket List", posted: 3, total: 4 }], packsBeyondWindow: 7 };
  const card = formatStatus(s);
  assert.match(card, /2  lists approved\s+\/clarity-post/);
  assert.match(card, /5  packs to post\s+\/clarity-post/);
  assert.match(card, /The Tea Bucket List — 3\/4 posted/);
  assert.match(card, /7 packs waiting for the 29-day window/);
});

test("the card warns when Notion's Scheduled count and the posted packs disagree", () => {
  const card = formatStatus({ ...clear, scheduledRows: 5, scheduledOnPinterest: 8 });
  assert.match(card, /Notion says 5 lists scheduled, packs say 8 pins — run clarity reconcile/);
});
```

`clear` is the file's existing full-`ClarityStatus` fixture (around line 165). Edit it: drop `readyToPublish: 0`, add `approved: 0, partiallyPosted: [], packsBeyondWindow: 0, scheduledRows: 40` (equal to its `scheduledOnPinterest: 40`, so the agreement line stays quiet in the other card tests). Place the new tests after the `severity` tests, which already spread `clear`.

Also update the existing `attentionItems`/`severity` tests that reference `readyToPublish` to use `approved`.

- [ ] **Step 2: Run, see it fail**

Run: `npx tsx --test tests/status.test.ts` → FAIL (missing exports / fields).

- [ ] **Step 3: Implement**

In `src/status.ts`:

Interface changes:

```ts
  approved: number;
  packsWaiting: number;
  packsOverdue: number;
  packsBeyondWindow: number;
  partiallyPosted: { name: string; posted: number; total: number }[];
  // The calendar.
  scheduledOnPinterest: number;
  scheduledRows: number;
```

Remove `readyToPublish` and its `PublishableRow` interface. Add the two helpers next to `upcomingPins`:

```ts
/** Rows with some variants in posted/ and at least one still in packs/. */
export function partiallyPosted(
  pending: string[],
  submitted: string[],
  total: number,
): { slug: string; posted: number; total: number }[] {
  const slugOf = (n: string) => splitPackName(n)?.slug;
  const pendingSlugs = new Set(pending.map(slugOf).filter(Boolean));
  const counts = new Map<string, Set<string>>();
  for (const n of submitted) {
    const p = splitPackName(n);
    if (p) counts.set(p.slug, new Set([...(counts.get(p.slug) ?? []), p.template]));
  }
  return [...counts.entries()]
    .filter(([slug, t]) => t.size < total && pendingSlugs.has(slug))
    .map(([slug, t]) => ({ slug, posted: t.size, total }));
}

/** Pending packs dated past Pinterest's scheduler window — not postable yet. */
export function beyondWindow(names: string[], today: string, windowDays: number): number {
  const limit = toMs(today) + windowDays * DAY_MS;
  return names.filter((n) => {
    const d = dateOf(n);
    return d !== undefined && toMs(d) > limit;
  }).length;
}
```

Imports to add: `import { splitPackName } from "./packs.js";`, `import { SCHEDULER_WINDOW_DAYS } from "./postplan.js";`, `import { TEMPLATE_NAMES } from "./render/renderPin.js";`, `import { slugify } from "./destination.js";`.

`attentionItems`: replace the `readyToPublish` line with `if (s.approved) items.push(\`${plural(s.approved, "list")} approved\`);`.

`formatStatus`, ⚡ block — replace the two `readyToPublish`/`packsWaiting` rows with:

```ts
    if (s.approved) L.push(row(s.approved, "lists approved", "/clarity-post"));
    if (s.packsWaiting) L.push(row(s.packsWaiting, "packs to post", "/clarity-post"));
    for (const p of s.partiallyPosted) L.push(`        ${p.name} — ${p.posted}/${p.total} posted`);
```

📅 block — after the dot strip:

```ts
  if (s.packsBeyondWindow) {
    L.push(`        ${plural(s.packsBeyondWindow, "pack")} waiting for the ${SCHEDULER_WINDOW_DAYS}-day window`);
  }
  if (s.scheduledRows !== s.scheduledOnPinterest) {
    L.push(`        ⚠ Notion says ${s.scheduledRows} lists scheduled, packs say ${s.scheduledOnPinterest} pins — run clarity reconcile`);
  }
```

Note the agreement check compares *lists* to *pins*; that is deliberate for this milestone — until the migration (milestone 3) Notion has zero `Scheduled` rows while packs exist, so the line will show. If that reads as noise during acceptance, gate it with `s.scheduledRows > 0 &&` and record that in the commit message.

`gatherStatus`: 

```ts
  const partial = partiallyPosted(pending, submitted, TEMPLATE_NAMES.length).map((p) => ({
    name: rows.find((r) => r.source !== "backfill" && slugify(r.name) === p.slug)?.name ?? p.slug,
    posted: p.posted,
    total: p.total,
  }));
  return {
    // …
    approved: rows.filter((r) => r.status === "Approved" && r.source !== "backfill").length,
    packsWaiting,
    packsOverdue: health.pastDue,
    packsBeyondWindow: beyondWindow(pending, today, SCHEDULER_WINDOW_DAYS),
    partiallyPosted: partial,
    scheduledOnPinterest,
    scheduledRows: rows.filter((r) => r.status === "Scheduled").length,
    // …
  };
```

- [ ] **Step 4: Run tests + typecheck + the real card**

Run: `npm test && npx tsc --noEmit && npm run clarity -- status`
Expected: green; the card shows `lists approved  /clarity-post` for the rows approved on 2026-09-08 and `packs to post  /clarity-post` for the 19 packs.

- [ ] **Step 5: Commit**

```bash
git add src/status.ts tests/status.test.ts
git commit -m "status: approved lists, partial rows, scheduler window, Notion/packs agreement"
```

---

### Task 14: The `/clarity-post` skill

**Files:**
- Create: `C:\Users\shirr\.claude\skills\clarity-post\SKILL.md`
- Modify: `C:\Users\shirr\.claude\skills\clarity-status\SKILL.md` (next-action list)

**Interfaces:**
- Consumes: every command from Tasks 8–12; the Chrome extension tools (`find`, `computer`, `javascript_tool`, `file_upload`, `navigate`, `tabs_create_mcp`).

- [ ] **Step 1: Write the skill**

```markdown
---
name: clarity-post
description: |
  Use when the user wants approved Clarity lists shipped — "post", "clarity post", "put the pins on Pinterest", "ship the approved lists", "תפרסם את הרשימות" — or types /clarity-post. Runs `clarity ship`, then drives Pinterest's pin builder in the user's Chrome for every pack in `clarity post-plan`, calling `clarity posted` after each pin. The laptop must be open and Chrome logged in as ClarityBucketLists.
triggers:
  - "clarity post"
  - "clarity-post"
  - "post the pins"
  - "ship the approved lists"
  - "put the pins on pinterest"
---

# clarity-post

One trigger takes every Approved list to Pinterest's scheduler. The deterministic parts
are CLI commands; only the pin builder is driven by hand, one pin at a time, from the
checklist below. **Never edit a pack file or a Notion row directly — `clarity posted` does
the bookkeeping.**

All commands run from `C:/Users/shirr/OneDrive/Documents/Cool projects/Clarity/Clarity_pinterest`
as `npm run clarity -- <cmd> [args]`.

## Flow

1. `clarity ship` — blog posts, packs, blog deploy. Read its output; a `⚠ … no blog post yet`
   line means a row is missing list items — stop and tell the user.
2. **Reconcile before posting.** Open a Pinterest tab, run the snippet in *Pulling
   Pinterest's lists* below, save the two arrays to `exports/reconcile/scheduled.json` and
   `exports/reconcile/created.json`, then `clarity reconcile exports/reconcile/scheduled.json
   exports/reconcile/created.json --apply`. Anything flagged as a 12:00 PM duplicate or
   "same title twice" is deleted **before** posting (see *Deleting a duplicate*).
3. `clarity post-plan --json` → the list. Post them in order. Stop when the plan is empty
   or Pinterest blocks (see *Stopping*).
4. For each entry, the *Per-pin checklist*. After Pinterest confirms, read the new pin's id
   from `ScheduledPinsResource` (snippet), then `clarity posted <pack> <pin-id>`.
5. After the last pin: reconcile again (step 2 without `--apply`) — this is what catches a
   12:00 PM duplicate created *this* session.
6. `clarity status` and show the card.

## Per-pin checklist

Open `https://www.pinterest.com/pin-creation-tool/` in a fresh tab for every pin (the tab
degrades after heavy use; a fresh tab costs nothing).

1. **Drafts must be empty.** If the drafts sidebar shows any draft, publish or delete it
   first — with two drafts, Publish sends the *other* one, on the wrong board.
2. Upload the PNG via `file_upload` on the form's `input[type=file]` (find the ref each time).
3. Title → `input[placeholder="Tell everyone what your Pin is about"]` — set with the
   native value setter + `input` event.
4. Description → the `[contenteditable=true]` Draft.js editor: **synthetic paste only**
   (`new ClipboardEvent('paste', {clipboardData})`). Typing scrambles the caret;
   `execCommand` unmounts the editor.
5. Link → `input[type=url]`.
6. **Board: click it explicitly** — `[data-test-id="board-dropdown-select-button"]` then
   `[data-test-id="board-row-<board>"]` with the `board` string from the plan (Pinterest
   spelling). A board that merely *displays* correctly leaves Publish disabled.
7. Tagged topics → `input[placeholder="Search for a tag"]`: type each `topics` candidate,
   pick a `[role=option]` that actually matches (filter by the keyword — the list is fuzzy
   and offers "Twilight Sparkle" for "twilight"). Fill all 10 slots; if the candidates run
   out, use concrete nouns from the description.
8. Alt text → `[data-test-id="storyboard-show-more-options-button"]` then `#storyboardAltText`.
9. Schedule → `[data-test-id="pin-draft-switch-group"] input` ON; date field: type
   `MM/DD/YYYY` from `date` and press Enter; time: click the list leaf whose text equals
   `time` exactly (e.g. `09:00 AM`). **Read all three back** before submitting — the
   submit button must say **Schedule**, never **Publish**.
10. Submit → `[data-test-id="storyboard-creation-nav-done"] button` then the confirm
    dialog's second **Schedule** button. Use `find` + `computer left_click` — programmatic
    `.click()` is not a trusted event here.
11. Verify: run the scheduled snippet, find the entry whose `title` equals the plan's
    title and whose `ts` is on `date`; confirm `link` is the plan's `link`. Take its `id`.
12. `clarity posted <pack> <id>`.
13. Wait ≥ 60 s before the next pin (tool-level `wait`, not in-page sleeps).

## Pulling Pinterest's lists

Run in a tab on `https://www.pinterest.com/ClarityBucketLists/_created/`:

```js
async function pull(kind) {
  const res = kind === "scheduled" ? "ScheduledPinsResource" : "UserActivityPinsResource";
  const options = { username: "ClarityBucketLists", field_set_key: "grid_item", is_own_profile_pins: true, page_size: 100 };
  const url = `/resource/${res}/get/?source_url=/ClarityBucketLists/_created/&data=${encodeURIComponent(JSON.stringify({ options, context: {} }))}`;
  const r = await fetch(url, { headers: { "x-pinterest-pws-handler": "www/[username]/_created.js" } });
  const j = await r.json();
  return (j.resource_response?.data ?? []).map((p) => ({
    id: String(p.id),
    title: p.title || p.grid_title || "",
    link: p.link || "",
    ts: p.scheduled_ts || Math.floor(Date.parse(p.created_at) / 1000),
  }));
}
console.log("SCHEDULED " + JSON.stringify(await pull("scheduled")));
console.log("CREATED " + JSON.stringify(await pull("created")));
```

Read the two lines with `read_console_messages` (pattern `^(SCHEDULED|CREATED) `) and write
each JSON array to its file. `UserActivityPinsResource` rate-limits after a few rapid
calls — reload the tab and space the calls out. Output with `key=value` pairs gets blocked
by the extension; this snippet avoids them.

## Deleting a duplicate

A *scheduled* pin: go straight to `https://www.pinterest.com/ClarityBucketLists/scheduled-pin/<id>/`,
confirm the page says "Scheduled for …", click **Delete**, confirm in the modal. Never use
the "…" menu on the scheduled-pins grid — the masonry re-lays out under the open menu and
the click lands on another card. A *published* pin: open `/pin/<id>/`, wait for the stats
panel, click "…" → **Edit Pin** → Delete → confirm.

## Stopping

- Pinterest says it "hit a block we have in place to combat spam" → stop the batch. The
  remaining packs stay in `exports/packs/`; say so and show `clarity status`. Try tomorrow.
- A timed-out tool call may still have succeeded — re-read state (the scheduled snippet)
  before doing anything again. Never re-submit blind.
- The plan lists packs by date; if the user is short on time, posting the first N and
  stopping is fine — every pin is bookkept individually.

## What the user sees

Say what shipped in one line per list ("Tea Bucket List — 4 pins scheduled, Sep 12–20"),
then the status card. If anything was skipped or flagged, say exactly which pack and why.
```

- [ ] **Step 2: Update `/clarity-status`'s next-action list**

In `clarity-status/SKILL.md`, replace the "After showing the card" bullets with:

```markdown
- lists in review → `clarity approve` opens the local review page at 127.0.0.1:4178
- lists needing changes → `clarity revise`
- lists approved, or packs to post → `/clarity-post`
- packs overdue → `/clarity-post` (they come first in its plan)
- blog behind → `cd Clarity_blog && npx astro build && npx wrangler deploy`
```

And in the table, the ⚡ row: "Each row names the command or skill that clears it."

- [ ] **Step 3: Check the skill loads**

Start a new Claude Code turn and type `/clarity-post` — it should announce the skill and begin with `clarity ship`. Stop it there (this is a load check, not the acceptance run).

- [ ] **Step 4: Commit the skills**

The skills live outside the repo; no git. Note their paths in the plan's status update (Task 15).

---

### Task 15: Acceptance run and docs

**Files:**
- Modify: `../CLARITY_PLAN.md` (+ `.html` twin) — Status section
- Modify: project memory `pinterest-chrome-posting-recipe.md` — one line pointing at the skill

- [ ] **Step 1: `clarity ship` on the real Approved rows**

Run: `npm run clarity -- ship`
Expected: blog posts for the lists approved on 2026-09-08 (skipping any that exist), packs written with `POST AT:` and `PAGE:` lines, blog rebuilt and deployed. Confirm one new post loads at `https://clarity-lists.com/posts/<slug>`.

- [ ] **Step 2: `/clarity-post` for real, with the user present**

Run the skill end to end on at least one full list (4 pins). After it finishes:
- the row is `Scheduled` in Notion with a Pin URL;
- its four packs are in `exports/posted/` with `POSTED:` lines;
- `clarity reconcile` (second pass) reports nothing to fix;
- `clarity status` shows the list under 📅 and no longer under ⚡.

- [ ] **Step 3: Update the plan's Status section**

Add to `../CLARITY_PLAN.md` under Status (and mirror in the `.html`):

```markdown
**Milestone 2 — hands-off pipeline, step 1 (Sep 2026): done.** New `Scheduled` state (all four variants in Pinterest's scheduler; `Published` now means live). One command after approval — `clarity ship` (blog post → packs → deploy) — and one skill, `/clarity-post`, that drives the pin builder from `clarity post-plan`, bookkeeping every pin with `clarity posted` and checking Pinterest's own lists with `clarity reconcile` before and after. Spec: `Clarity_pinterest/docs/superpowers/specs/2026-09-08-hands-off-pipeline-design.md`. Next: the phone review page (`review.clarity-lists.com`, step 2) and the daily job (step 3).
```

- [ ] **Step 4: Point the memory at the skill**

Append to `pinterest-chrome-posting-recipe.md`: `The canonical, maintained version of this recipe is the /clarity-post skill (~/.claude/skills/clarity-post/SKILL.md); update it there first.`

- [ ] **Step 5: Final commit**

```bash
git add -A
git status   # confirm only intended files: docs, exports are git-ignored
git commit -m "Milestone 1 of the hands-off pipeline: ship, post-plan, posted, reconcile, /clarity-post"
```

---

## Self-review

**Spec coverage (sections 1, 4, 6, 7, 8, build-order 1):**
- §1 `Scheduled` state, `Published` meaning, `Approved` = waiting → Tasks 2, 6, 8, 13. Migration script → milestone 3 (as specified).
- §4.1 `ship` → Task 12; slots + `POST AT` → Tasks 3, 4, 6; deploy only on new posts → Task 12.
- §4.2 `post-plan`, 29-day window, board mapping, topics, `--json` → Tasks 2, 9, 10.
- §4.3 browser checklist in the skill → Task 14.
- §4.4 `posted` → Task 8. §4.5 `reconcile` → Task 11. §4.6 flow → Task 14.
- §6 card rows → Task 13. §7 error rows: spam block / window / rerun-safe ship / tab / n-of-4 → Tasks 8, 10, 12, 14. Worker rows → milestone 2.
- §8 tests → every task; Worker tests → milestone 2.

**Placeholder scan:** none — every step has its code or its exact command.

**Type consistency:** `PackInfo`/`PackText` (Tasks 4–5) used unchanged in 6, 8, 10, 11, 13; `PinterestPin` (11) matches the skill's snippet fields (`id`, `title`, `link`, `ts`); `runBlogpost(): Promise<number>` (12) consumed by `ship`; `postedTransition` fields (8) match the stage's call; `PlanEntry.pack` is the `posted` argument; `PINTEREST_BOARD_NAMES` keyed by `Board` (2) indexed in 10 via `as Board` with a fallback.
