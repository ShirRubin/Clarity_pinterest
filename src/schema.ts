// Single source of truth for the "Clarity Pins" Notion database schema.
// setup-notion.ts creates the DB from this; notion.ts reads/writes through it.
import { TEMPLATE_NAMES, type TemplateName } from "./templates.js";

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
export type Status = (typeof STATUSES)[number];

export const BOARDS = [
  // 19 public boards on Pinterest since 2026-09-16 (see CLARITY_PLAN.md §1.6).
  // Notion select options forbid commas, so "Books, Learning & Culture" is
  // spelled with "·" here and mapped back in PINTEREST_BOARD_NAMES.
  "TV & Movie Bucket Lists",
  "Movie Bucket Lists",
  "Aesthetic Life Bucket Lists",
  "Self Care Bucket Lists",
  "Glow Up & That Girl Era Bucket Lists",
  "Digital Detox & Slow Living Bucket Lists",
  "Manifestation Bucket Lists & Rituals",
  "Luxury Lifestyle Bucket Lists",
  "Travel & Festivals",
  "Fall Bucket Lists",
  "Christmas & Winter Bucket Lists",
  "Party & Celebration Bucket Lists",
  "Family & Friends Bucket Lists",
  "Food & Drink Bucket Lists",
  "Books · Learning & Culture",
  "Music Concerts & Theatre Bucket Lists",
  "Creative Hobby Bucket Lists",
  "Career & Learn New Skills",
  "Coding & Tech Skills Bucket Lists",
] as const;
export type Board = (typeof BOARDS)[number];

// The board title exactly as Pinterest's pin builder shows it. Notion select
// options forbid commas, so the one board with a comma is spelled with "·" in
// Notion and mapped back here for the browser step.
export const PINTEREST_BOARD_NAMES: Record<Board, string> = Object.fromEntries(
  BOARDS.map((b) => [b, b === "Books · Learning & Culture" ? "Books, Learning & Culture" : b]),
) as Record<Board, string>;

export const THEMES = [
  "Pop culture",
  "Manifestation",
  "Seasonal",
  "It-girl / Aesthetic",
  "Travel",
  "Books & Learning",
  "Creative projects",
  "Career & Skills",
  "Luxury & Lifestyle",
] as const;

// Pinterest Predicts 2026 waves + evergreen. Extend as new trends emerge.
export const TRENDS = [
  "Evergreen",
  "Escapism",
  "Self-preservation",
  "Nonconformity",
  "Opera aesthetic",
  "Intergalactic style",
  "Gummy / Maximalism",
  "Seasonal",
] as const;

export const SOURCES = ["pipeline", "backfill"] as const;

export const DB_TITLE = "Clarity Pins";

const VARIANT_DATE_PROPERTIES = Object.fromEntries(TEMPLATE_NAMES.map((t) => [t, { date: {} }])) as Record<
  TemplateName,
  { date: Record<string, never> }
>;

// Notion API property definitions for database creation.
export const DB_PROPERTIES = {
  Name: { title: {} },
  Status: {
    select: { options: STATUSES.map((name) => ({ name })) },
  },
  Theme: {
    select: { options: THEMES.map((name) => ({ name })) },
  },
  Trend: {
    select: { options: TRENDS.map((name) => ({ name })) },
  },
  Board: {
    select: { options: BOARDS.map((name) => ({ name })) },
  },
  Source: {
    select: { options: SOURCES.map((name) => ({ name })) },
  },
  "List items": { rich_text: {} },
  "Pin title": { rich_text: {} },
  "Pin description": { rich_text: {} },
  "Alt text": { rich_text: {} },
  Keywords: { multi_select: { options: [] as { name: string }[] } },
  "Pin image": { files: {} },
  "Canva link": { url: {} },
  "Destination link": { url: {} },
  "Pin URL": { url: {} },
  "Pinterest pin ID": { rich_text: {} },
  "Published date": { date: {} },
  "Scheduled date": { date: {} },
  "Season window": { date: {} },
  Impressions: { number: {} },
  Saves: { number: {} },
  Clicks: { number: {} },
  // Set by scripts/import-analytics.ts — the end date of the CSV window the
  // numbers above came from, so a stale row is obvious at a glance.
  "Stats updated": { date: {} },
  Notes: { rich_text: {} },
  // One date per design template — the variant's posting date (empty = not
  // posted, future = scheduled, past = live). See src/variants.ts.
  ...VARIANT_DATE_PROPERTIES,
} as const;
