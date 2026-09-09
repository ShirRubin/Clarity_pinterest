# Hands-off pipeline — Milestone 2: the phone review page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host the review queue at `review.clarity-lists.com` behind Cloudflare Access so the user can approve / send back / reject lists from their phone, with every tap written straight to Notion.

**Architecture:** A Cloudflare Worker in `review-worker/` (same account as the blog Worker `clarity-blog`) talks to Notion with plain `fetch`, renders the same page the local `clarity approve` renders (`src/approve/page.ts`, given a mobile pass), and shares one decision module (`src/approve/decide.ts`) with the CLI stage so the two can never drift. Every request must carry a valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`), verified in the Worker against the team's JWKS — Access in front, the Worker refusing anything without a token behind. Pure logic (Notion page → pin, decision → Notion patch, JWT verification, routing with injected dependencies) is unit-tested from the existing `node:test` suite; only `index.ts` touches the real network.

**Tech Stack:** Node 22 / TypeScript ESM (existing `tsx --test` suite), Cloudflare Workers via `wrangler` ^4.129 (already a devDependency of the blog), Web Crypto (`crypto.subtle`, available in both Workers and Node 22), Notion REST API `2022-06-28`. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-hands-off-pipeline-design.md` — section 3 (the review Worker) and section 8's Worker tests. Milestone 1 (sections 1, 4, 6) is merged at `81c5c96`; milestone 3 (section 5) follows.

## Global Constraints

