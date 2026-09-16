# Hands-off pipeline — Milestone 3: the nightly job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The unattended job runs every night: revises "Needs changes" rows back into the queue, tops the queue up when it is short, and flips `Scheduled` rows whose pins have all gone live to `Published`; a one-off script migrates the legacy `Published` rows that are really `Scheduled`.

**Architecture:** Two new pure modules (`src/publishedFlip.ts`, `src/migrateScheduled.ts`) hold every decision and are unit-tested with `node:test`; `scripts/scheduled-run.ts` becomes a three-step orchestrator (revise → generate-if-needed → flip) that never exits before the flip; `scripts/register-task.ps1` moves the Windows trigger from Mon/Thu to daily; `scripts/migrate-scheduled.ts` is the one-off migration with a dry run by default. No new dependencies.

**Tech Stack:** Node 24 / TypeScript (ESM, `tsx`), `node:test`, `@notionhq/client` (via the existing `src/notion.ts` helpers), Windows Task Scheduler via PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-08-hands-off-pipeline-design.md` — §1 (States, incl. the Migration paragraph), §5 (The nightly job), §8 (`publishedFlip.test.ts` — date boundary), §9 step 3, §10 (Housekeeping).

## Global Constraints

- Working directory for every command is `Clarity_pinterest/`. Commands: `npm test` (explicit file list in `package.json` — **every new test file must be appended to that list**), `npx tsc --noEmit`, `npm run generate` (= `tsx scripts/scheduled-run.ts`).
- The nightly job **never posts and never approves** (spec §5). It may call Claude (through `runRevise` / the generate stages) but the flip and the migration make **no Pinterest call** — they are date-based (spec §1: "Flipped by the nightly job, date-based, no Pinterest call").
- Pure modules (`src/publishedFlip.ts`, `src/migrateScheduled.ts`) never import `notion.ts`, `dotenv`, or the filesystem; the stage/script does the I/O.
- Status vocabulary is `STATUSES` in `src/schema.ts` (`Scheduled` sits between `Approved` and `Published`). `Scheduled` = all four variants in Pinterest's scheduler; `Published` = the first variant's date has passed.
- **Ruling on "today" and the boundary (deviation from spec §5's "≤ today"):** the job runs at 02:00 **Asia/Jerusalem** (`POST_TZ` in `src/schedule.ts`) and pins go live at 09:00 / 01:00 PM / 06:00 PM local on their date. So "the date has passed" means `scheduledDate < today` where `today` is the **local** calendar date in `POST_TZ`, not the UTC date. A row scheduled for the 17th flips on the night of the 17th→18th (at 02:00 on the 18th), never at 02:00 on the 17th, seven hours before its first pin exists. `scheduled-run.ts` currently derives `today` from `toISOString()` (UTC); the flip must not.
- `Scheduled date` on a row is `YYYY-MM-DD` (`PinSummary.scheduledDate`); `updatePin(pageId, patch)` accepts `status`, `publishedDate`, `scheduledDate`, `notes` (all `YYYY-MM-DD` strings for dates).
- When a row flips to `Published`, set `publishedDate` to its `scheduledDate` **only if `publishedDate` is empty** — `stages/pack.ts` builds the existing posting calendar from `publishedDate` of Published rows, so the field must be filled, and a value already there wins (same keep-what's-there rule as `postedTransition`).
- Commit messages: imperative subject; end with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Zero new npm dependencies.

---

## File structure

| File | Responsibility |
|---|---|
| `src/publishedFlip.ts` (create) | Pure: which `Scheduled` rows are now live → `{ pageId, publishedDate }[]`. |
| `src/stages/publishedFlip.ts` (create) | I/O: read `Scheduled` rows, apply the pure decision, `updatePin` each, print one line per flip. |
| `tests/publishedFlip.test.ts` (create) | Date boundary, non-Scheduled rows ignored, missing `scheduledDate` ignored, existing `publishedDate` kept. |
| `src/migrateScheduled.ts` (create) | Pure: legacy `Published` rows + posted packs + today → which rows become `Scheduled` (and their `scheduledDate`). |
| `tests/migrateScheduled.test.ts` (create) | Future earliest pack → Scheduled; past → untouched; no packs → untouched; existing `scheduledDate` kept. |
| `scripts/migrate-scheduled.ts` (create) | One-off CLI: dry run prints the plan; `--apply` writes it. |
| `scripts/scheduled-run.ts` (modify) | Order: revise → generate-if-needed → flip. Local `today`. No early `process.exit` before the flip. |
| `scripts/register-task.ps1` (modify) | Trigger `-Daily -At 2am`; description/help text say "nightly". |
| `package.json` (modify) | Append the two test files to the `test` script. |
| `CLAUDE.md`, `../CLARITY_PLAN.md` + `.html` (modify) | Commands block, state-machine bullet, status paragraph. |

---

### Task 1: The Published flip — pure module + stage

**Files:**
- Create: `src/publishedFlip.ts`
- Create: `src/stages/publishedFlip.ts`
- Create: `tests/publishedFlip.test.ts`
- Modify: `package.json` (the `test` script's file list)

**Interfaces:**
- Consumes: `PinSummary` (`src/notionPage.ts`: `pageId`, `name`, `status?`, `scheduledDate?`, `publishedDate?`), `pinsByStatus(status)` and `updatePin(pageId, patch)` from `src/notion.ts`, `POST_TZ` from `src/schedule.ts`.
- Produces: `publishedFlip(rows, today): FlipDecision[]` and `localToday(now?, tz?): string` from `src/publishedFlip.ts`; `runPublishedFlip(today?): Promise<number>` from `src/stages/publishedFlip.ts` (returns how many rows flipped). Task 2 calls `runPublishedFlip` and `localToday`.

- [ ] **Step 1: Write the failing tests**

`tests/publishedFlip.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { publishedFlip, localToday } from "../src/publishedFlip.js";

