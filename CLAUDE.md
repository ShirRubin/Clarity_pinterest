# CLAUDE.md — Clarity Pinterest Pipeline

Automated content pipeline for pinterest.com/ClarityBucketLists: idea → bucket list → pin design → Notion review queue → publish → stats. Part of the Clarity project — the master plan lives at `../CLARITY_PLAN.md` (check its Status section for current phase).

## Commands

```bash
npm run clarity -- <cmd>   # status | queue | ideas | draft | design | topup | review | approve | revise | ship | pack | post-plan | posted | reconcile | blogpost | stats | run
clarity ship               # Approved → blog post + packs + blog deploy (everything after approval that needs no browser)
clarity post-plan [--json] # packs to post, in order, inside Pinterest's 29-day window — what /clarity-post reads
clarity posted <pack> <id> # after one pin is scheduled: move the pack, note the row, Scheduled once all 4 variants are up
clarity reconcile <s.json> <c.json> [--apply]  # diff Pinterest's pin lists vs the packs; --apply marks already-live packs posted
npm run clarity -- status  # whole-project card: what needs you, calendar, blog, open tasks (the /clarity-status skill runs this)
npm run clarity -- queue   # queue health: days of runway, overdue packs, lists to generate next
npm run generate           # the unattended twice-weekly run (queue-aware; skips when the queue is healthy)
npm run setup-notion       # one-time: creates the "Clarity Pins" DB (already done)
npm run backfill           # idempotent import of data/backfill.json into Notion
npm run analytics          # parse data/analytics/raw/*.csv -> snapshot JSON (add `-- --notion` to write stats)
npx tsx scripts/parse-rss.ts   # rebuild data/backfill.json from data/rss/*.rss
npm test                   # run the node:test suites (schedule + approve + queue + revise + destination + status + schema + packText + posted + topics + postplan + reconcile + rowForPack + ship)
npx tsc --noEmit           # typecheck
clarity approve            # opens the local review page (In Review → Approved / Needs changes / Rejected) at 127.0.0.1:4178
clarity revise             # Needs changes → rewrites each list from your review notes, re-renders, back to In Review
```

## Architecture