- Working directory for CLI commands is `Clarity_pinterest/`; the Worker lives in `Clarity_pinterest/review-worker/` and is deployed with `npx wrangler deploy` **from that directory**.
- The Worker uses plain `fetch` against `https://api.notion.com/v1` with header `Notion-Version: 2022-06-28` — **no `@notionhq/client`** in the Worker bundle.
- Secrets `NOTION_TOKEN` and `NOTION_DB_ID` via `wrangler secret put`; vars `ACCESS_TEAM_DOMAIN` (e.g. `clarity`, the part before `.cloudflareaccess.com`) and `ACCESS_AUD` (the Access application's AUD tag) in `wrangler.jsonc`.
- Every route — including `/img/…` — returns **403** without a valid `Cf-Access-Jwt-Assertion` (RS256, `kid` found in `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, `aud` contains `ACCESS_AUD`, `iss` = `https://<team>.cloudflareaccess.com`, `exp` in the future).
- `POST /decide` writes Notion **before** responding 200; a note is **required** for `revise`; notes are appended with ` | ` (`appendNote`), tagged `revise <date>:` / `review <date>:` exactly as the CLI stage does today.
- Image URLs are never embedded: the page requests `/img/<pageId>/<i>` and the Worker re-signs per request (Notion file URLs expire after an hour). This keeps the spec's `/image?page=&i=` intent but reuses the renderer's existing path — recorded as a deliberate deviation.
- The local `clarity approve` keeps working unchanged in behaviour (same renderer, same decision module).
- `npm test` runs `tsx --test` over an explicit file list in `package.json` — **every new test file must be appended to that list**. Typecheck: `npx tsc --noEmit` (add `review-worker/src/**/*.ts` to `tsconfig.json`'s `include`).
- Pure modules never import `notion.ts`, `dotenv`, or the filesystem.
- Commit messages: imperative subject; end with the session's `Co-Authored-By` / `Claude-Session` trailers.

---

## File structure

| File | Responsibility | Status |
|---|---|---|
| `src/notionPage.ts` | `NotionPage` type + pure `pageToSummary(page)` (moved out of `notion.ts` so the Worker can map pages without the SDK) | create (extract) |
| `src/notion.ts` | imports the above; no behaviour change | modify |
| `src/approve/decide.ts` | `Decision`, `STATUS_FOR`, `MARKER_FOR`, `appendNote`, `decisionPatch()` — one definition for CLI + Worker | create (extract) |
| `src/stages/approve.ts` | uses `decide.ts` | modify |
| `src/approve/server.ts` | imports `Decision` from `decide.ts` (re-exports it) | modify |
| `src/approve/page.ts` | mobile pass: snap-scroll variant strip, full-width buttons, note box revealed on "Needs changes", receipt collapse + scroll to next, "N of M" header; `emptyQueuePage()` | modify |
| `review-worker/package.json`, `review-worker/wrangler.jsonc` | Worker package + deploy config (name `clarity-review`, custom domain, vars) | create |
| `review-worker/src/env.ts` | `Env` interface | create |
| `review-worker/src/notion-fetch.ts` | `queryInReview`, `updatePage`, `pageImageUrls` — raw REST with injected `fetch` | create |
| `review-worker/src/access.ts` | `verifyAccessJwt(token, opts)` — JWKS fetch + RS256 verify + claims | create |
| `review-worker/src/handler.ts` | `handleRequest(req, deps)` — routes, with `deps` injected | create |
| `review-worker/src/index.ts` | `export default { fetch }` — Access check, real deps from `env` | create |
| `tests/notionPage.test.ts`, `tests/decide.test.ts`, `tests/review-access.test.ts`, `tests/review-handler.test.ts` | new suites | create |
| `tests/approve.test.ts` | mobile-pass assertions | modify |
| `tsconfig.json`, `package.json` | include + test list + `review:deploy` script | modify |
| `CLAUDE.md`, `../CLARITY_PLAN.md` (+ `.html`), `~/.claude/skills/clarity-status/SKILL.md` | docs | modify |

---

### Task 1: Extract the pure Notion page → summary mapper

The Worker must turn Notion's raw page JSON into the same `PinSummary` the CLI uses, without the SDK. Today that mapper (`pageToSummary`) is private inside `notion.ts`, which imports `@notionhq/client` and `dotenv` at module load — unbundleable for a Worker. Move it.

**Files:**
- Create: `src/notionPage.ts`
- Modify: `src/notion.ts` (delete the local copies, import instead)
- Create: `tests/notionPage.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Produces:
  ```ts
  export type NotionPage = { id: string; properties: Record<string, NotionProp> };  // NotionProp = the union already in notion.ts
  export interface PinSummary { … }  // moved verbatim from notion.ts
  export function pageToSummary(page: NotionPage): PinSummary;
  export function imageUrlsOf(page: NotionPage): string[];   // the "Pin image" files, file.url ?? external.url
  ```
  `notion.ts` re-exports `PinSummary` and `NotionPage` so every existing `import { … } from "../notion.js"` keeps compiling.

- [ ] **Step 1: Write the failing test**

```ts
// tests/notionPage.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageToSummary, imageUrlsOf, type NotionPage } from "../src/notionPage.js";

const rt = (s: string) => [{ plain_text: s }];
const page: NotionPage = {
  id: "3d337600-24be-8127-8084-ffaa92f54ecd",
  properties: {
    Name: { title: rt("The Tea Bucket List: 12 Brews") },
    Status: { select: { name: "In Review" } },
    Board: { select: { name: "Books · Learning & Culture" } },
    Theme: { select: { name: "Books & Learning" } },
    Source: { select: { name: "pipeline" } },
    "Pin title": { rich_text: rt("Tea Bucket List: 12 Brews") },
    "Pin description": { rich_text: [{ plain_text: "Part one. " }, { plain_text: "Part two." }] },
    "Alt text": { rich_text: rt("Checklist graphic") },
    "List items": { rich_text: rt("1. **Matcha** — whisk it") },
    Notes: { rich_text: rt("review 2026-09-01: ok") },
    "Pin URL": { url: null },
    "Scheduled date": { date: { start: "2026-09-12" } },
    Impressions: { number: 0 },
    "Pin image": { files: [{ file: { url: "https://s3/a.png?sig=1" } }, { external: { url: "https://x/b.png" } }] },
  },
};

test("maps every field the pipeline reads, joining rich-text chunks", () => {
  const s = pageToSummary(page);
  assert.equal(s.pageId, page.id);
  assert.equal(s.name, "The Tea Bucket List: 12 Brews");
  assert.equal(s.status, "In Review");
  assert.equal(s.board, "Books · Learning & Culture");
  assert.equal(s.pinTitle, "Tea Bucket List: 12 Brews");
  assert.equal(s.pinDescription, "Part one. Part two.");
  assert.equal(s.altText, "Checklist graphic");
  assert.equal(s.listItems, "1. **Matcha** — whisk it");
  assert.equal(s.notes, "review 2026-09-01: ok");
  assert.equal(s.pinUrl, undefined);
  assert.equal(s.scheduledDate, "2026-09-12");
  assert.equal(s.impressions, 0); // 0 is meaningful, must not become undefined
  assert.deepEqual(s.imageUrls, ["https://s3/a.png?sig=1", "https://x/b.png"]);
});

test("missing properties map to undefined / empty, never throw", () => {
  const s = pageToSummary({ id: "x", properties: { Name: { title: rt("n") } } });
  assert.equal(s.name, "n");
  assert.equal(s.board, undefined);
  assert.equal(s.pinTitle, "");
  assert.deepEqual(s.imageUrls, []);
});

test("imageUrlsOf prefers Notion-hosted file URLs and skips empty entries", () => {
  assert.deepEqual(imageUrlsOf(page), ["https://s3/a.png?sig=1", "https://x/b.png"]);
  assert.deepEqual(imageUrlsOf({ id: "y", properties: { "Pin image": { files: [{}] } } }), []);
});
```

- [ ] **Step 2: Add to the test list and run to see it fail**

Append ` tests/notionPage.test.ts` to the `"test"` script in `package.json`.

Run: `npx tsx --test tests/notionPage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/notionPage.ts`**

Move, verbatim, from `src/notion.ts`: the `NotionPage` type (currently `type NotionPage = { id; properties: Record<string, {…}> }`), the `PinSummary` interface, and `pageToSummary`. Add `imageUrlsOf` and use it inside `pageToSummary`:

```ts
// src/notionPage.ts — the pure half of the Notion layer: raw page JSON → PinSummary.
// No SDK, no env, no I/O, so the review Worker can use it with plain fetch.

type NotionProp = {
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  select?: { name: string } | null;
  number?: number | null;
  url?: string | null;
  date?: { start: string } | null;
  files?: { file?: { url: string }; external?: { url: string } }[];
};

export type NotionPage = { id: string; properties: Record<string, NotionProp> };

export interface PinSummary {
  // …moved verbatim from notion.ts (pageId … imageUrls)…
}

const text = (prop?: NotionProp) => (prop?.title ?? prop?.rich_text ?? []).map((t) => t.plain_text).join("");

export function imageUrlsOf(page: NotionPage): string[] {
  return (page.properties["Pin image"]?.files ?? [])
    .map((f) => f.file?.url ?? f.external?.url)
    .filter((u): u is string => !!u);
}

export function pageToSummary(page: NotionPage): PinSummary {
  const p = page.properties;
  return {
    pageId: page.id,
    name: text(p["Name"]),
    // …every other field exactly as today…
    imageUrls: imageUrlsOf(page),
  };
}
```

In `src/notion.ts`: delete the moved definitions, add
`import { pageToSummary, imageUrlsOf, type NotionPage, type PinSummary } from "./notionPage.js";`
and `export type { PinSummary, NotionPage } from "./notionPage.js";`. `pinImageUrls()` becomes `return imageUrlsOf(page)` after the `retrieve`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS (every existing importer of `PinSummary` from `notion.js` still compiles via the re-export).

- [ ] **Step 5: Commit**

```bash
git add src/notionPage.ts src/notion.ts tests/notionPage.test.ts package.json
git commit -m "notionPage: extract the pure page → PinSummary mapper for the review Worker"
```

---

### Task 2: One decision module for the CLI and the Worker

**Files:**
- Create: `src/approve/decide.ts`
- Modify: `src/stages/approve.ts`, `src/approve/server.ts`
- Create: `tests/decide.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Produces:
  ```ts
  export type Decision = "approve" | "reject" | "revise";
  export const DECISIONS: readonly Decision[];
  export const STATUS_FOR: Record<Decision, Status>;           // approve→Approved, reject→Rejected, revise→Needs changes
  export const MARKER_FOR: Record<Decision, "review" | "revise">;
  export function appendNote(existing: string | undefined, entry: string): string;   // moved from stages/approve.ts
  export function isDecision(x: unknown): x is Decision;
  export interface DecisionPatch { status: Status; notes?: string }
  /** What to write to Notion for one verdict. `today` is YYYY-MM-DD. A revise without a note is a caller bug — throws. */
  export function decisionPatch(decision: Decision, note: string | undefined, existingNotes: string | undefined, today: string): DecisionPatch;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/decide.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionPatch, appendNote, isDecision, STATUS_FOR } from "../src/approve/decide.js";

test("approve without a note only flips the status", () => {
  assert.deepEqual(decisionPatch("approve", undefined, "old", "2026-09-09"), { status: "Approved" });
});

test("approve with a note appends a review-tagged entry", () => {
  assert.deepEqual(decisionPatch("approve", "love it", "old", "2026-09-09"), {
    status: "Approved",
    notes: "old | review 2026-09-09: love it",
  });
});

test("revise appends a revise-tagged entry that clarity revise will read", () => {
  assert.deepEqual(decisionPatch("revise", "items 3 and 7 are vague", undefined, "2026-09-09"), {
    status: "Needs changes",
    notes: "revise 2026-09-09: items 3 and 7 are vague",
  });
});

test("revise without a note is refused", () => {
  assert.throws(() => decisionPatch("revise", "  ", "x", "2026-09-09"), /note/);
});

test("reject maps to Rejected", () => {
  assert.equal(decisionPatch("reject", undefined, undefined, "2026-09-09").status, "Rejected");
  assert.equal(STATUS_FOR.reject, "Rejected");
});

test("appendNote joins with a pipe and treats blank existing notes as empty", () => {
  assert.equal(appendNote(undefined, "a"), "a");
  assert.equal(appendNote("  ", "a"), "a");
  assert.equal(appendNote("a", "b"), "a | b");
});

test("isDecision accepts only the three verdicts", () => {
  assert.ok(isDecision("approve") && isDecision("reject") && isDecision("revise"));
  assert.ok(!isDecision("publish") && !isDecision(undefined));
});
```

- [ ] **Step 2: Add to the test list, run, see it fail**

Append ` tests/decide.test.ts`. Run: `npx tsx --test tests/decide.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/approve/decide.ts — the one definition of what a review verdict does to a
// Notion row. Shared by the local review page (stages/approve.ts) and the
// hosted one (review-worker), so the two can never drift.
import type { Status } from "../schema.js";

export type Decision = "approve" | "reject" | "revise";
export const DECISIONS: readonly Decision[] = ["approve", "reject", "revise"];
export const isDecision = (x: unknown): x is Decision => DECISIONS.includes(x as Decision);

export const STATUS_FOR: Record<Decision, Status> = {
  approve: "Approved",
  reject: "Rejected",
  revise: "Needs changes",
};

// `revise` is the marker `clarity revise` looks for; the others are history only.
export const MARKER_FOR: Record<Decision, "review" | "revise"> = {
  approve: "review",
  reject: "review",
  revise: "revise",
};

/** Notes are appended, never overwritten — the row keeps its history. */
export const appendNote = (existing: string | undefined, entry: string): string =>
  existing?.trim() ? `${existing.trim()} | ${entry}` : entry;

export interface DecisionPatch {
  status: Status;
  notes?: string;
}

export function decisionPatch(
  decision: Decision,
  note: string | undefined,
  existingNotes: string | undefined,
  today: string,
): DecisionPatch {
  const clean = note?.trim();
  if (decision === "revise" && !clean) {
    throw new Error("needs-changes requires a note saying what to change");
  }
  const patch: DecisionPatch = { status: STATUS_FOR[decision] };
  if (clean) patch.notes = appendNote(existingNotes, `${MARKER_FOR[decision]} ${today}: ${clean}`);
  return patch;
}
```

`src/stages/approve.ts`: delete its local `STATUS_FOR`, `MARKER_FOR`, `appendNote`; import `{ decisionPatch, appendNote }` from `../approve/decide.js` (keep exporting `appendNote` from the stage for the two callers that import it — `stages/posted.ts` and any other — or update those imports to `../approve/decide.js`; do the latter and grep for `appendNote` to be sure). The `onDecision` callback becomes:

```ts
    async (pageId, decision, note) => {
      await updatePin(pageId, decisionPatch(decision, note, notesByPage.get(pageId), today));
      if (decision === "revise") needsRevision++;
    },
```

`src/approve/server.ts`: replace its local `Decision`/`DECISIONS` with `import { type Decision, isDecision } from "./decide.js"; export type { Decision };` and use `isDecision(decision)` in the validation.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit` → PASS (approve.test.ts, revise.test.ts unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add src/approve/decide.ts src/stages/approve.ts src/approve/server.ts src/stages/posted.ts tests/decide.test.ts package.json
git commit -m "decide: one decision→Notion-patch module shared by the CLI page and the Worker"
```

---

### Task 3: Mobile pass on the review page

The renderer stays one file and one HTML string; the page becomes responsive rather than forked. Desktop keeps its side-by-side variants above ~700 px.

**Files:**
- Modify: `src/approve/page.ts`
- Modify: `tests/approve.test.ts`

**Interfaces:**
- Produces: `renderApprovePage(pins: ApprovePin[]): string` (unchanged signature); `export function emptyQueuePage(): string` — the "nothing to review" page.

- [ ] **Step 1: Write the failing tests** (append to `tests/approve.test.ts`)

```ts
import { renderApprovePage, emptyQueuePage } from "../src/approve/page.js";

test("the page is phone-first: viewport meta, snap-scrolling variant strip, stacked full-width actions", () => {
  const html = renderApprovePage([pin("p1")]);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /scroll-snap-type:\s*x mandatory/);
  assert.match(html, /@media \(max-width: 700px\)/);
  assert.match(html, /\.actions button \{[^}]*width:\s*100%/);
});

test("the note box is hidden until Needs changes is tapped, and the header counts N of M", () => {
  const html = renderApprovePage([pin("p1"), pin("p2")]);
  assert.match(html, /textarea\.note \{[^}]*display:\s*none/);
  assert.match(html, /revealNote\(/);
  assert.match(html, /" of " \+ pins\.length/);
});

test("a decided card collapses to a receipt and the next card scrolls into view", () => {
  const html = renderApprovePage([pin("p1")]);
  assert.match(html, /classList\.add\("decided"\)/);
  assert.match(html, /scrollIntoView\(/);
});

test("emptyQueuePage says there is nothing to review", () => {
  assert.match(emptyQueuePage(), /Nothing to review/);
});
```

- [ ] **Step 2: Run, see them fail**

Run: `npx tsx --test tests/approve.test.ts` → FAIL (no viewport meta, no `emptyQueuePage`).

- [ ] **Step 3: Implement**

In `renderApprovePage`'s `<head>`, add `<meta name="viewport" content="width=device-width, initial-scale=1">` right after the charset meta. Add to the `<style>` block (after the existing rules):

```css
  .imgs { display:flex; gap:1rem; margin-bottom:1rem; overflow-x:auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling:touch; }
  .imgs img { flex:0 0 50%; scroll-snap-align:start; border-radius:10px; background:#eee; }
  textarea.note { display:none; }
  textarea.note.open { display:block; }
  .card.decided { opacity:1; }
  .card.decided > *:not(.receipt) { display:none; }
  .receipt { font-weight:700; padding:.4rem 0; }
  @media (max-width: 700px) {
    body { padding:1rem .6rem 5rem; }
    header { margin-bottom:1rem; }
    .card { border-radius:12px; padding:.9rem; margin-bottom:1.2rem; }
    .imgs img { flex:0 0 88%; }
    .actions { flex-direction:column; align-items:stretch; gap:.6rem; }
    .actions button { width:100%; padding:.9rem 1rem; font-size:1.05rem; }
    h2 { font-size:1.05rem; }
  }
```

(Remove the older `.imgs` / `.imgs img` / `.card.decided` rules they replace.)

In the script: the header shows `"N of M"`:

```js
function updateProgress() {
  progress.textContent = decided + " of " + pins.length;
  // …rest unchanged…
}
```

Buttons: the "Needs changes" button first reveals the note, and only submits once a note is present:

```js
  el.querySelector(".revise").onclick = () => {
    const note = el.querySelector(".note");
    if (!note.classList.contains("open")) { revealNote(el); return; }
    decide(el, pin, "revise");
  };
function revealNote(el) {
  const note = el.querySelector(".note");
  note.classList.add("open");
  el.querySelector(".revise").textContent = "↻ Send back with this note";
  note.focus();
}
```

After a successful decision, replace the actions/notes with a receipt and scroll the next card into view:

```js
    el.classList.add("decided");
    const receipt = document.createElement("div");
    receipt.className = "receipt";
    receipt.textContent = VERDICT[decision] + " — " + (pin.pinTitle || pin.name);
    el.appendChild(receipt);
    // …counters unchanged…
    const next = el.nextElementSibling;
    if (next && next.classList && next.classList.contains("card")) {
      next.scrollIntoView({ behavior: "smooth", block: "start" });
      next.focus({ preventScroll: true });
    }
```

Keyboard shortcut `M` should also just reveal the note when it is closed (call the same click handler). And add the exported empty page:

```ts
export function emptyQueuePage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clarity — review queue</title><style>body{font-family:"Segoe UI",system-ui,sans-serif;background:#faf7f2;color:#3a3340;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:2rem}h1{font-size:1.3rem}</style></head>
<body><div><h1>Nothing to review</h1><p>The generator will top the queue up overnight. Come back tomorrow.</p></div></body></html>`;
}
```

- [ ] **Step 4: Run tests + typecheck, then eyeball it**

Run: `npm test && npx tsc --noEmit` → PASS.
Then `npm run clarity -- approve` with at least one row In Review, open `http://127.0.0.1:4178/` in a narrow browser window (device toolbar, iPhone width): the variants swipe, the three buttons stack full-width, "Needs changes" opens the note, a decision collapses to a one-line receipt and the next card scrolls up. Ctrl+C the server (decisions you made are real — pick a row you actually want to decide, or open the page and quit without deciding).

- [ ] **Step 5: Commit**

```bash
git add src/approve/page.ts tests/approve.test.ts
git commit -m "review page: phone-first layout, note revealed on demand, receipts, N of M"
```

---

### Task 4: Worker scaffold + Notion over plain fetch

**Files:**
- Create: `review-worker/package.json`, `review-worker/wrangler.jsonc`, `review-worker/.gitignore`
- Create: `review-worker/src/env.ts`, `review-worker/src/notion-fetch.ts`
- Modify: `tsconfig.json` (include), `package.json` (test list + script)
- Create: `tests/review-notion.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // review-worker/src/env.ts
  export interface Env { NOTION_TOKEN: string; NOTION_DB_ID: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string }
  // review-worker/src/notion-fetch.ts
  export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
  export function notionApi(token: string, fetchFn?: FetchLike): {
    queryInReview(dbId: string): Promise<PinSummary[]>;          // status = "In Review", page_size 100
    updatePage(pageId: string, patch: DecisionPatch): Promise<void>;
    pageImageUrls(pageId: string): Promise<string[]>;
  };
  ```

- [ ] **Step 1: Scaffold the package**

`review-worker/package.json`:

```json
{
  "name": "clarity-review",
  "private": true,
  "type": "module",
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev",
    "tail": "wrangler tail"
  },
  "devDependencies": {
    "wrangler": "^4.129.0"
  }
}
```

`review-worker/wrangler.jsonc`:

```jsonc
{
  // The phone review page. Deploy from this directory: `npx wrangler deploy`.
  // Secrets (never here): NOTION_TOKEN, NOTION_DB_ID — `npx wrangler secret put <NAME>`.
  "name": "clarity-review",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-02",
  "routes": [{ "pattern": "review.clarity-lists.com", "custom_domain": true }],
  "vars": {
    // Filled in Task 7 from the Zero Trust dashboard.
    "ACCESS_TEAM_DOMAIN": "REPLACE-ME",
    "ACCESS_AUD": "REPLACE-ME"
  },
  "observability": { "enabled": true }
}
```

`review-worker/.gitignore`: `node_modules/` and `.wrangler/`.

Run `cd review-worker && npm install` (creates its own lockfile — commit it).

`tsconfig.json` (repo root): `"include": ["src/**/*.ts", "scripts/**/*.ts", "review-worker/src/**/*.ts"]`. Root `package.json` scripts: add `"review:deploy": "cd review-worker && npx wrangler deploy"`.

`review-worker/src/env.ts`:

```ts
export interface Env {
  NOTION_TOKEN: string;
  NOTION_DB_ID: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/review-notion.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { notionApi } from "../review-worker/src/notion-fetch.js";

const rt = (s: string) => [{ plain_text: s }];
const page = (id: string) => ({ id, properties: { Name: { title: rt(`List ${id}`) }, Status: { select: { name: "In Review" } }, "Pin image": { files: [{ file: { url: `https://s3/${id}.png` } }] } } });

function fakeFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = handler(url, init);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fn, calls };
}

