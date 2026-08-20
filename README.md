# Clarity Pinterest Pipeline

Automated content pipeline for [pinterest.com/ClarityBucketLists](https://www.pinterest.com/ClarityBucketLists/):
idea → bucket list → pin design → review queue → publish → stats, tracked in a Notion database.
Plan: `../CLARITY_PLAN.md` · Research: `../PINTEREST_RESEARCH.md`

## Setup

```bash
npm install
copy .env.example .env    # then fill it in (see below)
npm run setup-notion      # creates the "Clarity Pins" database in Notion
npm run backfill          # imports the existing live pins from data/backfill.json
```

### 1. Notion (5 minutes)

1. Go to https://www.notion.so/my-integrations → **New integration** (name it "Clarity Pipeline", any workspace icon).
2. Copy the **Internal Integration Secret** → put it in `.env` as `NOTION_TOKEN`.
3. In Notion, create (or pick) a page to hold the database, e.g. a page called **Clarity**.
4. On that page: **⋯ menu → Connections → Clarity Pipeline** (this gives the integration access).
5. Copy the page link; the 32-character id in the URL is `NOTION_PARENT_PAGE_ID`.
6. Run `npm run setup-notion` — it creates the **Clarity Pins** database and saves its id to `.env`.

### 2. Anthropic API key

From https://console.anthropic.com → API keys → put in `.env` as `ANTHROPIC_API_KEY`.
Used by the `ideas` and `draft` stages (Phase 1).

### 3. Pinterest developer app (Phase 4 — can wait, but start early: approval takes time)

1. Make sure the Pinterest account is a **business account** (free conversion in settings).
2. Go to https://developers.pinterest.com → **My apps** → create an app ("Clarity Pipeline").
3. Once approved you get **Trial access** (sandbox-only pins — fine for building).
4. Later: record a short demo video of the pipeline posting a pin → apply for **Standard access** → real publishing + analytics.
5. Put credentials in `.env` (`PINTEREST_APP_ID`, `PINTEREST_APP_SECRET`, `PINTEREST_ACCESS_TOKEN`).

## Commands

```bash
npm run clarity -- ideas     # generate bucket-list ideas (Phase 1)
npm run clarity -- draft     # write lists + SEO copy (Phase 1)
npm run clarity -- design    # render 3–5 pin variants per list (Phase 2)
npm run clarity -- review    # stage for the Notion review queue (Phase 3)
npm run clarity -- publish   # export packs / API posting (Phase 3/4)
npm run clarity -- stats     # sync pin analytics (Phase 4)
```

## Layout

```
src/schema.ts      Notion DB schema — single source of truth
src/notion.ts      Notion client + typed row accessors
src/cli.ts         command dispatch
src/stages/        one module per pipeline stage
src/render/        HTML→PNG pin renderer (Phase 2)
templates/         pin design templates, 1000×1500 (Phase 2)
scripts/           setup-notion, backfill-to-notion
data/backfill.json scraped live-pin catalog (input to backfill)
exports/           publish packs (git-ignored)
```
