// Copy stage — pin copy for rows that already have a list but no pin title:
// the backfill catalogue (2025 pins transcribed by `clarity blogpost`) on its
// way to four fresh variants. Writes pinTitle / pinDescription / altText /
// keywords in the Clarity voice under the same SEO rules as `draft`, and
// never touches the list items or the status.
import { generateJSON } from "../claude.js";
import { listAllPins, updatePin } from "../notion.js";
import { BRAND_CONTEXT, SEO_RULES, VOICE_EXAMPLE } from "../prompts.js";
import { needsCopy } from "../packRows.js";

interface CopyOut {
  pinTitle: string;
  pinDescription: string;
  altText: string;
  keywords: string[];
}

const COPY_SCHEMA = {
  type: "object",
  properties: {
    pinTitle: { type: "string", maxLength: 100 },
    pinDescription: { type: "string", maxLength: 500 },
    altText: { type: "string", maxLength: 160 },
    keywords: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 8 },
  },
  required: ["pinTitle", "pinDescription", "altText", "keywords"],
  additionalProperties: false,
};

export async function runCopy(limit = 100): Promise<void> {
  const rows = (await listAllPins()).filter(needsCopy);
  if (!rows.length) {
    console.log("Every row with a list already has pin copy.");
    return;
  }
  console.log(`Writing pin copy for ${Math.min(rows.length, limit)} of ${rows.length} rows…`);

  const system = `${BRAND_CONTEXT}\n\n${VOICE_EXAMPLE}\n\nYou are Clarity's pin copywriter. The list already exists; write the Pinterest copy that gets it saved.`;
  let done = 0;
  for (const row of rows.slice(0, limit)) {
    const user = `Write the Pinterest pin copy for this existing bucket list. Do NOT rewrite the list.
Title: ${row.name}
Board: ${row.board ?? "-"} · Theme: ${row.theme ?? "-"}
List items:
${row.listItems}

${SEO_RULES}

The pin image is a pastel checklist graphic showing the list title and the bold action heads — write altText describing THAT image.

Reply with ONLY a JSON object:
{"pinTitle": "40-60 chars, keyword in first 40", "pinDescription": "2-3 sentences + CTA, then 3-5 hashtags at the end", "altText": "80-140 chars describing the pin image", "keywords": ["...", ...]}`;
    try {
      const out = await generateJSON<CopyOut>(system, user, COPY_SCHEMA);
      await updatePin(row.pageId, {
        pinTitle: out.pinTitle.slice(0, 100),
        pinDescription: out.pinDescription,
        altText: out.altText?.slice(0, 160),
        keywords: (out.keywords ?? []).slice(0, 8).map((k) => k.slice(0, 100)),
      });
      done++;
      console.log(`✓ ${row.name.slice(0, 60)} → "${out.pinTitle.slice(0, 60)}"`);
    } catch (err) {
      console.error(`✗ ${row.name.slice(0, 60)}: ${(err as Error).message}`);
    }
  }
  console.log(`Copy stage done: ${done} row(s) written.`);
}
