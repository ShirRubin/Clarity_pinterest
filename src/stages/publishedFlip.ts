// Scheduled → Published for rows whose pins have all gone live. Date-based —
// no Pinterest call. Called by the nightly job after revise + generate.
import { pinsByStatus, updatePin } from "../notion.js";
import { publishedFlip, localToday } from "../publishedFlip.js";

/** Flips every qualifying row; returns how many were flipped. */
export async function runPublishedFlip(today: string = localToday()): Promise<number> {
  const rows = await pinsByStatus("Scheduled");
  const decisions = publishedFlip(rows, today);
  if (!decisions.length) {
    console.log(`No Scheduled rows dated before ${today} — nothing to flip.`);
    return 0;
  }
  const byId = new Map(rows.map((r) => [r.pageId, r]));
  for (const d of decisions) {
    await updatePin(d.pageId, { status: "Published", publishedDate: d.publishedDate });
    console.log(`✓ ${byId.get(d.pageId)?.name.slice(0, 60) ?? d.pageId} → Published (live since ${d.publishedDate})`);
  }
  return decisions.length;
}
