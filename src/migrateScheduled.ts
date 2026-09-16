// src/migrateScheduled.ts — reconcile each packed row's Status and Scheduled date with the packs on disk.
// Before milestone 1, `publish` marked rows Published at pack time. Tonight's re-dating moved 10 packs,
// so Notion dates can be stale. The packs on disk are the truth. Pure; the script does the I/O.
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
  from: string;
  status: "Published" | "Scheduled" | "Approved";
  scheduledDate: string;
  posted: number;
  total: number;
}

export function migrationDecisions(rows: MigrationRow[], posted: PackInfo[], pending: PackInfo[], today: string): MigrationDecision[] {
  // Group packs by row using rowForPack
  const postedByRow = new Map<string, PackInfo[]>();
  const pendingByRow = new Map<string, PackInfo[]>();

  for (const p of posted) {
    const r = rowForPack(p, rows);
    if (!r) continue;
    if (!postedByRow.has(r.pageId)) postedByRow.set(r.pageId, []);
    postedByRow.get(r.pageId)!.push(p);
  }

  for (const p of pending) {
    const r = rowForPack(p, rows);
    if (!r) continue;
    if (!pendingByRow.has(r.pageId)) pendingByRow.set(r.pageId, []);
    pendingByRow.get(r.pageId)!.push(p);
  }

  const decisions: MigrationDecision[] = [];

  for (const r of rows) {
    const pPosted = postedByRow.get(r.pageId) || [];
    const pPending = pendingByRow.get(r.pageId) || [];

    // Skip if no packs
    if (pPosted.length === 0 && pPending.length === 0) continue;

    // Skip if status not in [Published, Scheduled, Approved]
    if (!["Published", "Scheduled", "Approved"].includes(r.status || "")) continue;

    // Find earliest date across ALL packs
    let earliest: string | undefined = undefined;
    for (const p of [...pPosted, ...pPending]) {
      if (!earliest || p.date < earliest) earliest = p.date;
    }

    // Count distinct templates
    const postedTemplates = new Set(pPosted.map((p) => p.template));
    const pendingTemplates = new Set(pPending.map((p) => p.template));
    const allTemplates = new Set([...postedTemplates, ...pendingTemplates]);

    // Find earliest POSTED pack date
    let earliestPosted: string | undefined = undefined;
    for (const p of pPosted) {
      if (!earliestPosted || p.date < earliestPosted) earliestPosted = p.date;
    }

    // Determine new status
    let newStatus: "Published" | "Scheduled" | "Approved";
    if (earliestPosted && earliestPosted < today) {
      newStatus = "Published";
    } else if (pPending.length > 0) {
      newStatus = "Approved";
    } else {
      newStatus = "Scheduled";
    }

    // Only emit if status or scheduledDate changed
    if (newStatus !== (r.status || "") || earliest !== r.scheduledDate) {
      decisions.push({
        pageId: r.pageId,
        name: r.name,
        from: r.status || "?",
        status: newStatus,
        scheduledDate: earliest!,
        posted: postedTemplates.size,
        total: allTemplates.size,
      });
    }
  }

  return decisions;
}