const row = (pageId: string, status: string | undefined, scheduledDate?: string, publishedDate?: string) => ({
  pageId,
  name: `row ${pageId}`,
  status,
  scheduledDate,
  publishedDate,
});

test("a Scheduled row dated before today flips, and gets publishedDate = scheduledDate", () => {
  const out = publishedFlip([row("a", "Scheduled", "2026-09-16")], "2026-09-17");
  assert.deepEqual(out, [{ pageId: "a", publishedDate: "2026-09-16" }]);
});

test("date boundary: a row dated today does NOT flip (its pins go live later today)", () => {
  assert.deepEqual(publishedFlip([row("a", "Scheduled", "2026-09-17")], "2026-09-17"), []);
});

test("a row dated after today does not flip", () => {
  assert.deepEqual(publishedFlip([row("a", "Scheduled", "2026-09-18")], "2026-09-17"), []);
});

test("only Scheduled rows are considered — Approved and Published rows are ignored", () => {
  const rows = [row("a", "Approved", "2026-09-01"), row("b", "Published", "2026-09-01"), row("c", undefined, "2026-09-01")];
  assert.deepEqual(publishedFlip(rows, "2026-09-17"), []);
});

test("a Scheduled row with no scheduledDate is skipped, never flipped blind", () => {
  assert.deepEqual(publishedFlip([row("a", "Scheduled")], "2026-09-17"), []);
});

test("an existing publishedDate is kept, not overwritten", () => {
  const out = publishedFlip([row("a", "Scheduled", "2026-09-10", "2026-09-12")], "2026-09-17");
  assert.deepEqual(out, [{ pageId: "a", publishedDate: "2026-09-12" }]);
});

test("output keeps input order and covers every qualifying row", () => {
  const rows = [row("a", "Scheduled", "2026-09-01"), row("b", "Scheduled", "2026-09-30"), row("c", "Scheduled", "2026-09-02")];
  assert.deepEqual(
    publishedFlip(rows, "2026-09-17").map((d) => d.pageId),
    ["a", "c"],
  );
});

