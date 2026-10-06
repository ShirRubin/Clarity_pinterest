// Idea engine: generates trend-aware bucket-list ideas → Notion rows in status Idea.
import { generateJSON } from "../claude.js";
import { createPin, listAllPins } from "../notion.js";
import { BOARDS, THEMES, TRENDS, type Board } from "../schema.js";
import { BRAND_CONTEXT, SEO_RULES } from "../prompts.js";
import { loadTrends, formatForPrompt, isStale, cacheAgeDays, STALE_AFTER_DAYS } from "../trends.js";
import { bucketListRows } from "./trends.js";
import { formatDemandTargets, pickTargets } from "../demandTargets.js";
import { DO_NOT_GENERATE, IDEA_BOARDS } from "../prompts.js";
import { listPinsWithMetrics } from "../pinterestApi.js";
import { readPacks } from "../packs.js";
import { formatWinners, matchOrigins, winners } from "../report.js";

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

  // Real Pinterest search volume for Clarity's own vocabulary, pulled by hand into
  // data/trends.json (see scripts/refresh-trends.ts). It steers the ideas toward
  // measured demand instead of the static TRENDS tags, which are only labels.
  // The nightly job cannot refresh it — Pinterest Trends needs a logged-in browser
  // — so a stale or missing cache warns loudly and generation carries on rather
  // than stopping the queue.
  const trends = await loadTrends();
  if (!trends) {
    console.warn(`! No data/trends.json — ideas will fall back to the static trend tags.`);
    console.warn(`  Refresh it with: npx tsx scripts/refresh-trends.ts --snippet`);
  } else if (isStale(trends, today)) {
    console.warn(`! data/trends.json is ${cacheAgeDays(trends, today)} days old (stale after ${STALE_AFTER_DAYS}).`);
    console.warn(`  Refresh it with: npx tsx scripts/refresh-trends.ts --snippet`);
  } else {
    console.log(`Pinterest demand data: ${trends.terms.length} terms, through ${trends.dataDate}.`);
  }
  const demandBlock = formatForPrompt(trends, today);

  // The searches the blog does not answer yet, live from Pinterest's trends
  // API (print-only, never stored). The API is read-only and on Trial; if it
  // is down or the token lapsed, generation carries on with the cache alone.
  let targetsBlock = "";
  try {
    const targets = pickTargets(await bucketListRows());
    targetsBlock = formatDemandTargets(targets, count);
    console.log(`Pinterest search gaps: ${targets.length} "bucket list" searches with no post yet.`);
  } catch (err) {
    console.warn(`! Could not read Pinterest trends (${(err as Error).message}) — ideas use the demand cache only.`);
  }

  // What already earns saves here, read live from the API and used once in
  // the prompt (never stored, same rule as `clarity report`). ~3 API calls.
  let winnersBlock = "";
  try {
    const [apiPins, posted] = await Promise.all([listPinsWithMetrics(), readPacks("posted")]);
    const origins = matchOrigins(apiPins, posted.map((p) => ({ template: p.template, slug: p.slug, title: p.text.title, date: p.date, pinId: p.text.posted?.pinId })));
    const w = winners(apiPins, origins, today, 14);
    winnersBlock = formatWinners(w);
    console.log(`Account winners: ${w.length} mature pipeline pins with 100+ impressions.`);
  } catch (err) {
    console.warn(`! Could not read pin stats (${(err as Error).message}) — ideas run without the winners block.`);
  }

  // Boards with the fewest lists are where a new list is most visible; the
  // two dead boards (see DO_NOT_GENERATE) are not offered at all.
  const boardLine = IDEA_BOARDS.map((b) => `${b}: ${boardCounts[b] ?? 0}`).join(" · ");

  const system = `${BRAND_CONTEXT}\n\nYou are the idea engine of Clarity's content pipeline. You propose bucket-list ideas that people will SAVE — saves are Pinterest's #1 ranking signal.`;

  const user = `Today is ${today}. Pinterest users plan 45-60 days ahead, so seasonal ideas should target events 45-60 days out (set seasonWindow to the earliest sensible publish date, or null for evergreen).

${targetsBlock}

${winnersBlock}

${demandBlock}

Lists per board today (prefer the boards with the FEWEST lists; never more than one idea per board in this run): ${boardLine}

${DO_NOT_GENERATE}

Every idea must be clearly different from ALL existing pins:
${existingNames.map((n) => `- ${n}`).join("\n")}

${SEO_RULES}

Propose exactly ${count} new bucket-list ideas. Each title carries a phrase people actually type into Pinterest search (a head term like "winter bucket list", "christmas bucket list ideas", "couples bucket list", "travel bucket list", "bucket list for college students"), a number, and a hook that makes it worth saving. Seasonal ideas lead the holiday by 45-60 days.
${demandBlock ? `\nGround the rest in the demand data above: map onto a rising, peaking or steady term, and let the phrase read naturally in the title. A natural title beats a keyword-stuffed one.` : ""}

Reply with ONLY a JSON array, each element:
{"name": "working title of the list", "theme": one of ${JSON.stringify(THEMES)}, "trend": one of ${JSON.stringify(TRENDS)}, "board": one of ${JSON.stringify(IDEA_BOARDS)}, "seasonWindow": "YYYY-MM-DD" or null, "rationale": "one sentence on why this will get saves"}`;

  // Enums here mean the model can only return select values Notion already knows.
  const schema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        theme: { type: "string", enum: [...THEMES] },
        trend: { type: "string", enum: [...TRENDS] },
        board: { type: "string", enum: [...IDEA_BOARDS] },
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
