// HTML→PNG pin renderer. Fills a template with a drafted list and screenshots it
// with the system's installed Chrome (playwright-core + channel, no browser download).
// Output: 2000×3000 PNG (2:3 at 2x for crispness; Pinterest's recommended ratio).
import { chromium, type Browser } from "playwright-core";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { paletteFor, emojiFor } from "./palettes.js";

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "templates");

// "soft-editorial" (serif) existed briefly — user rejected it on the Phase 2 pilot.
export const TEMPLATE_NAMES = ["classic-checklist", "bold-panel"] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export interface PinContent {
  name: string; // row name, e.g. "Slow October Bucket List: 15 Cozy Sunday Rituals…"
  listItems: string; // the numbered "1. **Head** — detail" text from Notion
  theme?: string;
  board?: string;
}

/** "Winter Arc Bucket List: 15 Rituals…" → "WINTER ARC" (the searched keyword, big on the image). */
export function titleMain(name: string): string {
  let t = name.split(":")[0].trim();
  // Strip trailing "Bucket List" or bare "List" — the template adds its own subtitle.
  t = t.replace(/\s*(bucket\s+)?list\s*$/i, "").trim();
  t = t.replace(/^the\s+/i, "").trim();
  return t || name;
}

interface ParsedItems {
  heads: string[];
  openSlot: string;
}

/** Pull the bold action heads out of "1. **Head** — detail" lines; last non-bold line is the open slot. */
export function parseListItems(listItems: string): ParsedItems {
  const heads: string[] = [];
  let openSlot = "Your turn — what would you add?";
  for (const line of listItems.split("\n")) {
    const body = line.replace(/^\s*\d+\.\s*/, "").trim();
    if (!body) continue;
    const bold = /^\*\*(.+?)\*\*/.exec(body);
    // The open slot is the open slot whether or not the model bolded it.
    if (/your turn/i.test(body)) {
      openSlot = (bold ? body.replace(/\*\*/g, "") : body)
        .replace(/^#?\d*\s*[—–-]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
    } else if (bold) {
      heads.push(bold[1].replace(/[.!]\s*$/, ""));
    }
  }
  return { heads, openSlot };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fillTemplate(html: string, content: PinContent): string {
  const { heads, openSlot } = parseListItems(content.listItems);
  // Seeded by name: each list gets its own palette variant + subject emoji,
  // stable across re-renders and identical across a list's own templates.
  const pal = paletteFor(content.theme, content.board, content.name);
  const emoji = emojiFor(content.theme, content.board, content.name);
  const main = titleMain(content.name);

  // Long titles shrink so they never wrap past two lines.
  const titleSize = main.length <= 12 ? 96 : main.length <= 20 ? 78 : 62;

  const itemsHtml = [
    ...heads.map(
      (h) => `<li><span class="box"></span><span class="item-text">${esc(h)}</span></li>`,
    ),
    `<li class="open-slot"><span class="item-text">💬 ${esc(openSlot)}</span></li>`,
  ].join("\n      ");

  return html
    .replaceAll("{{TITLE_MAIN}}", esc(main))
    .replaceAll("{{TITLE_SIZE}}", String(titleSize))
    .replaceAll("{{ITEMS}}", itemsHtml)
    .replaceAll("{{EMOJI}}", emoji)
    .replaceAll("{{BG}}", pal.bg)
    .replaceAll("{{BG2}}", pal.bg2)
    .replaceAll("{{ACCENT}}", pal.accent)
    .replaceAll("{{ACCENT_DARK}}", pal.accentDark)
    .replaceAll("{{ACCENT_SOFT}}", pal.accentSoft)
    .replaceAll("{{CHECK}}", pal.check)
    .replaceAll("{{TEXT}}", pal.text);
}

async function launch(): Promise<Browser> {
  // System Chrome first; Edge ships with Windows as the guaranteed fallback.
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launch({ channel });
    } catch {
      /* try next */
    }
  }
  throw new Error("Neither Chrome nor Edge could be launched — install one, or `npx playwright install chromium`.");
}

/** Render one list through one template. Returns the written PNG path. */
export async function renderPin(
  content: PinContent,
  template: TemplateName,
  outPath: string,
  browser?: Browser,
): Promise<string> {
  const own = !browser;
  const b = browser ?? (await launch());
  // The filled HTML sits next to the templates so relative font URLs resolve.
  const tmp = path.join(TEMPLATES_DIR, `.tmp-${process.pid}-${template}.html`);
  try {
    const raw = await readFile(path.join(TEMPLATES_DIR, `${template}.html`), "utf8");
    await writeFile(tmp, fillTemplate(raw, content), "utf8");
    const page = await b.newPage({ viewport: { width: 1000, height: 1500 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
    await mkdir(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, type: "png" });
    await page.close();
    return outPath;
  } finally {
    await unlink(tmp).catch(() => {});
    if (own) await b.close();
  }
}

export { launch as launchBrowser };