test("localToday: the calendar date in the posting zone, not UTC", () => {
  // 2026-09-16T23:30:00Z is already 2026-09-17 02:30 in Asia/Jerusalem (UTC+3 in September).
  assert.equal(localToday(new Date("2026-09-16T23:30:00Z"), "Asia/Jerusalem"), "2026-09-17");
  // and 2026-09-16T20:00:00Z is still the 16th there.
  assert.equal(localToday(new Date("2026-09-16T20:00:00Z"), "Asia/Jerusalem"), "2026-09-16");
});
```

- [ ] **Step 2: Add the test file to `package.json` and run it to verify it fails**

In `package.json`, append ` tests/publishedFlip.test.ts` to the end of the `"test"` script's file list (space-separated, same line).

Run: `npx tsx --test tests/publishedFlip.test.ts`
Expected: FAIL — `Cannot find module '../src/publishedFlip.js'`.

- [ ] **Step 3: Write the pure module**

`src/publishedFlip.ts`:

```ts
// src/publishedFlip.ts — which Scheduled rows are live now. Pure; the stage
// does the I/O. A row is live once every slot of its scheduled date has passed,
// i.e. on any later local day — never on the day itself (the nightly job runs at
// 02:00, seven hours before the first slot).
import { POST_TZ } from "./schedule.js";

export interface FlipCandidate {
  pageId: string;
  name: string;
  status?: string;
  scheduledDate?: string; // YYYY-MM-DD
  publishedDate?: string; // YYYY-MM-DD
}

export interface FlipDecision {
  pageId: string;
  /** What `Published date` becomes: the existing value if set, else the scheduled date. */
  publishedDate: string;
}

/** The calendar date in the posting zone — the nightly job runs at 02:00 local,
 *  which is still "yesterday" in UTC. */
