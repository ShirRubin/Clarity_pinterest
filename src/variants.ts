// src/variants.ts — per-variant posting state, read from one Notion date column
// per template (the column is named after the template). Empty = not posted;
// a date today or later = scheduled; a date before today = live. Pure.
// Design: docs/superpowers/specs/2026-09-17-variant-columns-design.md
import { TEMPLATE_NAMES } from "./templates.js";
import { rowForPack } from "./rowForPack.js";

/** The Notion property names, one per template, in template order. */
export const VARIANT_COLUMNS = TEMPLATE_NAMES;

/** template → YYYY-MM-DD; only filled columns are present. */
export type Variants = Partial<Record<string, string>>;

export interface VariantSummary {
  posted: number;
  total: number;
  /** At least one variant dated today or later. */
  scheduled: boolean;
  /** At least one variant dated before today. */
  live: boolean;
  earliest?: string;
}

const known = (v: Variants): string[] =>
  VARIANT_COLUMNS.map((t) => v[t]).filter((d): d is string => typeof d === "string" && d.length > 0);

export function variantSummary(v: Variants, today: string): VariantSummary {
  const dates = known(v);
  return {
    posted: dates.length,
    total: VARIANT_COLUMNS.length,
    scheduled: dates.some((d) => d >= today),
    live: dates.some((d) => d < today),
    earliest: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : undefined,
  };
}

/** The list-level status the columns imply — undefined while any column is empty. */
export function listStatusFromVariants(v: Variants, today: string): "Scheduled" | "Published" | undefined {
  const s = variantSummary(v, today);
  if (s.posted < s.total) return undefined;
  return s.live ? "Published" : "Scheduled";
}

/** Rows with some, but not all, variant columns filled — the card's "n/4 posted" lines. */
export function partiallyPostedRows<R extends { name: string; variants?: Variants }>(
  rows: R[],
): { name: string; posted: number; total: number }[] {
  return rows.flatMap((r) => {
    const { posted, total } = variantSummary(r.variants ?? {}, "0000-00-00");
    return posted > 0 && posted < total ? [{ name: r.name, posted, total }] : [];
  });
}

type GapPack = { dir: string; date: string; slug: string; template: string; text: { pageId?: string } };
type GapRow = { pageId: string; name: string; source?: string; variants?: Variants };

/**
 * Posted packs dated today or later whose Notion row does not carry a date in
 * that pack's variant column (or has no row at all) — the bookkeeping
 * `clarity reconcile --apply` repairs. Past packs are ignored: old gaps are
 * history, not something to act on.
 */
export function variantGaps<P extends GapPack>(packs: P[], rows: GapRow[], today: string): P[] {
  return packs.filter((p) => {
    if (p.date < today) return false;
    const row = rowForPack(p, rows);
    return !row?.variants?.[p.template];
  });
}
