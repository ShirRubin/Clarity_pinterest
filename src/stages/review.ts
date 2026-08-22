// Review stage: Designed → In Review. Stages rows for the user's daily Notion
// pass (flip Status to Approved or Rejected there) and prints what's waiting.
import { pinsByStatus, updatePin } from "../notion.js";

const notionUrl = (pageId: string) => `https://www.notion.so/${pageId.replace(/-/g, "")}`;

export async function runReview(limit = 50): Promise<void> {
  const designed = await pinsByStatus("Designed");
  if (!designed.length) {
    console.log("No rows in status Designed — run `clarity design` first.");
  }
  let moved = 0;
  for (const row of designed.slice(0, limit)) {
    await updatePin(row.pageId, { status: "In Review" });
    moved++;
    console.log(`→ In Review: ${row.name}`);
  }

  const waiting = await pinsByStatus("In Review");
  if (waiting.length) {
    console.log(`\n${moved} staged now, ${waiting.length} total waiting for review.`);
    console.log("Open Notion, check each row's Pin image + title + description, and flip");
    console.log("Status to Approved (or Rejected, with a word in Notes on why):");
    for (const row of waiting) console.log(`  • ${row.name.slice(0, 70)}\n    ${notionUrl(row.pageId)}`);
  }
}