export function localToday(now: Date = new Date(), tz: string = POST_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function publishedFlip(rows: FlipCandidate[], today: string): FlipDecision[] {
  const out: FlipDecision[] = [];
  for (const r of rows) {
    if (r.status !== "Scheduled") continue;
    if (!r.scheduledDate) continue; // never flip blind
    if (r.scheduledDate >= today) continue; // YYYY-MM-DD compares lexically
    out.push({ pageId: r.pageId, publishedDate: r.publishedDate ?? r.scheduledDate });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/publishedFlip.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Write the stage**

`src/stages/publishedFlip.ts`:

```ts
// Scheduled → Published for rows whose pins have all gone live. Date-based —
// no Pinterest call. Called by the nightly job after revise + generate.
import { pinsByStatus, updatePin } from "../notion.js";
import { publishedFlip, localToday } from "../publishedFlip.js";

/** Flips every qualifying row; returns how many were flipped. */
export async function runPublishedFlip(today: string = localToday()): Promise<number> {
  const rows = await pinsByStatus("Scheduled");
  const decisions = publishedFlip(rows, today);
  if (!decisions.length) {
    console.log(`No Scheduled rows dated before ${today} — nothing to flip.`);
    return 0;
  }
  const byId = new Map(rows.map((r) => [r.pageId, r]));
  for (const d of decisions) {
    await updatePin(d.pageId, { status: "Published", publishedDate: d.publishedDate });
    console.log(`✓ ${byId.get(d.pageId)?.name.slice(0, 60) ?? d.pageId} → Published (live since ${d.publishedDate})`);
  }
  return decisions.length;
}
```

- [ ] **Step 6: Typecheck and run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean; all tests pass (192 before this task + 8 new = 200).

- [ ] **Step 7: Commit**

```bash
git add src/publishedFlip.ts src/stages/publishedFlip.ts tests/publishedFlip.test.ts package.json
git commit -m "publishedFlip: Scheduled → Published once every slot of the scheduled date has passed"
```

---

### Task 2: The nightly job — daily, revise first, flip last

**Files:**
- Modify: `scripts/scheduled-run.ts` (whole file — rewrite the body below the log tee)
- Modify: `scripts/register-task.ps1` (trigger + wording)

**Interfaces:**
- Consumes: `runRevise(limit = 10, chain = true): Promise<void>` from `src/stages/revise.ts` (chain = true re-designs and returns the row to In Review); `queueHealth(today)` / `formatQueueHealth` from `src/queue.ts`; `runIdeas/runDraft/runDesign/runReview(n)` as today; `runPublishedFlip(today)` and `localToday()` from Task 1.
- Produces: `npm run generate` = the nightly job. No exported API.

- [ ] **Step 1: Rewrite `scripts/scheduled-run.ts`**

Keep the header comment block, the imports, the log tee and the `forced` parsing, but replace the header comment's first paragraph and the whole `try { … }` body so the file reads:

```ts
// The nightly job — Windows Task Scheduler fires it every day at 02:00.
// See scripts/register-task.ps1 to install it.
//
// It never posts and never approves. In order:
//   1. revise   — "Needs changes" rows get the reviewer's note applied and go
//                 back to In Review (so a note typed on the phone is in the
//                 queue by morning);
//   2. generate — only if queue health says the calendar is running short
//                 (ideas → draft → design → review), exactly as before;
//   3. flip     — Scheduled rows whose pins have all gone live → Published.
//                 Date-based, no Pinterest call.
// Steps 1 and 3 always run; step 2 is skipped (no Claude call) when the queue
// is healthy, so the job is safe to fire more often than needed.
//
//   npm run generate        # decide the batch size from queue health
//   npm run generate -- 2   # force 2 lists, ignoring queue health (for testing)
import "dotenv/config";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { queueHealth, formatQueueHealth } from "../src/queue.js";
import { runIdeas } from "../src/stages/ideas.js";
import { runDraft } from "../src/stages/draft.js";
import { runDesign } from "../src/stages/design.js";
import { runReview } from "../src/stages/review.js";
import { runRevise } from "../src/stages/revise.js";
import { runPublishedFlip } from "../src/stages/publishedFlip.js";
import { localToday } from "../src/publishedFlip.js";

const today = localToday();
const logFile = path.join("logs", `scheduled-run-${today}.log`);
mkdirSync("logs", { recursive: true });

// The stages print their own progress; tee it all so an overnight run is readable
// in the morning and Task Scheduler failures have something to point at.
for (const level of ["log", "warn", "error"] as const) {
  const write = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    write(...args);
    try {
      appendFileSync(logFile, args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n");
    } catch {
      // A log we cannot write must not take the run down with it.
    }
  };
}

const forced = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;

console.log(`\n=== clarity nightly run — ${new Date().toISOString()} (today in posting zone: ${today}) ===`);

let failed = false;
const step = async (name: string, fn: () => Promise<unknown>) => {
  console.log(`\n--- ${name} ---`);
  try {
    await fn();
  } catch (err) {
    failed = true;
    console.error(`x ${name} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
};

// 1. revise — a failure here must not stop the flip below, hence per-step try/catch.
await step("revise (Needs changes → In Review)", () => runRevise());

// 2. generate, only when the queue is short.
await step("generate", async () => {
  const before = await queueHealth(today);
  console.log(formatQueueHealth(before));
  const n = forced ?? before.needed;
  if (forced !== undefined) console.log(`(forced batch of ${forced}, ignoring queue health)`);
  if (!n) {
    console.log(`Queue is healthy — nothing to generate.`);
    return;
  }
  console.log(`\n--- ideas (${n}) ---`);
  await runIdeas(n);
  console.log(`\n--- draft (${n}) ---`);
  await runDraft(n);
  console.log(`\n--- design (${n}) ---`);
  await runDesign(n);
  console.log(`\n--- review ---`);
  await runReview(n);
  console.log(`\n=== queue after generating ===`);
  console.log(formatQueueHealth(await queueHealth(today)));
});

// 3. flip Scheduled → Published for rows dated before today.
await step("flip (Scheduled → Published)", () => runPublishedFlip(today));

console.log(`\nLog: ${logFile}`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Typecheck and dry-run the job**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run generate`
Expected (tonight's data): the revise step processes the rows in "Needs changes" (this calls Claude, ~85 s per list, and chains design + review — that is the intended nightly behaviour; let it run), the generate step prints the queue card and "Queue is healthy — nothing to generate." (or generates if the queue is short), and the flip step prints either flips or "No Scheduled rows dated before <today> — nothing to flip." Exit code 0. The log lands in `logs/scheduled-run-<today>.log`.

If Claude is unavailable, the revise step fails and is reported, and the run still reaches the flip — that is the point of the per-step try/catch. Note the outcome in your report either way.

- [ ] **Step 3: Move the trigger to daily in `scripts/register-task.ps1`**

Replace:

```powershell
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Thursday -At 2am
```

with:

```powershell
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
```

Update the wording so the script does not lie about itself:
- `.SYNOPSIS`: `Installs the nightly job for the Clarity Pinterest pipeline.`
- `.DESCRIPTION` first paragraph: `Registers a Windows scheduled task that runs `npm run generate` in this repo every day at 02:00. The job revises "Needs changes" lists back into the review queue, tops the queue up only when the posting calendar runs short, and flips Scheduled rows to Published once their pins are live. It never posts to Pinterest and never approves a list - approving stays a manual step.`
- `-Description` argument: `"Clarity nightly job: revise -> top up the review queue when short -> flip Scheduled to Published. Never posts."`
- The final `Write-Host "Registered '$TaskName' - Mondays and Thursdays at 02:00."` → `Write-Host "Registered '$TaskName' - every day at 02:00."`

Leave `$TaskName` unchanged (`Clarity Pinterest generation`) so re-running the script with `-Force` replaces the existing task instead of leaving two.

Do **not** run the registration script yourself — the controller runs it on the user's machine after review (it changes a system scheduled task).

- [ ] **Step 4: Commit**

```bash
git add scripts/scheduled-run.ts scripts/register-task.ps1
git commit -m "nightly job: daily at 02:00 — revise, generate when short, flip Scheduled to Published"
```

---

### Task 3: Migrate the legacy Published rows

**Files:**
- Create: `src/migrateScheduled.ts`
- Create: `tests/migrateScheduled.test.ts`
- Create: `scripts/migrate-scheduled.ts`
- Modify: `package.json` (the `test` script's file list)

**Interfaces:**
- Consumes: `PinSummary` (`pageId`, `name`, `source?`, `status?`, `scheduledDate?`), `PackInfo` + `readPacks("posted")` from `src/packs.ts` (`date`, `slug`, `text.pageId?`), `rowForPack(pack, rows)` from `src/rowForPack.ts`, `listAllPins()` + `updatePin()` from `src/notion.ts`, `localToday()` from Task 1.
- Produces: `migrationDecisions(rows, packs, today): MigrationDecision[]` from `src/migrateScheduled.ts`; the script `npx tsx scripts/migrate-scheduled.ts [--apply]`.

Background (spec §1, Migration): before milestone 1, `publish` set `Published` at pack time. Rows that are `Published` today but whose **earliest posted pack** is dated **today or later** have not gone live yet — they are really `Scheduled`. Rows whose earliest posted pack date is already past stay `Published`. Rows with no posted pack are left alone (backfill rows, or nothing to say).

- [ ] **Step 1: Write the failing tests**

`tests/migrateScheduled.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrationDecisions } from "../src/migrateScheduled.js";
import type { PackInfo } from "../src/packs.js";

const pack = (date: string, slug: string, template: string, pageId?: string): PackInfo => ({
  where: "posted",
  dir: `${date}--${slug}--${template}`,
  path: `exports/posted/${date}--${slug}--${template}`,
  date,
  slug,
  template,
  text: { date, image: `${template}.png`, title: "t", description: "", alt: "", board: "b", link: "l", ...(pageId ? { pageId } : {}) },
});
const row = (pageId: string, name: string, status: string, scheduledDate?: string) => ({ pageId, name, status, scheduledDate, source: "pipeline" as const });

test("Published row whose earliest posted pack is in the future → Scheduled, scheduledDate = earliest pack date", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  const packs = [pack("2026-09-20", "tea-bucket-list", "bold-panel", "p1"), pack("2026-09-18", "tea-bucket-list", "classic-checklist", "p1")];
  assert.deepEqual(migrationDecisions(rows, packs, "2026-09-16"), [
    { pageId: "p1", name: "Tea Bucket List", status: "Scheduled", scheduledDate: "2026-09-18" },
  ]);
});

test("earliest pack dated today counts as not yet live → Scheduled", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  assert.equal(migrationDecisions(rows, [pack("2026-09-16", "tea-bucket-list", "bold-panel", "p1")], "2026-09-16").length, 1);
});

