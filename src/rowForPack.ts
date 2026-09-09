// src/rowForPack.ts — the one Notion row a pack belongs to. A PAGE: line in
// post.txt (added by `pack` for anything written after this milestone) wins;
// older packs fall back to matching the slug against non-backfill rows, since
// backfill rows (imported from Pinterest's own history) never had a pack.
import type { PinSummary } from "./notion.js";
import { slugify } from "./destination.js";

type Row = Pick<PinSummary, "pageId" | "name" | "source">;

export function rowForPack<R extends Row>(
  pack: { text: { pageId?: string }; slug: string },
  rows: R[],
): R | undefined {
  if (pack.text.pageId) return rows.find((r) => r.pageId === pack.text.pageId);
  return rows.find((r) => r.source !== "backfill" && slugify(r.name) === pack.slug);
}