test("queryInReview posts the status filter with auth + version headers and maps pages", async () => {
  const { fn, calls } = fakeFetch(() => ({ results: [page("a"), page("b")], has_more: false }));
  const api = notionApi("secret", fn);
  const rows = await api.queryInReview("db1");
  assert.equal(calls[0].url, "https://api.notion.com/v1/databases/db1/query");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["Authorization"], "Bearer secret");
  assert.equal(headers["Notion-Version"], "2022-06-28");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)).filter, { property: "Status", select: { equals: "In Review" } });
  assert.deepEqual(rows.map((r) => r.name), ["List a", "List b"]);
  assert.deepEqual(rows[0].imageUrls, ["https://s3/a.png"]);
});

test("updatePage PATCHes Status and, when present, Notes", async () => {
  const { fn, calls } = fakeFetch(() => ({}));
  await notionApi("t", fn).updatePage("p1", { status: "Needs changes", notes: "revise 2026-09-09: fix 3" });
  assert.equal(calls[0].url, "https://api.notion.com/v1/pages/p1");
  assert.equal(calls[0].init?.method, "PATCH");
  const props = JSON.parse(String(calls[0].init?.body)).properties;
  assert.deepEqual(props.Status, { select: { name: "Needs changes" } });
  assert.deepEqual(props.Notes, { rich_text: [{ type: "text", text: { content: "revise 2026-09-09: fix 3" } }] });
  await notionApi("t", fn).updatePage("p2", { status: "Approved" });
  assert.equal(JSON.parse(String(calls[1].init?.body)).properties.Notes, undefined);
});