test("Published row whose earliest posted pack is in the past stays Published", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  const packs = [pack("2026-09-01", "tea-bucket-list", "bold-panel", "p1"), pack("2026-09-25", "tea-bucket-list", "classic-checklist", "p1")];
  assert.deepEqual(migrationDecisions(rows, packs, "2026-09-16"), []);
});

test("rows with no posted pack are left alone; non-Published rows are ignored", () => {
  const rows = [row("p1", "No packs", "Published"), row("p2", "Already", "Scheduled"), row("p3", "Approved one", "Approved")];
  const packs = [pack("2026-09-30", "already", "bold-panel", "p2"), pack("2026-09-30", "approved-one", "bold-panel", "p3")];
  assert.deepEqual(migrationDecisions(rows, packs, "2026-09-16"), []);
});

test("an existing scheduledDate on the row is kept", () => {
  const rows = [row("p1", "Tea Bucket List", "Published", "2026-09-19")];
  const out = migrationDecisions(rows, [pack("2026-09-20", "tea-bucket-list", "bold-panel", "p1")], "2026-09-16");
  assert.equal(out[0].scheduledDate, "2026-09-19");
});

test("packs without a PAGE id match by slug (pre-milestone-1 packs)", () => {
  const rows = [row("p1", "Tea Bucket List", "Published")];
  const out = migrationDecisions(rows, [pack("2026-09-20", "tea-bucket-list", "bold-panel")], "2026-09-16");
  assert.deepEqual(out.map((d) => d.pageId), ["p1"]);
});
```

- [ ] **Step 2: Add the test file to `package.json` and run it to verify it fails**

Append ` tests/migrateScheduled.test.ts` to the `"test"` script's file list.

Run: `npx tsx --test tests/migrateScheduled.test.ts`
Expected: FAIL — `Cannot find module '../src/migrateScheduled.js'`.

- [ ] **Step 3: Write the pure module**

`src/migrateScheduled.ts`:

```ts
// src/migrateScheduled.ts — the one-off decision behind scripts/migrate-scheduled.ts.
// Before milestone 1, `publish` marked a row Published the moment its packs were
// written. A Published row whose earliest posted pack is still in the future has
// not gone live: it is really Scheduled. Pure; the script does the I/O.
import type { PackInfo } from "./packs.js";
import { rowForPack } from "./rowForPack.js";