- **State machine**: the Notion `Status` select drives everything — `Idea → Drafted → Designed → In Review → Approved → Scheduled → Published` (+ `Needs changes`, `Rejected`, `Archived`). Each stage command picks up rows in its input status and advances them. The daily review happens via `clarity approve`'s local page (Notion flipping still works as a fallback).
- **`Scheduled` vs `Published`**: `clarity posted` sets `Scheduled` when all four variants are in Pinterest's scheduler; `Published` means the first variant's date has passed (flipped by the nightly job — milestone 3). `pack` (ex-`publish`) never changes status.
- **The revise loop** (third verdict on the review page): "Needs changes" parks a row in that status with your notes appended to `Notes` as `revise <date>: <what to fix>`. `clarity revise` feeds the CURRENT list + that feedback back to the model as a targeted edit (not a fresh list), returns the row to `Drafted`, then chains `design` + `review` so it lands back in the queue. The applied entry is retagged `revised <date>:` so a second pass only acts on newer feedback. Notes are **appended, never overwritten** — `appendNote` joins with ` | `.
- `ensureStatusOptions()` in `notion.ts` syncs `STATUSES` into the live DB's Status select on every `clarity approve`, so adding a status to `schema.ts` is enough.
- `src/schema.ts` — **single source of truth** for the DB schema, boards, themes, trends. Notion select options must not contain commas (the live board "Books, Learning & Culture" is stored as "Books · Learning & Culture").
- `src/notion.ts` — client + typed `PinRow` accessors (`createPin`, `listPinsByStatus`).
- `src/stages/*.ts` — one module per stage.
- `src/claude.ts` — **generation runs on the Claude Code CLI, not the Anthropic SDK.** It spawns `claude -p --output-format json --system-prompt … --json-schema …`, which authenticates with the user's Claude Max subscription, so no `ANTHROPIC_API_KEY` is needed and generation costs nothing beyond the subscription. Two constraints worth remembering: `--json-schema` requires a top-level **object**, so array results are wrapped in `{"result": …}` and unwrapped in `generateJSON`; and never pass `--bare`, which forces API-key auth and ignores the OAuth login.
- `src/render/` + `templates/` — HTML→PNG pin renderer, 1000×1500, **4 template variants per list** (`classic-checklist`, `bold-panel`, `sticky-note`, `big-numbers`; see `DESIGN.md`). After adding a template, run `clarity topup` so rows already past Drafted get the new variant — `pack` will not schedule a row until every template is packed.
- `src/destination.ts` — where a pin sends the reader: the list's blog post on clarity-lists.com (Notion link → post on disk). `chooseDestination` itself can still fall back to a board URL, but `pack` treats that fallback as "not ready" and SKIPS the row with a warning rather than posting a board link — a board-linked pack could never be repaired once the post shows up. Shared by `pack` and `blogpost`; pure and unit-tested. Every pack written before 2026-09-06 linked to a board — `scripts/relink-pins.ts` (Notion + pack files) and `scripts/match-pins.mjs` (Pinterest pin → post) were the one-off migration.
- `data/backfill.json` — the 99 live pins (60 via board RSS feeds, +39 on 2026-09-06 via `scripts/import-postless.ts` from Pinterest's own pin data) scraped from the live profile (via board RSS feeds; logged-out board pages hide pin links, RSS is the reliable source: `https://www.pinterest.com/claritybucketlists/<board-slug>.rss`).
- `exports/` — publish packs (git-ignored), Stage A posting until Pinterest API Standard access.
- `scripts/import-analytics.ts` (`npm run analytics`) — **stats come in by hand, not by API.** The `PINTEREST_ACCESS_TOKEN` in `.env` returns `401` because the dev app is still on pending Trial, so the v5 analytics endpoints are closed to us. Instead: export from analytics.pinterest.com (Analytics → Overview → Export, and Audience insights → Export), drop the CSVs in `data/analytics/raw/`, and run the script. It writes a normalised `data/analytics/snapshot-<window-end>.json`, and with `-- --notion` it also fills `Impressions` + `Stats updated` on matching pin rows and rebuilds a summary page (boards, top pins, audience splits) under `NOTION_PARENT_PAGE_ID`. Idempotent — re-running updates in place and archives the old summary page for the same window.
- Pinterest's overview export gives **impressions only** at pin level; saves, pin clicks and outbound clicks exist only per board. Top Pins is capped at 50 rows and Top Boards at 6 months.
- Pins published before the pipeline have no Notion row, so `import-analytics.ts` creates one (`Source: backfill`) after reading the title and board off the public pin page — cached in `data/analytics/pin-lookup.json`. Their legacy boards are not in `schema.ts`'s `BOARDS`, so the board name goes in `Notes` rather than inventing select options.
- `ensureSchemaProperties()` in `notion.ts` adds any property present in `DB_PROPERTIES` but missing on the live DB (the same idea as `ensureStatusOptions`), so a new column in `schema.ts` reaches Notion on the next run.
- `src/status.ts` — the `clarity status` card: the acute Notion queues, the posting calendar, blog build drift, and open tasks read live out of `../CLARITY_PLAN.md`. Pure derivation is unit-tested; the async half shares one `listAllPins()` round trip with `queueHealth`. The relink counter reads `done` flags in `exports/relink-pins.json` — **anything that relinks pins must set them** or the number never moves. Surfaced to Claude as the `/clarity-status` skill.
- `src/queue.ts` — queue health. Runway is measured from `exports/packs/` directory names; the arithmetic half is pure and unit-tested. Drives `clarity queue` and the scheduled run.
- The hands-off pipeline milestone (M1): `src/packText.ts` (the post.txt writer + parser), `src/packs.ts` (the pack directory reader), `src/posted.ts` + `stages/posted.ts` (bookkeeping after one pin lands in Pinterest's scheduler, including the already-in-posted/ repair path and the Approved/Scheduled status guard), `src/postplan.ts` (the ordered post-plan, slot-aware of both pending and already-posted packs), `src/reconcile.ts` (diffing Pinterest's own pin lists against the packs on disk), `src/topics.ts` (suggested tagged topics for the pin builder), `src/rowForPack.ts` (the one PAGE:-id-first, slug-fallback lookup from a pack to its Notion row, shared by `posted`, `post-plan` and `status`), and `stages/ship.ts` (+ the `dist/.clarity-deployed` marker that lets a retry tell "built" from "actually deployed").
- `scripts/scheduled-run.ts` — the unattended job (`npm run generate`): checks queue health, exits without a single Claude call when the queue is healthy, otherwise runs ideas → draft → design → review and tees everything to `logs/`. **It never posts and never approves.** Install it with `powershell -ExecutionPolicy Bypass -File scripts/register-task.ps1` (Mon + Thu 02:00, current user; `-Unregister` removes it). Wakes the machine to run: this laptop is Modern Standby (S0) with wake timers **on for AC, off for battery**, so a plugged-in run fires at 02:00 and a battery run defers to the next logon via `StartWhenAvailable`.

## Environment (`.env`, git-ignored)

`NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID`, `NOTION_DB_ID` (set), `PINTEREST_APP_ID=1603049` (Trial pending), `PINTEREST_APP_SECRET`/`ACCESS_TOKEN` (Phase 4). No `ANTHROPIC_API_KEY` — see `src/claude.ts` above. Optional: `CLARITY_MODEL`, `CLAUDE_CLI`, `CLARITY_TIMEOUT_MS`.

## Content rules (from ../PINTEREST_RESEARCH.md — follow in generation code)

- 3–5 design variants per list; each is a "fresh pin". Cadence target 3 fresh pins/day; never the same URL twice within 72h.
- Pin titles keyword-led, <100 chars; descriptions 2–3 natural sentences + CTA; no hashtag walls. Main keyword must appear ON the image.
- Every list ends with an open slot ("#N — your turn, what would you add?").
- Affiliate pins (later): must disclose `#affiliate`/`#ad`, full URLs only, ~80/20 helpful-to-affiliate mix.
