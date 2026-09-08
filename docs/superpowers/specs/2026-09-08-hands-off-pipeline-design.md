# Hands-off pipeline — design

**Date:** 2026-09-08 · **Status:** approved in conversation, awaiting implementation plan

## Goal

The user should touch the Clarity pipeline in exactly three places, and never have to
remember an order of commands:

1. **Review on the phone**, any time, at `review.clarity-lists.com`.
2. **`/clarity-status`** — see where things stand.
3. **`/clarity-post`** — one word that ships every approved list end-to-end: blog post,
   packs, blog deploy, and the four pins into Pinterest's scheduler.

Everything else runs unattended on the laptop. The user is the only human gate (approval)
and the only trigger for the one step that must stay human-adjacent (posting to Pinterest
through the browser, chosen over unattended Playwright to keep the account safe).

## Decisions made in the brainstorm

| Question | Decision |
|---|---|
| Where is the daily review done? | On the phone, hosted — not the laptop, not inside Notion. |
| How do pins reach Pinterest? | Claude drives the user's Chrome on demand (extension). Not headless Playwright (account risk), not waiting for the API (no ETA). |
| When do blog post + packs + deploy happen? | When the user says `/clarity-post`, all in one go. Not in the nightly job. |
| Where is the review page hosted? | Cloudflare Worker at `review.clarity-lists.com`, behind Cloudflare Access (Google login). Not an unguessable URL, not a tunnel. |
| Which commands become skills? | Only the two the user says: `/clarity-status` (exists) and `/clarity-post` (new). Internal stages stay CLI commands for debugging. |

## 1. States

The Notion `Status` select remains the state machine. One status is added and one changes
meaning.

```
Idea → Drafted → Designed → In Review ⇄ Needs changes
                                ↓
                            Approved → Scheduled → Published
                                ↓
                            Rejected                      (+ Archived, unchanged)
```

- **`Scheduled` (new).** Blog post live, packs written, all four variants sitting in
  Pinterest's native scheduler, `Pin URL` set to the first variant. Written by
  `clarity posted` when the 4th variant lands (§4.4).
- **`Published` (meaning changes).** The first variant's date has passed — it is live.
  Flipped by the nightly job, date-based, no Pinterest call (§5). Today `publish` sets
  `Published` at pack time, which is a lie; that stops.
- **`Approved`** now visibly means "waiting for `/clarity-post`" and is surfaced as such on
  the status card.
- `Needs changes` is unchanged, but the nightly job runs `revise` on it (§5), so a note
  typed on the phone is back in the queue the next morning.
- `Idea / Drafted / Designed / In Review` unchanged; the user never sees the first three.

`STATUSES` in `src/schema.ts` gains `"Scheduled"` between `Approved` and `Published`;
`ensureStatusOptions()` pushes it to the live DB on the next run. `IN_FLIGHT_STATUSES` in
`src/queue.ts` is unchanged (`Scheduled` rows are already on the calendar as posted packs).

**Migration.** Rows currently `Published` whose packs are in `exports/posted/` with a future
date are really `Scheduled`; a one-off script (`scripts/migrate-scheduled.ts`) flips them
using the pack dates. Rows whose earliest pack date has passed stay `Published`.

## 2. The three touchpoints

| User does | Where | Effect |
|---|---|---|
| Approve / Needs changes (+ note) / Reject | `review.clarity-lists.com`, phone | Written to Notion instantly. Nothing else moves. |
| `/clarity-status` | Claude Code | The card (§6). |
| `/clarity-post` | Claude Code, laptop open, ~10 min per list | §4. |

Everything else is the nightly job (§5).

## 3. The review Worker — `review.clarity-lists.com`

### Placement

`Clarity_pinterest/review-worker/` — its own `wrangler.jsonc` and `package.json`, deployed
with `npx wrangler deploy` from that directory (same Cloudflare account as the blog Worker
`clarity-blog`; wrangler is already logged in as `claritybucketlist@gmail.com`). It imports
`../src/approve/page.ts` for rendering and `../src/schema.ts` for statuses so the local
`clarity approve` and the hosted page never drift.

