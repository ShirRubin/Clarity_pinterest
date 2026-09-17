// src/packRows.ts — which rows `clarity pack` writes packs for, and which of a
// row's variants still need one. Pure; stages/pack.ts does the I/O.
//
// A pack is one variant PNG with its copy, dated for posting. Any row whose
// list is approved for Pinterest qualifies — Approved, and also Scheduled or
// Published rows, because a variant that has never been posted is a fresh pin
// however old its siblings are. That is what brings the two-template-era
// lists and the 2025 backfill catalogue up to four pins each.
import { TEMPLATE_NAMES } from "./templates.js";
import { slugify } from "./destination.js";
import type { Variants } from "./variants.js";

const PACKABLE = new Set(["Approved", "Scheduled", "Published"]);

type Row = { name: string; source?: string; status?: string; listItems?: string; pinTitle?: string; variants?: Variants };

export function packCandidate(row: Row): boolean {
  return !!row.listItems && !!row.pinTitle && row.status !== undefined && PACKABLE.has(row.status);
}

/**
 * Templates with neither a pack on disk (`<slug>--<template>` in packs/ or
 * posted/) nor a date in the row's variant column — a column date means the
 * pin is on Pinterest even when its pack predates the bookkeeping.
 */
export function unpackedTemplates(row: Row, packedOnDisk: Set<string>): string[] {
  const slug = slugify(row.name);
  return TEMPLATE_NAMES.filter((t) => !packedOnDisk.has(`${slug}--${t}`) && !row.variants?.[t]);
}

/** Rows that have a list but no pin copy yet — `clarity copy` writes it. */
export function needsCopy(row: Row): boolean {
  return !!row.listItems && !row.pinTitle && row.status !== "Rejected" && row.status !== "Archived";
}
