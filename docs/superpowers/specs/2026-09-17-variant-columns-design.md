# Per-variant posting columns in Notion — design (2026-09-17)

## Problem

A list is one Notion row but four Pinterest pins (one per design template:
`classic-checklist`, `bold-panel`, `sticky-note`, `big-numbers`). Notion holds
only list-level state — `Status`, `Pin URL` (first live variant), `Scheduled
date` (earliest pack), and a `Notes` line per variant — while the per-variant
truth lives in pack files under `exports/posted/`. Two readers derive the same
fact from different sources, so the status card prints
"Notion says 4 lists scheduled, packs say 11 — run clarity reconcile" even when
nothing is wrong (a list with 2/4 variants posted and one already live is
`Published` in Notion but still has future packs on disk).

## Decision

Make Notion the source of truth per variant with **one date property per
template**. No status select per variant — the date *is* the status:

| Column value | Meaning |
|---|---|
| empty | variant not posted |
| date ≥ today | variant scheduled for that day |
| date < today | variant live since that day |

Property names are the template names (`classic-checklist`, `bold-panel`,
`sticky-note`, `big-numbers`), type `date`. A fifth (`video`) is added when the
video path ships (see `2026-09-17-video-pins-design.md`). The list of variant
columns is derived from the template registry, never hand-typed twice.

Kept as-is: `Scheduled date` (earliest of the four), `Pin URL` / `Pinterest pin
ID` (first live variant), `Notes` (per-variant pin URL lines). Adding four URL
columns was considered and rejected — eight extra columns for information
`Notes` already holds.

## Derived list status

- `Approved` with ≥1 column empty → card shows "n/4 posted" from the columns.
- `Scheduled` ⇔ all columns filled and none < today.
- `Published` ⇔ any column < today.
- The nightly flip (`publishedFlip`) reads the columns, not pack dates.
- The status card counts scheduled lists as rows with ≥1 column ≥ today, and
  the Notion-vs-packs warning is replaced by a packs-without-row check
  (a future pack whose row has no matching column value).

## Writers

- `clarity posted` writes the column for the variant it just posted (date of
  the pack), in the same update as today's `Notes` append.
- `clarity reconcile --apply` fills columns from Pinterest's own scheduled +
  created lists (template known from the pack name; date from
  `scheduled_ts` / `created_at`).
- `clarity uploaded` (CSV path, in progress in another session) writes the
  column from the CSV row's date.
- One-time backfill script: for every pack in `exports/posted/`, parse
  `<date>--<slug>--<template>` and set the row's column when empty.
- `ensureSchemaProperties()` adds the four properties to the live DB on first
  run (schema.ts `DB_PROPERTIES` gains them).

## Readers

- `pageToSummary` exposes `variants: Record<template, date | undefined>`.
- `status.ts`: posted-count, scheduled-lists and runway come from `variants`.
- `publishedFlip.ts`: flips when `min(variants) < today`.
- Review worker: untouched (it never reads posting state).

## Tests (TDD)

- `notionPage.test.ts`: variants parsed; missing columns → undefined.
- `posted.test.ts`: patch carries the variant's column; 4/4 → Scheduled.
- `publishedFlip.test.ts`: flips on earliest variant date only.
- `status.test.ts`: "2/4 posted" from columns; no false warning when a row is
  Published with future variants; warning fires for a future pack with no
  column value.
- `reconcile.test.ts`: column fill from Pinterest lists.

## Out of scope

Per-variant stats (needs the CSV importer to key on pin id per variant —
separate change once `clarity stats` lands).