test("pageImageUrls retrieves the page and returns freshly signed URLs", async () => {
  const { fn, calls } = fakeFetch(() => page("z"));
  const urls = await notionApi("t", fn).pageImageUrls("z");
  assert.equal(calls[0].url, "https://api.notion.com/v1/pages/z");
  assert.deepEqual(urls, ["https://s3/z.png"]);
});

test("a non-2xx Notion response throws with the status and message", async () => {
  const fn = async () => new Response(JSON.stringify({ message: "invalid token" }), { status: 401 });
  await assert.rejects(notionApi("bad", fn).queryInReview("db"), /401.*invalid token/);
});
```

- [ ] **Step 3: Add to the test list, run, see it fail**

Append ` tests/review-notion.test.ts`. Run: `npx tsx --test tests/review-notion.test.ts` → FAIL.

- [ ] **Step 4: Implement**

```ts
// review-worker/src/notion-fetch.ts — the three Notion calls the review page
// needs, over plain fetch (no SDK in the Worker). Pure mapping lives in
// ../../src/notionPage.ts; `fetchFn` is injected so tests never hit the network.
import { pageToSummary, imageUrlsOf, type NotionPage, type PinSummary } from "../../src/notionPage.js";
import type { DecisionPatch } from "../../src/approve/decide.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// Notion caps a rich-text item at 2000 chars — chunk, don't truncate (mirrors notion.ts).
const rt = (content: string) => {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < content.length && chunks.length < 10; i += 2000) {
    chunks.push({ type: "text", text: { content: content.slice(i, i + 2000) } });
  }
  return chunks.length ? chunks : [{ type: "text" as const, text: { content: "" } }];
};

