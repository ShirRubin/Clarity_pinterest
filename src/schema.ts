// Single source of truth for the "Clarity Pins" Notion database schema.
// setup-notion.ts creates the DB from this; notion.ts reads/writes through it.

export const STATUSES = [
  "Idea",
  "Drafted",
  "Designed",
  "In Review",
  "Approved",
  "Published",
  "Rejected",
  "Archived",
] as const;
export type Status = (typeof STATUSES)[number];

export const BOARDS = [
  "TV & Movie Bucket Lists",
  "Aesthetic Life Lists",
  "Travel & Festivals",
  // Live Pinterest board is "Books, Learning & Culture" — Notion select options forbid commas.
  "Books · Learning & Culture",
  "Smart & Creative Projects",
  "Manifest & Magic Life",
  "Luxury & Lifestyle",
  "Career & Learn New Skills",
] as const;
export type Board = (typeof BOARDS)[number];

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
  Template: { select: { options: [] as { name: string }[] } },
  "List items": { rich_text: {} },
  "Pin title": { rich_text: {} },
  "Pin description": { rich_text: {} },
  Keywords: { multi_select: { options: [] as { name: string }[] } },
  "Pin image": { files: {} },
  "Canva link": { url: {} },
  "Destination link": { url: {} },
  "Pin URL": { url: {} },
  "Pinterest pin ID": { rich_text: {} },
  "Published date": { date: {} },
  "Season window": { date: {} },
  Impressions: { number: {} },
  Saves: { number: {} },
  Clicks: { number: {} },
  Notes: { rich_text: {} },
} as const;
