// List writer: Idea → Drafted. Writes the bucket list + Pinterest SEO copy in the Clarity voice.
import { generateJSON } from "../claude.js";
import { pinsByStatus, updatePin } from "../notion.js";
import { BRAND_CONTEXT, SEO_RULES, VOICE_EXAMPLE } from "../prompts.js";

interface DraftOut {
  listItems: string[];
  pinTitle: string;
  pinDescription: string;
  keywords: string[];
}

export async function runDraft(limit = 10): Promise<void> {
  const ideas = await pinsByStatus("Idea");
  if (!ideas.length) {
    console.log("No rows in status Idea — run `clarity ideas` first.");
    return;
  }
  console.log(`Drafting ${Math.min(ideas.length, limit)} of ${ideas.length} ideas...`);

  const system = `${BRAND_CONTEXT}\n\n${VOICE_EXAMPLE}\n\nYou are Clarity's list writer. Write bucket lists people save and come back to.`;

  for (const idea of ideas.slice(0, limit)) {
    const user = `Write the full content for this bucket list:
Title: ${idea.name}
Theme: ${idea.theme ?? "-"} · Trend: ${idea.trend ?? "-"} · Board: ${idea.board ?? "-"}

Requirements:
- 10-15 list items in the Clarity voice: each item is "**Short bold action** — one or two specific, doable sentences."
- The FINAL item is the open slot: "#<n> — your turn. What would you add?" (comment bait, always last).
${SEO_RULES}

Reply with ONLY a JSON object:
{"listItems": ["**...** — ...", ...], "pinTitle": "<100 chars, keyword-led", "pinDescription": "2-3 sentences + CTA", "keywords": ["...", ...]}`;

    try {
      const draft = await generateJSON<DraftOut>(system, user);
      const title = draft.pinTitle?.slice(0, 100) ?? idea.name;
      await updatePin(idea.pageId, {
        status: "Drafted",
        listItems: draft.listItems.map((item, i) => `${i + 1}. ${item}`).join("\n"),
        pinTitle: title,
        pinDescription: draft.pinDescription,
        keywords: (draft.keywords ?? []).slice(0, 8).map((k) => k.slice(0, 100)),
      });
      console.log(`✓ Drafted: ${title}`);
    } catch (err) {
      console.error(`✗ Failed to draft "${idea.name}": ${(err as Error).message}`);
    }
  }
  console.log("Draft stage done.");
}