export function notionApi(token: string, fetchFn: FetchLike = fetch) {
  const call = async <T>(path: string, init: { method: "GET" | "POST" | "PATCH"; body?: unknown }): Promise<T> => {
    const res = await fetchFn(`${BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) {
      let msg = "";
      try {
        msg = ((await res.json()) as { message?: string }).message ?? "";
      } catch {
        /* no JSON body */
      }
      throw new Error(`Notion ${res.status}${msg ? `: ${msg}` : ""}`);
    }
    return (await res.json()) as T;
  };

  return {
    async queryInReview(dbId: string): Promise<PinSummary[]> {
      const out = await call<{ results: NotionPage[] }>(`/databases/${dbId}/query`, {
        method: "POST",
        body: { filter: { property: "Status", select: { equals: "In Review" } }, page_size: 100 },
      });
      return out.results.map(pageToSummary);
    },
    async updatePage(pageId: string, patch: DecisionPatch): Promise<void> {
      const properties: Record<string, unknown> = { Status: { select: { name: patch.status } } };
      if (patch.notes !== undefined) properties["Notes"] = { rich_text: rt(patch.notes) };
      await call(`/pages/${pageId}`, { method: "PATCH", body: { properties } });
    },
    async pageImageUrls(pageId: string): Promise<string[]> {
      return imageUrlsOf(await call<NotionPage>(`/pages/${pageId}`, { method: "GET" }));
    },
  };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit` → PASS (Node 22 provides `fetch`/`Response`/`RequestInit` globals and `@types/node` 22 declares them).

- [ ] **Step 6: Commit**

```bash
git add review-worker/package.json review-worker/package-lock.json review-worker/wrangler.jsonc review-worker/.gitignore review-worker/src/env.ts review-worker/src/notion-fetch.ts tests/review-notion.test.ts tsconfig.json package.json
git commit -m "review-worker: scaffold + Notion over plain fetch"
```

---

### Task 5: Verify the Cloudflare Access JWT

Access puts an RS256 JWT in `Cf-Access-Jwt-Assertion`. The Worker verifies it itself so a direct `workers.dev` hit or a mis-routed DNS record can never reach the queue.

**Files:**
- Create: `review-worker/src/access.ts`
- Create: `tests/review-access.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Produces:
  ```ts
  export interface AccessOpts { teamDomain: string; aud: string; fetchFn?: FetchLike; now?: () => number /* unix seconds */ }
  export interface AccessIdentity { email?: string; sub: string }
  /** Resolves to the identity on success; throws Error("access: <reason>") on any failure. */
  export function verifyAccessJwt(token: string | null, opts: AccessOpts): Promise<AccessIdentity>;
  export function certsUrl(teamDomain: string): string;   // https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
  ```
  JWKS are cached per `teamDomain` for 10 minutes in a module map (a Worker isolate lives across requests).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/review-access.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { verifyAccessJwt, certsUrl } from "../review-worker/src/access.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const TEAM = "clarity";
const AUD = "aud-tag-123";
const NOW = 1_800_000_000;

function jwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }) {
  const h = b64u(JSON.stringify(header));
  const p = b64u(JSON.stringify(claims));
  const sig = nodeSign("sha256", Buffer.from(`${h}.${p}`), privateKey);
  return `${h}.${p}.${b64u(sig)}`;
}
const good = () => ({ aud: [AUD], iss: `https://${TEAM}.cloudflareaccess.com`, exp: NOW + 600, iat: NOW - 10, email: "me@example.com", sub: "u1" });
const fetchFn = async (url: string) => {
  assert.equal(url, certsUrl(TEAM));
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
};
const opts = { teamDomain: TEAM, aud: AUD, fetchFn, now: () => NOW };

test("a valid token yields the identity", async () => {
  const id = await verifyAccessJwt(jwt(good()), opts);
  assert.deepEqual(id, { email: "me@example.com", sub: "u1" });
});

test("missing token is refused", async () => {
  await assert.rejects(verifyAccessJwt(null, opts), /access: no token/);
});

test("wrong audience is refused", async () => {
  await assert.rejects(verifyAccessJwt(jwt({ ...good(), aud: ["other"] }), opts), /access: aud/);
});

test("expired token is refused", async () => {
  await assert.rejects(verifyAccessJwt(jwt({ ...good(), exp: NOW - 1 }), opts), /access: expired/);
});

test("wrong issuer is refused", async () => {
  await assert.rejects(verifyAccessJwt(jwt({ ...good(), iss: "https://evil.cloudflareaccess.com" }), opts), /access: iss/);
});

test("a tampered payload fails signature verification", async () => {
  const [h, , s] = jwt(good()).split(".");
  const forged = `${h}.${b64u(JSON.stringify({ ...good(), email: "attacker@example.com" }))}.${s}`;
  await assert.rejects(verifyAccessJwt(forged, opts), /access: bad signature/);
});

test("unknown kid is refused", async () => {
  await assert.rejects(verifyAccessJwt(jwt(good(), { alg: "RS256", kid: "nope" }), opts), /access: unknown key/);
});

test("alg other than RS256 is refused before any key lookup", async () => {
  await assert.rejects(verifyAccessJwt(jwt(good(), { alg: "none", kid: "k1" }), opts), /access: alg/);
});
```

- [ ] **Step 2: Add to the test list, run, see it fail**

Append ` tests/review-access.test.ts`. Run: `npx tsx --test tests/review-access.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// review-worker/src/access.ts — verify Cloudflare Access's JWT ourselves. Access
// already sits in front of review.clarity-lists.com, but a direct workers.dev
// hit or a misrouted DNS record would bypass it; this makes the Worker refuse
// anything that did not come through the login.
import type { FetchLike } from "./notion-fetch.js";

export interface AccessOpts {
  teamDomain: string;
  aud: string;
  fetchFn?: FetchLike;
  now?: () => number;
}
export interface AccessIdentity {
  email?: string;
  sub: string;
}

export const certsUrl = (teamDomain: string) => `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;

type Jwk = JsonWebKey & { kid?: string };
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { keys: Jwk[]; at: number }>();

async function jwks(teamDomain: string, fetchFn: FetchLike): Promise<Jwk[]> {
  const hit = cache.get(teamDomain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.keys;
  const res = await fetchFn(certsUrl(teamDomain));
  if (!res.ok) throw new Error(`access: certs ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  cache.set(teamDomain, { keys, at: Date.now() });
  return keys;
}

const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(fromB64u(s))) as Record<string, unknown>;

export async function verifyAccessJwt(token: string | null, opts: AccessOpts): Promise<AccessIdentity> {
  if (!token) throw new Error("access: no token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("access: malformed token");
  const [h, p, s] = parts;
  const header = json(h);
  if (header.alg !== "RS256") throw new Error("access: alg must be RS256");
  const keys = await jwks(opts.teamDomain, opts.fetchFn ?? fetch);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("access: unknown key id");

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("access: bad signature");

  const claims = json(p) as { aud?: string | string[]; iss?: string; exp?: number; email?: string; sub?: string };
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.aud)) throw new Error("access: aud mismatch");
  if (claims.iss !== `https://${opts.teamDomain}.cloudflareaccess.com`) throw new Error("access: iss mismatch");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new Error("access: expired");
  if (!claims.sub) throw new Error("access: no subject");
  return { email: claims.email, sub: claims.sub };
}
```

Note the order: `alg` and `kid` are checked before the signature, and the signature before any claim — a forged payload never gets its claims read.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit` → PASS. (`crypto.subtle`, `atob`, `TextEncoder` are globals in Node 22 and in Workers.)

