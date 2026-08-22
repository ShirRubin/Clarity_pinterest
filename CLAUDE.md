# CLAUDE.md — Clarity Pinterest Pipeline

Automated content pipeline for pinterest.com/ClarityBucketLists: idea → bucket list → pin design → Notion review queue → publish → stats. Part of the Clarity project — the master plan lives at `../CLARITY_PLAN.md` (check its Status section for current phase).

## Commands

```bash
npm run clarity -- <cmd>   # ideas | draft | design | review | publish | stats | run
npm run setup-notion       # one-time: creates the "Clarity Pins" DB (already done)
npm run backfill           # idempotent import of data/backfill.json into Notion
npx tsx scripts/parse-rss.ts   # rebuild data/backfill.json from data/rss/*.rss
npx tsc --noEmit           # typecheck (no test suite yet)
```

## Architecture

- **State machine**: the Notion `Status` select drives everything — `Idea → Drafted → Designed → In Review → Approved → Published` (+ `Rejected`, `Archived`). Each stage command picks up rows in its input status and advances them. The user's review = flipping `In Review` rows to `Approved`/`Rejected` in Notion.
- `src/schema.ts` — **single source of truth** for the DB schema, boards, themes, trends. Notion select options must not contain commas (the live board "Books, Learning & Culture" is stored as "Books · Learning & Culture").
- `src/notion.ts` — client + typed `PinRow` accessors (`createPin`, `listPinsByStatus`).
- `src/stages/*.ts` — one module per stage.
- `src/claude.ts` — **generation runs on the Claude Code CLI, not the Anthropic SDK.** It spawns `claude -p --output-format json --system-prompt … --json-schema …`, which authenticates with the user's Claude Max subscription, so no `ANTHROPIC_API_KEY` is needed and generation costs nothing beyond the subscription. Two constraints worth remembering: `--json-schema` requires a top-level **object**, so array results are wrapped in `{"result": …}` and unwrapped in `generateJSON`; and never pass `--bare`, which forces API-key auth and ignores the OAuth login.
- `src/render/` + `templates/` — HTML→PNG pin renderer, 1000×1500, 3–5 template variants per list (Phase 2).
- `data/backfill.json` — the 60 pins scraped from the live profile (via board RSS feeds; logged-out board pages hide pin links, RSS is the reliable source: `https://www.pinterest.com/claritybucketlists/<board-slug>.rss`).
- `exports/` — publish packs (git-ignored), Stage A posting until Pinterest API Standard access.

## Environment (`.env`, git-ignored)

`NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID`, `NOTION_DB_ID` (set), `PINTEREST_APP_ID=1603049` (Trial pending), `PINTEREST_APP_SECRET`/`ACCESS_TOKEN` (Phase 4). No `ANTHROPIC_API_KEY` — see `src/claude.ts` above. Optional: `CLARITY_MODEL`, `CLAUDE_CLI`, `CLARITY_TIMEOUT_MS`.

## Content rules (from ../PINTEREST_RESEARCH.md — follow in generation code)

- 3–5 design variants per list; each is a "fresh pin". Cadence target 3 fresh pins/day; never the same URL twice within 72h.
- Pin titles keyword-led, <100 chars; descriptions 2–3 natural sentences + CTA; no hashtag walls. Main keyword must appear ON the image.
- Every list ends with an open slot ("#N — your turn, what would you add?").
- Affiliate pins (later): must disclose `#affiliate`/`#ad`, full URLs only, ~80/20 helpful-to-affiliate mix.