export interface MigrationRow {
  pageId: string;
  name: string;
  status?: string;
  scheduledDate?: string;
  source?: string;
}

export interface MigrationDecision {
  pageId: string;
  name: string;
  status: "Scheduled";
  scheduledDate: string;
}

export function migrationDecisions(rows: MigrationRow[], postedPacks: PackInfo[], today: string): MigrationDecision[] {
  // Earliest posted pack date per row.
  const earliest = new Map<string, string>();
  for (const p of postedPacks) {
    const r = rowForPack(p, rows);
    if (!r) continue;
    const cur = earliest.get(r.pageId);
    if (!cur || p.date < cur) earliest.set(r.pageId, p.date);
  }
  const out: MigrationDecision[] = [];
  for (const r of rows) {
    if (r.status !== "Published") continue;
    const first = earliest.get(r.pageId);
    if (!first) continue; // no pack on disk — nothing to say
    if (first < today) continue; // already live — Published is right
    out.push({ pageId: r.pageId, name: r.name, status: "Scheduled", scheduledDate: r.scheduledDate ?? first });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/migrateScheduled.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Write the script**

`scripts/migrate-scheduled.ts`:

```ts
// One-off: rows marked Published by the pre-milestone-1 `publish` stage whose
// pins have not gone live yet become Scheduled. Dry run by default.
//
//   npx tsx scripts/migrate-scheduled.ts           # print what would change
//   npx tsx scripts/migrate-scheduled.ts --apply   # write it to Notion
import "dotenv/config";
import { listAllPins, updatePin, ensureStatusOptions } from "../src/notion.js";
import { readPacks } from "../src/packs.js";
import { migrationDecisions } from "../src/migrateScheduled.js";
import { localToday } from "../src/publishedFlip.js";

const apply = process.argv.includes("--apply");
const today = localToday();

const [rows, posted] = await Promise.all([listAllPins(), readPacks("posted")]);
const decisions = migrationDecisions(rows, posted, today);

console.log(`${rows.filter((r) => r.status === "Published").length} Published rows, ${posted.length} posted packs, today ${today}`);
if (!decisions.length) {
  console.log("Nothing to migrate — every Published row is already live.");
  process.exit(0);
}
for (const d of decisions) console.log(`${apply ? "✓" : "→"} ${d.name.slice(0, 60)}  Published → Scheduled  (first pin ${d.scheduledDate})`);

if (!apply) {
  console.log(`\n${decisions.length} row(s) would change. Re-run with --apply to write them.`);
  process.exit(0);
}
await ensureStatusOptions(); // "Scheduled" must exist on the live select
for (const d of decisions) await updatePin(d.pageId, { status: d.status, scheduledDate: d.scheduledDate });
console.log(`\n${decisions.length} row(s) migrated.`);
```

- [ ] **Step 6: Typecheck, full suite, then the dry run against the real data**

Run: `npx tsc --noEmit && npm test`
Expected: clean; all tests pass (200 + 6 = 206).

Run: `npx tsx scripts/migrate-scheduled.ts`
Expected: a list of `→ <name>  Published → Scheduled  (first pin <date>)` lines for the rows posted in the September sessions whose first pin date is today or later, and a closing "N row(s) would change" line. Paste that output into your report — the controller decides whether to run `--apply` (it writes Notion). Do **not** pass `--apply` yourself.

- [ ] **Step 7: Commit**

```bash
git add src/migrateScheduled.ts tests/migrateScheduled.test.ts scripts/migrate-scheduled.ts package.json
git commit -m "migrate-scheduled: legacy Published rows with future pins become Scheduled (dry run by default)"
```

---

### Task 4: Docs

**Files:**
- Modify: `CLAUDE.md` (this repo)
- Modify: `../CLARITY_PLAN.md` and `../CLARITY_PLAN.html` (outside the repo — no commit)

- [ ] **Step 1: `CLAUDE.md`**

Commands block: change the `npm run generate` line's comment to
`# the nightly job (02:00): revise → top up the queue when short → flip Scheduled → Published. Never posts.`
and add, right after it:
```
npx tsx scripts/migrate-scheduled.ts [--apply]   # one-off: pre-M1 rows marked Published early → Scheduled (done 2026-09-16)
```
Update the `npm test` comment's list to end with `+ review-handler + publishedFlip + migrateScheduled`.

Architecture:
- In the **`Scheduled` vs `Published`** bullet, replace `(flipped by the nightly job — milestone 3)` with `(flipped by the nightly job on the first local day after the scheduled date — `src/publishedFlip.ts`)`.
- Replace the whole `scripts/scheduled-run.ts` bullet (the one starting "`scripts/scheduled-run.ts` — the unattended job") with:

```
- `scripts/scheduled-run.ts` — the nightly job (`npm run generate`), **daily at 02:00**: (1) `revise` — "Needs changes" rows get the phone note applied and return to In Review; (2) generate only when queue health says the calendar is short (ideas → draft → design → review), so a healthy queue costs no Claude call; (3) `src/stages/publishedFlip.ts` flips `Scheduled` rows dated **before** today (local, `POST_TZ`) to `Published` and fills `Published date` — date-based, no Pinterest call. Each step is isolated: a revise failure is logged and the flip still runs; the exit code is 1 if any step failed. **It never posts and never approves.** Everything is teed to `logs/scheduled-run-<date>.log`. Install with `powershell -ExecutionPolicy Bypass -File scripts/register-task.ps1` (current user; `-Unregister` removes it). Wakes the machine to run: this laptop is Modern Standby (S0) with wake timers **on for AC, off for battery**, so a plugged-in run fires at 02:00 and a battery run defers to the next logon via `StartWhenAvailable`.
```

- [ ] **Step 2: Plan status**

Append to the Status section of `../CLARITY_PLAN.md`, directly after the "Milestone 2 — hands-off pipeline, step 2" paragraph, and mirror it in `../CLARITY_PLAN.html` on the same `<div class="note">` line using the same `<br><br><strong>…</strong>` / `<code>` conventions as the step-2 paragraph:

```
**Milestone 3 — hands-off pipeline, step 3 (2026-09-16): the nightly job.** `npm run generate` now runs every day at 02:00: it applies phone notes (`revise` → back to In Review), tops the queue up only when the calendar is short, and flips `Scheduled → Published` the morning after a list's first pin goes live — so Notion's status is finally true without anyone touching it. Legacy rows marked Published early were migrated to Scheduled. **The hands-off pipeline is complete:** the only human touchpoints are the phone review page, `/clarity-status` and `/clarity-post`. **Next:** affiliates (section 3) once traffic is measurable, and the Pinterest API stage when Standard access arrives.
```

Also in `../CLARITY_PLAN.md`'s "1 · Pinterest Pipeline" section, update the status line
`` `Idea` → `Drafted` → `Designed` → `In Review` → **`Approved`** → `Published` (or `Rejected`) ``
to
`` `Idea` → `Drafted` → `Designed` → `In Review` ⇄ `Needs changes` → **`Approved`** → `Scheduled` → `Published` (or `Rejected`) ``
and the matching line in the `.html` twin.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the nightly job and the Published flip"
```

---

## Self-review

**Spec coverage.** §5 trigger daily 02:00 → Task 2 Step 3; §5 order revise → generate-if-needed → flip → Task 2 Step 1; §5 "still exits in seconds when nothing is needed" → generate step returns without a Claude call when `needed` is 0, revise returns immediately with no rows, flip is one Notion query; §5 "never posts, never approves" → nothing in the job touches packs or Approved rows; §5 pure `publishedFlip` + §8 date-boundary test → Task 1; §1 Migration paragraph (`scripts/migrate-scheduled.ts`, uses pack dates, past-dated rows stay Published) → Task 3; §10 CLAUDE.md + CLARITY_PLAN → Task 4. §10's memory / `/clarity-status` items were done in M1/M2 and need nothing new here.

**Deviation recorded:** the flip uses `scheduledDate < today` in the posting zone rather than the spec's `≤ today` (Global Constraints, ruling with reasoning: at 02:00 the day's pins do not exist yet). The migration mirrors it: earliest pack `< today` stays Published, `>= today` becomes Scheduled.

**Placeholder scan:** none — every step carries the code or the exact command; the only judgement left to a human is `--apply` on the migration and registering the Windows task, both explicitly reserved for the controller.

**Type consistency:** `publishedFlip(rows, today): FlipDecision[]` and `localToday(now?, tz?)` (Task 1) are imported by Tasks 2 and 3 under those names; `runPublishedFlip(today?)` (Task 1) is called in Task 2; `migrationDecisions(rows, packs, today)` (Task 3) matches its test and script; `PackInfo.text.pageId` is the field `rowForPack` reads (`pack.text.pageId`); `updatePin` patches use the `PinRow` field names `status`, `publishedDate`, `scheduledDate`.
