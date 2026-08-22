// Idea engine: generates trend-aware bucket-list ideas → Notion rows in status Idea.
import { generateJSON } from "../claude.js";
import { createPin, listAllPins } from "../notion.js";
import { BOARDS, THEMES, TRENDS, type Board } from "../schema.js";
import { BRAND_CONTEXT, SEO_RULES } from "../prompts.js";

interface IdeaOut {
  name: string;
  theme: string;
  trend: string;
  board: string;
  seasonWindow: string | null;
  rationale: string;
}

export async function runIdeas(count = 5): Promise<void> {
  console.log("Loading existing pins for dedupe...");
  const existing = await listAllPins();
  const existingNames = existing.map((p) => p.name).filter(Boolean);
  const boardCounts = existing.reduce<Record<string, number>>((acc, p) => {
    if (p.board) acc[p.board] = (acc[p.board] ?? 0) + 1;
    return acc;
  }, {});

  const today = new Date().toISOString().slice(0, 10);
  const system = `${BRAND_CONTEXT}\n\nYou are the idea engine of Clarity's content pipeline. You propose bucket-list ideas that people will SAVE — saves are Pinterest's #1 ranking signal.`;

  const user = `Today is ${today}. Pinterest users plan 45-60 days ahead, so seasonal ideas should target events 45-60 days out (set seasonWindow to the earliest sensible publish date, or null for evergreen).

Current board sizes (bigger = proven demand worth doubling down on): ${JSON.stringify(boardCounts)}

Every idea must be clearly different from ALL existing pins:
${existingNames.map((n) => `- ${n}`).join("\n")}

${SEO_RULES}

Propose exactly ${count} new bucket-list ideas. Mix: some riding a trend tag, some seasonal (45-60 day lead from today), some doubling down on proven boards. Each must have an obvious save-worthy hook.

Reply with ONLY a JSON array, each element:
{"name": "working title of the list", "theme": one of ${JSON.stringify(THEMES)}, "trend": one of ${JSON.stringify(TRENDS)}, "board": one of ${JSON.stringify(BOARDS)}, "seasonWindow": "YYYY-MM-DD" or null, "rationale": "one sentence on why this will get saves"}`;

  // Enums here mean the model can only return select values Notion already knows.
  const schema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        theme: { type: "string", enum: [...THEMES] },
        trend: { type: "string", enum: [...TRENDS] },
        board: { type: "string", enum: [...BOARDS] },
        seasonWindow: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
        rationale: { type: "string" },
      },
      required: ["name", "theme", "trend", "board", "seasonWindow", "rationale"],
      additionalProperties: false,
    },
    minItems: count,
    maxItems: count,
  };

  console.log(`Generating ${count} ideas...`);
  const ideas = await generateJSON<IdeaOut[]>(system, user, schema);

  let created = 0;
  for (const idea of ideas) {
    if (!idea.name || existingNames.some((n) => n.toLowerCase() === idea.name.toLowerCase())) continue;
    await createPin({
      name: idea.name,
      status: "Idea",
      source: "pipeline",
      theme: THEMES.includes(idea.theme as never) ? idea.theme : undefined,
      trend: TRENDS.includes(idea.trend as never) ? idea.trend : undefined,
      board: BOARDS.includes(idea.board as Board) ? (idea.board as Board) : undefined,
      seasonWindow: idea.seasonWindow ?? undefined,
      notes: idea.rationale,
    });
    created++;
    console.log(`+ Idea: ${idea.name} [${idea.board}]${idea.seasonWindow ? ` (season: ${idea.seasonWindow})` : ""}`);
  }
  console.log(`Done: ${created} new ideas in Notion (status Idea).`);
}
