# Milestone 1 — Frictionless Daily Loop

*Design spec, approved 2026-08-22. Part of the expanded Clarity roadmap (see `../../../../CLARITY_PLAN.md`): M1 daily loop → M2 blog launch → M3 affiliates → M4 board expansion + stats.*

## Context

Phases 0–3 of the pipeline are complete: `ideas → draft → design → review → publish` works end to end and the first real pin is live. But the daily loop is still manual at both human touchpoints: approving means hunting rows in Notion, and posting means hand-filling the Pinterest pin builder per pin. M1 removes nearly all of that friction. Affiliates and blog work deliberately come after (M2/M3) — this milestone keeps the account's 3-pins/day revival cadence sustainable while the bigger blog work happens.

## Goals

- Approving a batch takes ~1 minute in a purpose-built local page.
- Approved pins are scheduled automatically by the cadence rules — the queue is a calendar nobody thinks about.
- Posting collapses into a ~15-minute browser-assisted batch session about twice a week.
- The pin design system exists on paper (`DESIGN.md`) so future templates don't drift.

## Non-goals

- No unattended posting — Pinterest API access is Trial-pending; API posting is M4. Batch sessions need Claude at the wheel of the logged-in Chrome.
- No editing of pin copy in the approve page (that stays in Notion), no undo button, no auth (localhost only).
- No stats/feedback loop (M4), no Metricool (back-pocket fallback only; native scheduler chosen as primary).

## Component 1 — `clarity approve` (local review page)

New CLI stage. Zero new npm dependencies (Node built-in `http`).

1. Fetch all `In Review` rows from Notion, including pin-image signed URLs (valid ~1h — fine for a session).
2. Serve one self-contained HTML page on `127.0.0.1:4178` (localhost only) and open the default browser.
3. UI: vertical feed of cards, one per pin — both PNG variants large side by side, title, description, board chip, alt text, list items collapsed. Progress counter ("2 of 5 decided"). Styled with the pin palettes.
4. Per card: Approve / Reject buttons + optional note field. Keyboard: `A`/`R` on focused card, arrows to move.
5. Each decision writes to Notion immediately (Status → `Approved`/`Rejected`; note → `Notes` property, so rejection reasons can feed future generation). Notion errors show on the card with a retry; nothing batched, nothing lost.
6. When the last card is decided: summary screen ("4 approved, 1 rejected — run `clarity publish`") and the server exits.

## Component 2 — scheduling brain (inside `clarity publish`)

Schema change: new Notion date field **`Scheduled date`** (added to live DB + `schema.ts`) = the date the pin should go live. Empty until publish assigns it.

Assignment algorithm, run when rows flip `Approved → Published`:

1. Read the existing calendar: every pipeline row with a `Scheduled date`, plus anything posted today. Backfill rows ignored. Re-running publish never double-books.
2. Fill slots at **3 pins/day**, starting from the earliest day with an open slot.
3. Constraints per slot:
   - **72h per destination URL** (destination = board URL until the blog is live) — pins sharing a board sit ≥3 days apart; boards are interleaved.
   - **1 list = 2 scheduled pins**: publish creates **one pack per PNG variant**, each with its own date. Variants share a destination, so the 72h rule automatically spreads them. (Decision: variants are fresh-pin lottery tickets, not spares — doubles queue depth, matches the research.)
4. Write the date to Notion and stamp the pack: `exports/packs/<scheduled-date>--<slug>--v1/`, `post.txt` opens with `POST ON: <date>`.

Edge behavior: big batches extend the calendar (16 pins ≈ 5–6 days), nothing dropped. Rows that already have a date are never touched. Slipped days don't auto-shift — the next batch session loads overdue packs first. The 4 packs exported before scheduling existed get dates backfilled on the next publish run, first in the queue.

## Component 3 — batch posting sessions (browser-assisted, native scheduler)

Roughly twice weekly, in a session: Claude drives the logged-in Chrome through pinterest.com's pin builder.

Per pin, earliest `Scheduled date` first (overdue first of all): upload PNG → fill title, description, alt text, destination link, board → fill **all 10 tagged-topic slots** (concrete nouns from list items + vibe topics; rule lives in each `post.txt`) → toggle **"Publish at a later date"** with the pack's date (pins due today publish immediately) → after Pinterest confirms, write `Pin URL` back to Notion + a session log line.

User involvement: two pauses — a preview at the start ("6 pins across 4 days") and a recap at the end. Anything unexpected from Pinterest (new dialog, changed form, verification) stops the session for the user rather than guessing.

Invariant: **Notion is updated only after Pinterest confirms** — the DB never claims a pin is live that isn't. `Pin URL` present = live; pipeline status `Published` alone = pack exported.

Rhythm cap: the native scheduler holds a limited number of pending pins, max ~2 weeks out → one session loads ~3–4 days; twice a week sustains 3/day. When Pinterest Standard access lands (M4), this component is replaced by a real API `clarity post` and the ritual disappears.

## Component 4 — `DESIGN.md` (pin design system on paper)

Repo root. Documents what's built, no new decisions: the 2 templates (`classic-checklist`, `bold-panel`) and when each wins; the standing no-serif rule (rejected `soft-editorial` pilot); the 9 theme palettes, 3 variants per theme picked per list name, collision-bumping, subject-first emoji — the "no twins" invariant as a hard constraint; the copy playbook (title 40–60c keyword-first, description <500 with 3–5 hashtags, alt text 80–140c, keyword visibly on image); posting rules (3/day, 72h/URL, tagged-topics technique, scheduler rhythm); render facts (2000×3000, playwright-core on installed Chrome, vendored fonts, reference-pin locations).

## Build order & acceptance

Build 1 → 2 → 4, then run 3 for real. Acceptance = the live backlog: the 5 `In Review` rows go through the approve page, publish schedules them (plus backfills dates for the 4 waiting packs), and a first batch session loads the queue into Pinterest's scheduler with Pin URLs written back.
