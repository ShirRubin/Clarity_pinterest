// src/migrateScheduled.ts — the one-off decision behind scripts/migrate-scheduled.ts.
// Before milestone 1, `publish` marked a row Published the moment its packs were
// written. A Published row whose earliest posted pack is still in the future has
// not gone live: it is really Scheduled. Pure; the script does the I/O.
import type { PackInfo } from "./packs.js";
import { rowForPack } from "./rowForPack.js";

export interface MigrationRow {
  pageId: string;
  name: string;
  status?: string;
  scheduledDate?: string;
  source?: string;
}

export interface MigrationDecision {
  pageId: string;
  name: string;
  status: "Scheduled";
  scheduledDate: string;
}

export function migrationDecisions(rows: MigrationRow[], postedPacks: PackInfo[], today: string): MigrationDecision[] {
  // Earliest posted pack date per row.
  const earliest = new Map<string, string>();
  for (const p of postedPacks) {
    const r = rowForPack(p, rows);
    if (!r) continue;
    const cur = earliest.get(r.pageId);
    if (!cur || p.date < cur) earliest.set(r.pageId, p.date);
  }
  const out: MigrationDecision[] = [];
  for (const r of rows) {
    if (r.status !== "Published") continue;
    const first = earliest.get(r.pageId);
    if (!first) continue; // no pack on disk — nothing to say
    if (first < today) continue; // already live — Published is right
    out.push({ pageId: r.pageId, name: r.name, status: "Scheduled", scheduledDate: r.scheduledDate ?? first });
  }
  return out;
}