- [ ] **Step 5: Commit**

```bash
git add review-worker/src/access.ts tests/review-access.test.ts package.json
git commit -m "review-worker: verify the Cloudflare Access JWT (RS256 via JWKS)"
```

---

### Task 6: The request handler with injected dependencies

**Files:**
- Create: `review-worker/src/handler.ts`
- Create: `tests/review-handler.test.ts`
- Modify: `package.json` (test list)

**Interfaces:**
- Consumes: `renderApprovePage`, `emptyQueuePage` (Task 3), `ApprovePin` (server.ts), `decisionPatch`, `isDecision` (Task 2), `PinSummary` (Task 1).
- Produces:
  ```ts
  export interface HandlerDeps {
    listInReview(): Promise<PinSummary[]>;
    updatePage(pageId: string, patch: DecisionPatch): Promise<void>;
    imageUrls(pageId: string): Promise<string[]>;
    today?: () => string;   // YYYY-MM-DD, default from Date
  }
  export function toApprovePin(row: PinSummary): ApprovePin;
  export function handleRequest(req: Request, deps: HandlerDeps): Promise<Response>;
  ```
  Routes: `GET /` → 200 HTML (queue or empty page); `GET /img/<pageId>/<i>` → 302 to the re-signed URL (`cache-control: no-store`), 404 when absent; `POST /decide` with JSON `{ pageId, decision, note? }` → 200 `{ok:true}` after Notion succeeded, 400 on bad JSON / unknown decision / missing pageId / revise without note, 404 when the pageId is not currently In Review, 502 when Notion fails; anything else 404. The handler is stateless: "is this pin still In Review" is checked against `listInReview()` on every decision, so two phones (or a retry) cannot double-decide.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/review-handler.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest, toApprovePin, type HandlerDeps } from "../review-worker/src/handler.js";
import type { PinSummary } from "../src/notionPage.js";

const row = (id: string, extra: Partial<PinSummary> = {}): PinSummary => ({
  pageId: id,
  name: `List ${id}`,
  pinTitle: `Title ${id}`,
  pinDescription: "d",
  altText: "a",
  board: "Travel & Festivals",
  listItems: "1. x",
  notes: "old",
  imageUrls: ["https://s3/1.png", "https://s3/2.png"],
  ...extra,
});

function deps(rows: PinSummary[]) {
  const updates: { pageId: string; patch: unknown }[] = [];
  const d: HandlerDeps & { updates: typeof updates } = {
    updates,
    listInReview: async () => rows,
    updatePage: async (pageId, patch) => {
      updates.push({ pageId, patch });
    },
    imageUrls: async (pageId) => (pageId === "p1" ? ["https://s3/fresh-0.png", "https://s3/fresh-1.png"] : []),
    today: () => "2026-09-09",
  };
  return d;
}
const post = (body: unknown) => new Request("https://review.clarity-lists.com/decide", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("GET / renders the queue with each pin's title and an image count, never the URLs", async () => {
  const res = await handleRequest(new Request("https://r/"), deps([row("p1"), row("p2")]));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Title p1/);
  assert.match(html, /Title p2/);
  assert.doesNotMatch(html, /s3\/1\.png/);
  assert.match(html, /"imageCount":2/);
});

test("GET / with an empty queue renders the nothing-to-review page", async () => {
  const res = await handleRequest(new Request("https://r/"), deps([]));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Nothing to review/);
});

test("GET /img re-signs on every request and redirects with no-store", async () => {
  const res = await handleRequest(new Request("https://r/img/p1/1"), deps([row("p1")]));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://s3/fresh-1.png");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const missing = await handleRequest(new Request("https://r/img/p9/0"), deps([]));
  assert.equal(missing.status, 404);
});