### Notion access

Plain `fetch` against the Notion REST API — no `@notionhq/client` in the Worker. Secrets via
`wrangler secret put`: `NOTION_TOKEN`, `NOTION_DB_ID`. A small `notion-fetch.ts` module
inside the Worker covers the three calls needed: query In Review rows, update a page's
`Status` + `Notes`, and fetch a page's `Pin image` files (for re-signed URLs).

### Routes

| Route | Behaviour |
|---|---|
| `GET /` | Query `In Review` rows, render the queue. Empty queue renders a "nothing to review" page. |
| `POST /decide` | Body `{ pageId, decision, note? }`. Validates `decision ∈ {approve, reject, revise}`. Writes Notion **before** responding 200 (the page's card state never gets ahead of Notion — same rule as the local server). Notes are appended with `appendNote` (` \| ` separator), tagged `revise <date>:` / `review <date>:` exactly as `src/stages/approve.ts` does today. |
| `GET /image?page=<id>&i=<n>` | Re-signs the Notion file URL on every request (Notion URLs expire after an hour) and 302s to it. |

The decision → status/marker mapping (`STATUS_FOR`, `MARKER_FOR`, `appendNote`) moves out
of `src/stages/approve.ts` into `src/approve/decide.ts` so both the CLI stage and the Worker
import one definition.

### Auth — Cloudflare Access

- One-time dashboard setup (walked through in the plan): Zero Trust → Access → Application
  "Clarity review", domain `review.clarity-lists.com`, policy *Allow* emails
  `shir.rubin6@gmail.com` and `claritybucketlist@gmail.com`, Google as identity provider,
  session 30 days.
- The Worker **also** verifies the `Cf-Access-Jwt-Assertion` header on every request
  (signature against the team's public keys at
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, `aud` = the application's AUD
  tag; both stored as Worker vars `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`). A request without a valid token gets 403 — so a misconfigured
  DNS record or a direct `workers.dev` hit cannot bypass the login.

### Mobile pass on the page

`src/approve/page.ts` currently lays variants side by side for a desktop window. Changes:

- One list per screen; the four variant images in a horizontally scrollable strip with
  snap points; title/description/alt/board below; list items collapsed behind a toggle.
- Three full-width buttons: **Approve**, **Needs changes**, **Reject**. "Needs changes"
  reveals a note textarea and a confirm button (a note is required for that verdict).
- After a decision the card collapses to a one-line receipt and the next list scrolls into
  view. A running "3 of 6" counter in the header.
- Desktop keeps working (the same page, wider); the local `clarity approve` is unchanged
  in behaviour and stays as a fallback.

## 4. `/clarity-post`

A skill (`~/.claude/skills/clarity-post/SKILL.md`) that runs deterministic CLI commands
for everything except the browser, and carries the browser recipe in the skill itself (not
only in memory). Step by step:

### 4.1 `clarity ship`

New stage, replaces the need to remember `blogpost` then `publish`:

1. For every `Approved` row: `blogpost` (skips rows that already have a post on disk).
2. `pack` — the current `publish` stage, renamed. Two changes: it no longer sets `Published`
   (row stays `Approved`); and each pack gets a **time slot** in addition to a date.
   `src/schedule.ts` assigns slot indexes 0–2 per day; `post.txt` gains `POST AT: 09:00 AM`
   (slots 09:00 / 01:00 PM / 06:00 PM — the account's real slots; 12:00 PM is never used
   because that is the builder's default and the source of the duplicate defect). Pack
   directory names are unchanged.
3. `astro build && wrangler deploy` in `Clarity_blog` **only if** step 1 wrote at least one
   new post.
4. Prints what it did. Idempotent: rerunning after a failure repeats nothing that exists.

`publish` remains as an alias of `pack` for one release, printing a deprecation line.

### 4.2 `clarity post-plan`

Prints the packs to post, in date-then-slot order, **only those dated within 29 days of
today** (Pinterest's scheduler ceiling; 10/03 accepted, 10/04 rejected on 09-04). Each entry
carries everything the browser step needs, with nothing left to derive:

```
1/19  2026-09-08  09:00 AM  the-handmade-gift-bucket-list… (classic-checklist)
      image: exports/packs/2026-09-08--…/classic-checklist.png
      board: Smart & Creative Projects        ← Pinterest spelling ("Books, Learning & Culture", not "·")
      link:  https://clarity-lists.com/posts/…
      title: …
      description: …
      alt: …
      topics: tea | baking | candles | … (10, from list items + vibe words)
```

Packs beyond the window are counted at the bottom ("7 more waiting for the 29-day
window"). `--json` emits the same as JSON for the skill to parse.

The board-name mapping (Notion select → Pinterest board title) lives in `src/schema.ts`
next to `BOARDS`. Topic suggestions come from a small pure function over list items +
theme (`src/topics.ts`), unit-tested; the browser step still has to fuzzy-match them
against Pinterest's taxonomy.

### 4.3 The browser step (Claude, one pin at a time)

The recipe from project memory `pinterest-chrome-posting-recipe`, written into the skill
as a checklist. Non-negotiables, each learned from a mis-published pin:

1. **Reconcile first.** Pull `ScheduledPinsResource` + `UserActivityPinsResource` JSON and
   run `clarity reconcile` (§4.5) before posting anything — packs on disk may already be
   live from an unrecorded session.
2. **One draft at a time.** Confirm the drafts sidebar is empty before building the next
   pin; two drafts coexisting publishes the wrong one.
3. **Click the board explicitly** via `board-dropdown-select-button` → `board-row-<Name>`,
   even if it displays correctly — Publish stays disabled otherwise.
4. **Read the schedule toggle, date and time before submit**; the button must say
   "Schedule", not "Publish". Never leave a draft unpublished (it silently acquires a
   12:00 PM schedule).
5. **Trusted clicks** (`find` → `computer left_click`) for Publish, the "…" menu and drafts
   rows; JS only for setting field values (synthetic paste for the Draft.js description).
6. **Verify each pin** against `ScheduledPinsResource` (id, `scheduled_ts`, `link`)
   immediately after submit, then call `clarity posted`.
7. Pace: no more than one pin per minute. On a spam block, stop the batch — do not retry.
8. If the tab degrades (screenshots/`Runtime.evaluate` timing out), open a fresh tab. A
   timed-out call may have succeeded — re-read state, never retry blind.

### 4.4 `clarity posted <pack-dir> <pin-id>`

Bookkeeping after each pin, so Claude never edits files or Notion by hand:

- Moves `exports/packs/<pack>` → `exports/posted/<pack>`, appends
  `POSTED: <iso-timestamp> pin <id>` to `post.txt`.
- Appends a Notion note `posted <date>: <template> → https://www.pinterest.com/pin/<id>/`.
- If this was the row's **4th** variant: `Status → Scheduled`, `Pin URL` = first variant's
  URL, `Scheduled date` = earliest pack date (unchanged if already set).
- If fewer than 4: row stays `Approved`; the card shows "3/4 posted" so a half-done list is
  visible rather than silent.

The pure transition (`{postedTemplates, total} → {status, pinUrl?}`) lives in
`src/posted.ts` and is unit-tested.

### 4.5 `clarity reconcile <scheduled.json> <created.json>`

Takes the two Pinterest JSON dumps (saved by Claude from the browser into
`exports/reconcile/`) and diffs them against `exports/packs/` + `exports/posted/`:

- **Already live but still in `packs/`** → lists them; `--apply` runs `posted` for each.
- **12:00 PM entries** → flagged as duplicates with the pin id and the
  `/scheduled-pin/<id>/` URL to delete.
- **Same title twice on one day** → flagged.
- **In `posted/` but absent from Pinterest** → flagged as "missing — repost".

Pure diff in `src/reconcile.ts`, unit-tested with fixture JSON.

### 4.6 The skill's flow

```
clarity ship
clarity reconcile  (after pulling the two JSONs)
clarity post-plan --json
for each entry: build the pin in Chrome → verify → clarity posted …
clarity reconcile  (again — catch 12:00 duplicates from this batch)
clarity status
```

The skill ends by printing the status card, so the user sees the result without asking.

## 5. The nightly job

`scripts/scheduled-run.ts` + `scripts/register-task.ps1`:

- Trigger changes from Mon/Thu 02:00 to **daily 02:00** (`-Daily -At 2am`). Still exits in
  seconds when nothing is needed.
- Order of work: `revise` (Needs changes → back to In Review) → generate if queue health
  says so (ideas → draft → design → review, as today) → **flip `Scheduled → Published`**
  for rows whose `Scheduled date` ≤ today.
- Still never posts and never approves.

The flip is pure (`src/publishedFlip.ts`: `(rows, today) → pageIds`) and unit-tested.

## 6. Status card changes (`src/status.ts`)

- ⚡ NEEDS YOU NOW gains **`N lists approved — /clarity-post`** and, when relevant,
  **`N packs waiting for the 29-day window`** (informational, not work).
- Partially posted rows show as `3/4 posted` under ⚡.
- 📅 counts `Scheduled` rows (Notion) and the posted packs as before; the two numbers should
  agree, and the card says so when they don't.
- The banner rule is unchanged: 🔴 overdue · 🟡 waiting on you · 🟢 clear.

## 7. Error handling

| Failure | Behaviour |
|---|---|
| Pinterest spam block during posting | Skill stops the batch; remaining packs stay in `packs/`; card shows them 🟡. Retry the next day. |
| Pack dated beyond 29 days | Excluded from `post-plan`; counted on the card. |
| `ship` fails mid-way (blog build, Notion, missing render) | Row stays `Approved`; every step skips what already exists, so rerun is safe. A missing PNG is a warning naming the row (`clarity design` again), as today. |
| Notion unreachable from the Worker | Page renders an error; no decision is written; the local `clarity approve` still works. |
| Access misconfigured / token missing | Worker returns 403 — never renders the queue unauthenticated. |
| Chrome tab degrades | Fresh tab; no state lives in the tab. |
| Fewer than 4 variants posted when the session ends | Row stays `Approved`, card shows `n/4`; next `/clarity-post` picks up the remaining packs (they're still in `packs/`). |

## 8. Testing

Existing `node:test` suites gain:

- `schedule.test.ts` — slot assignment (0–2 per day, never a 4th, slot → time label).
- `postplan.test.ts` — ordering, 29-day window, board-name mapping, `--json` shape.
- `posted.test.ts` — 3/4 vs 4/4 transition, Pin URL choice, note format.
- `reconcile.test.ts` — the four diff cases against fixture JSON.
- `publishedFlip.test.ts` — date boundary.
- `status.test.ts` — new rows and the Scheduled/pack agreement line.
- `review-worker/tests/handler.test.ts` — the three routes against a fake `fetch`, the
  Access header check (missing → 403, bad signature → 403).

Manual acceptance, in order: (1) `clarity ship` on the current Approved rows, then
`/clarity-post` posts them — this is the real backlog; (2) deploy the Worker, sign in from
the phone, decide one list, confirm it in Notion; (3) let the nightly job run once and
check the log.

## 9. Build order

1. **States + `ship` / `pack` / `post-plan` / `posted` / `reconcile` + the `/clarity-post`
   skill + status card rows.** Clears the current backlog; the daily pain.
2. **The review Worker + Access + mobile page.** Frees the user from the laptop.
3. **Nightly job: daily, `revise`, the Published flip. Migration script.** Small.

Each step leaves the pipeline working; none depends on a later one.

## 10. Housekeeping

- `CLAUDE.md` (pipeline) — commands list, state machine, the "what is a skill" rule.
- `CLARITY_PLAN.md` / `.html` — Status section and the "Where things stand" list.
- Project memory `pinterest-chrome-posting-recipe` — point at the skill as the canonical
  recipe once it exists.
- `/clarity-status` SKILL.md — the new rows and next-action offers (`/clarity-post`).

## Out of scope

Unattended (Playwright) posting; the Pinterest API stage (waits on Standard access);
affiliate content; any change to generation prompts or templates; hosting the review page
for anyone but the user.