test("POST /decide writes the decision patch to Notion before answering", async () => {
  const d = deps([row("p1")]);
  const res = await handleRequest(post({ pageId: "p1", decision: "revise", note: "items 3 and 7" }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(d.updates, [{ pageId: "p1", patch: { status: "Needs changes", notes: "old | revise 2026-09-09: items 3 and 7" } }]);
});

test("POST /decide refuses revise without a note, bad decisions, bad JSON", async () => {
  const d = deps([row("p1")]);
  assert.equal((await handleRequest(post({ pageId: "p1", decision: "revise" }), d)).status, 400);
  assert.equal((await handleRequest(post({ pageId: "p1", decision: "publish" }), d)).status, 400);
  assert.equal((await handleRequest(new Request("https://r/decide", { method: "POST", body: "{nope" }), d)).status, 400);
  assert.deepEqual(d.updates, []);
});

test("POST /decide for a pin no longer In Review is a 404 (already decided elsewhere)", async () => {
  const d = deps([row("p2")]);
  const res = await handleRequest(post({ pageId: "p1", decision: "approve" }), d);
  assert.equal(res.status, 404);
  assert.deepEqual(d.updates, []);
});

test("a Notion failure is a 502 and the page can retry", async () => {
  const d = deps([row("p1")]);
  d.updatePage = async () => {
    throw new Error("Notion 500");
  };
  const res = await handleRequest(post({ pageId: "p1", decision: "approve" }), d);
  assert.equal(res.status, 502);
  assert.match((await res.json() as { error: string }).error, /Notion 500/);
});

test("unknown routes are 404; toApprovePin falls back to the name when there is no title", async () => {
  assert.equal((await handleRequest(new Request("https://r/whatever"), deps([]))).status, 404);
  assert.equal(toApprovePin(row("p1", { pinTitle: "" })).pinTitle, "List p1");
});
```

- [ ] **Step 2: Add to the test list, run, see it fail**

Append ` tests/review-handler.test.ts`. Run: `npx tsx --test tests/review-handler.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// review-worker/src/handler.ts — the routes, with every side effect injected so
// the tests run without Notion or Access. Mirrors src/approve/server.ts (the
// local page) but is stateless: a decision is checked against the live queue.
import { renderApprovePage, emptyQueuePage } from "../../src/approve/page.js";
import type { ApprovePin } from "../../src/approve/server.js";
import { decisionPatch, isDecision, type DecisionPatch } from "../../src/approve/decide.js";
import type { PinSummary } from "../../src/notionPage.js";

export interface HandlerDeps {
  listInReview(): Promise<PinSummary[]>;
  updatePage(pageId: string, patch: DecisionPatch): Promise<void>;
  imageUrls(pageId: string): Promise<string[]>;
  today?: () => string;
}

export function toApprovePin(r: PinSummary): ApprovePin {
  return {
    pageId: r.pageId,
    name: r.name,
    pinTitle: r.pinTitle || r.name,
    pinDescription: r.pinDescription ?? "",
    altText: r.altText ?? "",
    board: r.board ?? "(no board)",
    listItems: r.listItems ?? "",
    imageUrls: r.imageUrls,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/") {
    const rows = await deps.listInReview();
    return html(rows.length ? renderApprovePage(rows.map(toApprovePin)) : emptyQueuePage());
  }

  if (req.method === "GET" && url.pathname.startsWith("/img/")) {
    const m = /^\/img\/([^/]+)\/(\d+)$/.exec(url.pathname);
    if (!m) return new Response("no image", { status: 404 });
    const target = (await deps.imageUrls(m[1]))[Number(m[2])];
    if (!target) return new Response("no image", { status: 404 });
    return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store" } });
  }

  if (req.method === "POST" && url.pathname === "/decide") {
    let body: { pageId?: unknown; decision?: unknown; note?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json(400, { error: "bad JSON" });
    }
    const { pageId, decision, note } = body;
    if (typeof pageId !== "string" || !pageId || !isDecision(decision)) return json(400, { error: "unknown pin or bad decision" });
    const cleanNote = typeof note === "string" ? note.trim() : "";
    if (decision === "revise" && !cleanNote) return json(400, { error: "needs-changes requires a note saying what to change" });

    // Stateless: confirm the pin is still In Review right now, so a second phone
    // or a retry after a timeout cannot decide it twice.
    const row = (await deps.listInReview()).find((r) => r.pageId === pageId);
    if (!row) return json(404, { error: "that list is no longer in review" });

    const today = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
    try {
      await deps.updatePage(pageId, decisionPatch(decision, cleanNote || undefined, row.notes, today));
    } catch (err) {
      return json(502, { error: (err as Error).message });
    }
    return json(200, { ok: true });
  }

  return new Response("not found", { status: 404 });
}
```

The page's `decide()` already treats any non-OK response as "Notion said no … try again", so the 502/404 bodies surface as-is.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add review-worker/src/handler.ts tests/review-handler.test.ts package.json
git commit -m "review-worker: routes with injected deps — queue, re-signed images, stateless decide"
```

---

### Task 7: Entry point, secrets, Access, deploy — and review one list from the phone

**Files:**
- Create: `review-worker/src/index.ts`
- Modify: `review-worker/wrangler.jsonc` (the two vars)

**Interfaces:**
- Consumes: `verifyAccessJwt` (Task 5), `notionApi` (Task 4), `handleRequest` (Task 6), `Env`.

- [ ] **Step 1: Write the entry point**

```ts
// review-worker/src/index.ts — the only file that touches the real network.
// Access first (403 without a valid token), then the handler with Notion deps.
import type { Env } from "./env.js";
import { verifyAccessJwt } from "./access.js";
import { notionApi } from "./notion-fetch.js";
import { handleRequest } from "./handler.js";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      await verifyAccessJwt(req.headers.get("Cf-Access-Jwt-Assertion"), { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD });
    } catch (err) {
      return new Response(`Forbidden — ${(err as Error).message}`, { status: 403 });
    }
    const notion = notionApi(env.NOTION_TOKEN);
    return handleRequest(req, {
      listInReview: () => notion.queryInReview(env.NOTION_DB_ID),
      updatePage: (id, patch) => notion.updatePage(id, patch),
      imageUrls: (id) => notion.pageImageUrls(id),
    });
  },
};
```

Run: `npx tsc --noEmit` → clean. Then a dry bundle: `cd review-worker && npx wrangler deploy --dry-run --outdir dist` → prints the bundle size, no upload; confirms wrangler resolves the `../../src/*.js` imports to the `.ts` sources. (`dist/` is git-ignored.)

- [ ] **Step 2: Create the Access application (dashboard, one time)**

In the Cloudflare dashboard (account that owns `clarity-lists.com`, logged in as `claritybucketlist@gmail.com`):

1. **Zero Trust** → if asked, pick a team name — this is `ACCESS_TEAM_DOMAIN` (e.g. `clarity` → `clarity.cloudflareaccess.com`). Free plan.
2. Zero Trust → **Settings → Authentication → Login methods**: add **Google** (needs a Google OAuth client id/secret from console.cloud.google.com; redirect URI `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`). If that's more than you want tonight, **One-time PIN** is already enabled and needs nothing — the login page emails a code. Either works; Google is one tap after the first time.
3. Zero Trust → **Access → Applications → Add an application → Self-hosted**: name `Clarity review`, session duration **30 days**, application domain `review.clarity-lists.com`.
4. Policy: name `Owner`, action **Allow**, include → **Emails** → `shir.rubin6@gmail.com` and `claritybucketlist@gmail.com`.
5. Save. Open the application's **Overview** tab and copy the **Application Audience (AUD) Tag** — this is `ACCESS_AUD`.

Put both values in `review-worker/wrangler.jsonc` under `vars` (they are not secrets).

- [ ] **Step 3: Secrets and first deploy**

```bash
cd review-worker
npx wrangler secret put NOTION_TOKEN      # paste the value from ../.env
npx wrangler secret put NOTION_DB_ID
npx wrangler deploy
```

Expected: `Deployed clarity-review` with the custom domain `review.clarity-lists.com` attached (wrangler creates the DNS record because the zone is on Cloudflare). If the domain step fails with "route already exists", check DNS for a stale `review` record and delete it.

- [ ] **Step 4: Verify the gate, then the queue**

- `curl -s -o /dev/null -w "%{http_code}\n" https://clarity-review.<account>.workers.dev/` → **403** (no Access token; the Worker refuses on its own).
- `curl -s -o /dev/null -w "%{http_code}\n" https://review.clarity-lists.com/` → **302** to the Access login page.
- On your phone: open `https://review.clarity-lists.com`, sign in, see the queue (or "Nothing to review"). Decide **one** list you actually mean to decide; confirm in Notion that its Status changed and the note was appended with the ` | ` separator. Tap the same list's button again in a second tab → the page shows "that list is no longer in review".
- `npx wrangler tail` while tapping: no errors.

- [ ] **Step 5: Commit**

```bash
git add review-worker/src/index.ts review-worker/wrangler.jsonc
git commit -m "review-worker: entry point with Access check; deployed to review.clarity-lists.com"
```

---

### Task 8: Docs

**Files:**
- Modify: `CLAUDE.md`, `../CLARITY_PLAN.md` (+ `.html` twin), `~/.claude/skills/clarity-status/SKILL.md`

- [ ] **Step 1: `CLAUDE.md`**

Commands block — add:

```
npm run review:deploy      # deploy the phone review page (review-worker/) to review.clarity-lists.com
```

Architecture — replace the "The daily review happens via `clarity approve`'s local page…" clause with: "The daily review happens at **review.clarity-lists.com** (a Cloudflare Worker in `review-worker/`, behind Cloudflare Access — Google or one-time-PIN login for the two owner emails); `clarity approve` serves the same page locally as a fallback." Add one bullet:

```
- `review-worker/` — the hosted review page. `src/index.ts` verifies the Access JWT (`src/access.ts`, RS256 against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`) and serves `src/handler.ts`, which renders `../src/approve/page.ts` and writes verdicts through `../src/approve/decide.ts` — the same renderer and decision rules as the local page, so they cannot drift. Notion is called with plain fetch (`src/notion-fetch.ts`, mapping via `src/notionPage.ts`); no SDK in the bundle. Secrets `NOTION_TOKEN`/`NOTION_DB_ID` via `wrangler secret put`; vars `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` in `wrangler.jsonc`. Tests live in the root suite (`tests/review-*.test.ts`) and never touch the network.
```

Update the `npm test` comment to include `notionPage + decide + review-notion + review-access + review-handler`.

- [ ] **Step 2: Plan status**

Append to the Status section of `../CLARITY_PLAN.md` (and mirror in the `.html` twin, same `<br><br><strong>…` conventions as the Milestone 2 step-1 paragraph):

```
**Milestone 2 — hands-off pipeline, step 2 (<date>): the phone review page is live.** `review.clarity-lists.com` (Cloudflare Worker `clarity-review`, behind Cloudflare Access) shows the In Review queue phone-first — swipe the four variants, tap Approve / Needs changes (+ note) / Reject — and writes each tap straight to Notion; the local `clarity approve` is the fallback. One decision module (`src/approve/decide.ts`) serves both. **Next:** step 3 — the daily job (runs `revise` overnight, flips `Scheduled → Published`, migrates the legacy Published rows).
```

- [ ] **Step 3: `/clarity-status` skill**

In the "After showing the card" list, change the first bullet to: `lists in review → open https://review.clarity-lists.com on your phone (or clarity approve on the laptop)`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the phone review page"
```

(The plan twins and the skill live outside this repo.)

---

## Self-review

**Spec coverage (§3 + §8 Worker tests):**
- Placement in `review-worker/`, own `wrangler.jsonc`/`package.json`, deployed from that directory, imports `../src/approve/page.ts` and shares logic → Tasks 4, 6.
- Notion via plain fetch, secrets via `wrangler secret put`, the three calls → Task 4.
- Routes: `GET /` (+ empty page), `POST /decide` (validate, Notion-before-200, appendNote tagging), image re-signing → Task 6 (path `/img/<id>/<i>` — deviation recorded in Global Constraints).
- `decide.ts` extraction shared by CLI stage and Worker → Task 2.
- Cloudflare Access: dashboard setup, emails, Google (OTP fallback), 30-day session; Worker verifies `Cf-Access-Jwt-Assertion` (certs URL, `aud`, vars) → Tasks 5, 7.
- Mobile pass: one list per screen, snap strip, three full-width buttons, note on "Needs changes", receipt collapse + scroll, "N of M", desktop unchanged, local `clarity approve` unchanged → Task 3.
- §8: handler tests with fake fetch and the Access header checks (missing → 403, bad signature → 403) → Tasks 5, 6 (unit) + Task 7 (live 403 check).
- §7 error rows: Notion unreachable → page/502 with no write (Task 6); Access misconfigured → 403 (Task 7).

**Placeholder scan:** none — every step has code or an exact command; the only "REPLACE-ME" values are dashboard outputs filled in Task 7 Step 2.

**Type consistency:** `PinSummary`/`NotionPage` (Task 1) used by Tasks 4, 6; `DecisionPatch`/`decisionPatch`/`isDecision` (Task 2) used by 4, 6; `FetchLike` (Task 4) used by 5; `HandlerDeps` (Task 6) matched field-for-field by `index.ts` (Task 7); `renderApprovePage`/`emptyQueuePage` (Task 3) used by 6; `ApprovePin` still exported from `server.ts`.
