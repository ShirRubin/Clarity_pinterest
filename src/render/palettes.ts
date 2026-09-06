import fs from "node:fs";
import path from "node:path";

// Theme-driven palettes, derived from the live account's pins: pastel background +
// saturated accent + near-black text. Each theme has 3 in-brand variants; a list
// picks one deterministically from its name, and same-theme lists in one run are
// nudged apart so two pins never come out as twins. Emoji is subject-first (from
// the list name), theme fallback second — Twilight gets 🦇, not the generic 🎬.

export interface Palette {
  bg: string; // page background (light pastel)
  bg2: string; // gradient partner / checkbox fill
  accent: string; // title + watermark
  accentDark: string; // darker accent for bold-panel titles
  accentSoft: string; // subtitle / flourish
  check: string; // checkbox border
  text: string; // list items (near-black, tinted toward the palette)
}

const P = (
  bg: string, bg2: string, accent: string, accentDark: string,
  accentSoft: string, check: string, text: string,
): Palette => ({ bg, bg2, accent, accentDark, accentSoft, check, text });

const PALETTES: Record<string, Palette[]> = {
  "Pop culture": [
    P("#D9EBFB", "#EFF7FE", "#3E8DD6", "#2A5F96", "#8FBFE8", "#7A93A8", "#1E2B38"), // sky blue
    P("#E2E6FB", "#F1F3FE", "#5B6BD6", "#3E4A9E", "#A3ACE8", "#8C93BE", "#232842"), // periwinkle
    P("#FBE7E0", "#FEF5F1", "#DE6A4E", "#A24732", "#F0A896", "#C79484", "#3A231D"), // retro coral
    P("#DCF0E4", "#EFFAF3", "#349B6B", "#226B49", "#93D2B0", "#7FAF95", "#1D2F26"), // popcorn mint
    P("#EDE2F7", "#F8F1FC", "#8B54C4", "#62398B", "#C3A2DF", "#A38BB6", "#2A2135"), // vhs violet
    P("#FBE2E4", "#FEF3F4", "#D14A5B", "#96313F", "#EE9BA6", "#C08791", "#38202A"), // marquee red
  ],
  Manifestation: [
    P("#E9E4F9", "#F6F3FD", "#7C5FC9", "#54408F", "#B3A3E3", "#9184B8", "#2A2340"), // lavender
    P("#F3E3F3", "#FAF1FA", "#B054AE", "#7E3A7C", "#D49AD2", "#AC87AA", "#342033"), // plum
    P("#E0EAF5", "#F0F5FB", "#5A7FB5", "#3E5A83", "#9DB8D9", "#8BA0BA", "#202934"), // moonstone blue
    P("#F7E4EC", "#FDF2F6", "#C4568C", "#8D3A63", "#E29CBD", "#B78BA1", "#331F29"), // celestial rose
    P("#DEF0EF", "#EFFAF9", "#2F9A95", "#206B67", "#92D1CD", "#80AFAC", "#1D2E2D"), // aura teal
    P("#E1E8F6", "#F1F4FB", "#46639F", "#30456F", "#A2B6DA", "#8B9BB8", "#1F2733"), // starlit navy
  ],
  Seasonal: [
    P("#F9EFDF", "#FDF8EE", "#C96F3B", "#934E24", "#E3A87C", "#B08A66", "#3B2A1C"), // cream terracotta
    P("#FAF3D9", "#FDFAEC", "#B8922A", "#82661C", "#DCC272", "#B3A26E", "#35301C"), // butter mustard
    P("#E9EEDF", "#F5F8EF", "#A85F32", "#7A4423", "#CBA486", "#9AA98B", "#2C3325"), // sage rust
    P("#E3EFF6", "#F2F8FB", "#4C86A8", "#345D75", "#A3C8DC", "#8FA9B8", "#1E2C34"), // frost blue
    P("#F8E4E6", "#FDF2F3", "#B84557", "#832F3D", "#E39FA9", "#B98A92", "#342026"), // cranberry
    P("#E2EDE4", "#F1F8F2", "#3F8558", "#2B5C3C", "#99C7A8", "#86A891", "#1F2E24"), // evergreen
  ],
  "It-girl / Aesthetic": [
    P("#FBE3EE", "#FEF4F9", "#DE5397", "#A33A70", "#F0A2C8", "#C58BA6", "#38222E"), // pink
    P("#FDE6DE", "#FEF4F0", "#E4694E", "#A84732", "#F2A794", "#C79484", "#3A241D"), // peachy coral
    P("#F6E3EA", "#FBF1F5", "#C4557E", "#8E3A59", "#DE9BB6", "#B98CA0", "#35202A"), // rose mauve
    P("#FBF1D6", "#FEFAEF", "#C79A28", "#8E6D19", "#E5CC85", "#B8A473", "#33301B"), // butter yellow
    P("#E1EEFA", "#F1F8FD", "#4A8CC4", "#33628A", "#A3C8E6", "#8FAAC0", "#1E2B36"), // baby blue
    P("#E6EFE4", "#F3F8F2", "#62945B", "#44683F", "#ADCBA6", "#97B392", "#232E20"), // sage
  ],
  Travel: [
    P("#D8F0E8", "#EFFAF5", "#2C9B80", "#1E6D5A", "#8FD0BE", "#7FAF9F", "#1D2F29"), // mint
    P("#DCEDF7", "#EFF8FC", "#337FAE", "#23597A", "#8FC2DD", "#7FA5BC", "#1D2C36"), // ocean
    P("#FBF0DC", "#FEF9EF", "#D89A3E", "#9C6D26", "#EBC488", "#BCA47A", "#362B18"), // sunny sand
    P("#FAE7DC", "#FEF5F0", "#C86B3F", "#8F4A2A", "#EBAA85", "#BE9077", "#372419"), // terracotta road
    P("#E7E4F5", "#F5F3FB", "#6B5BBF", "#4A3F86", "#B0A5DF", "#9890B8", "#262238"), // alpine violet
    P("#E4EBEF", "#F3F7F9", "#4C7C93", "#345667", "#A6C4D1", "#92A9B4", "#1F2A31"), // harbour
  ],
  "Books & Learning": [
    P("#F3ECDF", "#FAF6EE", "#9A6B35", "#6E4A22", "#C9A97E", "#A98F6B", "#33291B"), // warm cream
    P("#E3EEE3", "#F2F8F2", "#4E8A57", "#35603C", "#97C29E", "#88A98D", "#22301F"), // library green
    P("#F6E5E3", "#FBF2F1", "#B05450", "#7E3A37", "#D69C99", "#B18985", "#34211F"), // burgundy blush
    P("#E3E8F2", "#F2F4FA", "#44598F", "#2F3E64", "#A2AFD0", "#8D97B2", "#1F2431"), // ink navy
    P("#EFE3EF", "#F9F2F9", "#8F5390", "#663A67", "#C89EC9", "#A888A9", "#2E2030"), // dusty plum
    P("#E8EEDE", "#F4F8EF", "#6E8F3E", "#4D652A", "#B7CD92", "#9EB183", "#262E1C"), // moss
  ],
  "Creative projects": [
    P("#E4F3DC", "#F3FAEE", "#57A244", "#3B722E", "#9CCB8D", "#8BAF7E", "#243020"), // fresh green
    P("#DDF2F1", "#EFFAF9", "#2FA0A8", "#217175", "#8ED2D6", "#7EB0B3", "#1D2F30"), // aqua
    P("#F0E4F8", "#F8F1FC", "#9C5CC9", "#6E4090", "#C7A3E3", "#A78BB8", "#2C2135"), // orchid
    P("#FDE9D9", "#FEF6F0", "#DB7C2E", "#9E571C", "#F0B282", "#C39670", "#372518"), // tangerine
    P("#DFE8FA", "#F0F4FD", "#3F6FD0", "#2C4E93", "#9DB8EC", "#8A9CC2", "#1E2739"), // cobalt
    P("#FBE2F0", "#FEF3F9", "#CE4E9B", "#93356F", "#EE9DCB", "#C186A9", "#351F2C"), // bubblegum
  ],
  "Career & Skills": [
    P("#FDEBD7", "#FEF6EC", "#DE8B33", "#A2621F", "#EFB97F", "#BE9B72", "#37291A"), // peach
    P("#E0EDEA", "#F0F7F5", "#3D8F80", "#2A655A", "#93C4BA", "#83A8A0", "#1F2E2B"), // boardroom teal
    P("#E6E7F1", "#F2F3F8", "#6A6FB5", "#4A4E83", "#A9ACD9", "#9295BA", "#252634"), // slate iris
    P("#F2E6E6", "#FAF3F3", "#A85E63", "#784146", "#D3A2A6", "#AE8B8E", "#2F2122"), // graphite rose
    P("#E1EDE3", "#F1F8F2", "#3E8552", "#2A5C39", "#98C6A4", "#86A98F", "#1F2E23"), // forest
    P("#E2EAF1", "#F2F6FA", "#46739B", "#30506D", "#A3BDD4", "#8FA5B7", "#1F2A33"), // denim
  ],
  "Luxury & Lifestyle": [
    P("#FBE9E4", "#FEF6F4", "#D57F70", "#9E574B", "#E8AFA5", "#C09287", "#39241F"), // blush
    P("#F6EEDC", "#FBF7EC", "#B99542", "#85691F", "#DCC684", "#B3A26E", "#33301C"), // champagne gold
    P("#EAE4F0", "#F5F2F8", "#8B6AA8", "#624A78", "#BBA3D0", "#A08BB0", "#2B2233"), // velvet lilac
    P("#E0EEE7", "#F1F9F5", "#2F8663", "#205D45", "#92C8B0", "#80A895", "#1D2D26"), // emerald
    P("#E3E7EF", "#F2F4F9", "#4A5A85", "#333F5D", "#A6B0CC", "#909AB0", "#1F2430"), // smoke navy
    P("#F4E3E5", "#FCF2F3", "#A34351", "#742F39", "#D69AA2", "#B0868C", "#31202A"), // burgundy
  ],
};

// Subject palettes: when the list's SUBJECT beats its board for colour. A
// Christmas list living on the TV & Movie board is "Pop culture" by theme and
// came out sky blue; festive red-and-green is what a saver expects (user
// feedback 2026-09-02). Matched against the list name, first match wins.
const SUBJECT_PALETTES: [RegExp, Palette][] = [
  // Christmas: holly red title + pine green checkboxes on warm cream — red and
  // green without leaving the pastel-background brand.
  [/christmas|\badvent\b/i,
    P("#F7ECE6", "#FDF6F2", "#C4453A", "#8E2A22", "#E7A79C", "#4F7D57", "#2E2320")],
  // New Year: midnight indigo. Two earlier passes were rejected — champagne-gold
  // on cream read washed out, and the higher-contrast gold read "yellow orange"
  // (2026-09-02). Indigo keeps the midnight idea, clears both complaints, and
  // leaves the colour pop to the 🎉 decoration.
  // Lunar New Year above the generic new-year rule: it was inheriting NYE's
  // midnight indigo and 🎉, so the two sat as twins in the queue. Lantern red
  // with a gold checkbox, still on a pastel ground.
  [/lunar new year|year of the/i,
    P("#FBE8E4", "#FEF4F2", "#C8433F", "#8E2C29", "#EDA9A5", "#C9A24E", "#33201E")],
  [/new year|nye/i,
    P("#E8E7F1", "#F5F5FA", "#3D3F86", "#2A2B5E", "#A9AAD4", "#4A4C7A", "#211F30")],
  // Northern lights: the Travel theme hashed this to "sunny sand", so an aurora
  // list came out warm gold (user feedback 2026-09-06). Aurora green title over
  // cool ice, indigo checkboxes for the night-sky half — the one place in the
  // set where a green accent sits on a violet-leaning background.
  [/northern lights|aurora/i,
    P("#E2E9F2", "#F2F6FA", "#1E8E77", "#14624F", "#8CC9B7", "#6E7FA8", "#1C2733")],
];

const BOARD_FALLBACK: Record<string, keyof typeof PALETTES> = {
  "TV & Movie Bucket Lists": "Pop culture",
  "Aesthetic Life Lists": "It-girl / Aesthetic",
  "Travel & Festivals": "Travel",
  "Books · Learning & Culture": "Books & Learning",
  "Smart & Creative Projects": "Creative projects",
  "Manifest & Magic Life": "Manifestation",
  "Luxury & Lifestyle": "Luxury & Lifestyle",
  "Career & Learn New Skills": "Career & Skills",
};

// FNV-1a — stable across runs so a list keeps its palette on re-render.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Variant bookkeeping. This used to be per-process, which meant it only ever
// deduped WITHIN one `clarity design` run — and lists are generated twice a
// week, so lists from different runs never saw each other and came out as
// twins (audit 2026-09-06: 10 groups shared an identical palette+emoji, five of
// them already live). The ledger persists assignments so every run sees what
// every earlier run took.
//
// Same list name → same variant forever (both templates match, and a re-render
// after a revise keeps the look). A DIFFERENT list is bumped to the first free
// variant of its theme; once a theme is exhausted it takes the LEAST-used one,
// so repeats spread evenly instead of piling onto the hash favourite.
const LEDGER_FILE = "data/variant-assignments.json";

function loadLedger(): Map<string, number> {
  try {
    const raw = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8")) as Record<string, number>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map(); // no ledger yet, or unreadable — start fresh
  }
}

const assigned = loadLedger(); // "theme|name" → variant index

function saveLedger(): void {
  try {
    fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
    const sorted = Object.fromEntries([...assigned].sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(LEDGER_FILE, `${JSON.stringify(sorted, null, 2)}
`);
  } catch (err) {
    // A design run that can't write the ledger is still worth finishing; the
    // next run just won't know what this one took.
    console.warn(`⚠ Could not write ${LEDGER_FILE}: ${(err as Error).message}`);
  }
}

/** How many lists already hold each variant of a theme, from the ledger. */
function usageCounts(themeKey: string, count: number): number[] {
  const counts = new Array<number>(count).fill(0);
  for (const [key, idx] of assigned) {
    if (key.slice(0, key.indexOf("|")) === themeKey && idx < count) counts[idx]++;
  }
  return counts;
}

function variantIndex(themeKey: string, seed: string, count: number): number {
  const key = `${themeKey}|${seed}`;
  const prior = assigned.get(key);
  if (prior !== undefined) return prior;

  const counts = usageCounts(themeKey, count);
  let idx = hash(seed) % count;
  if (counts[idx] > 0) {
    // Prefer a never-used variant, walking from the hash pick so the choice
    // still depends on the name; fall back to the least-used one.
    let found = -1;
    for (let i = 0; i < count; i++) {
      const candidate = (idx + i) % count;
      if (counts[candidate] === 0) {
        found = candidate;
        break;
      }
    }
    idx = found !== -1 ? found : counts.indexOf(Math.min(...counts));
  }

  assigned.set(key, idx);
  saveLedger();
  return idx;
}

/** Test seam: drop in-memory assignments (does not touch the ledger file). */
export function __resetAssignments(): void {
  assigned.clear();
}

/** Audit seam: the theme tables and the theme-resolution rule, for tooling that
 *  needs to map a rendered pin back to the variant index it used. */
export const PALETTES_FOR_AUDIT = PALETTES;
export const themeKeyForAudit = (theme?: string, board?: string): string => themeKey(theme, board);

function themeKey(theme?: string, board?: string): string {
  if (theme && PALETTES[theme]) return theme;
  if (board && BOARD_FALLBACK[board]) return BOARD_FALLBACK[board];
  return "It-girl / Aesthetic";
}

export function paletteFor(theme?: string, board?: string, seed = ""): Palette {
  const subject = SUBJECT_PALETTES.find(([re]) => re.test(seed));
  if (subject) return subject[1];
  const key = themeKey(theme, board);
  const variants = PALETTES[key];
  return variants[variantIndex(key, seed, variants.length)];
}

// Subject-specific emoji first — checked against the list NAME, in order.
// Concrete subjects (a fandom, an activity) outrank season words: "Autumn
// Reading" is a books list that happens to be autumnal, so it gets 📚 not 🍂.
const EMOJI_KEYWORDS: [RegExp, string][] = [
  // Christmas/New Year sit above the generic movie rule on purpose: a Christmas
  // movie list is a Christmas list first (user feedback 2026-09-02).
  [/christmas|\badvent\b/i, "🎄"],
  [/lunar new year|year of the/i, "🧧"],
  [/new year|nye/i, "🎉"],
  // Above the books rule on purpose: "12 Aurora Trips to Book" matched /book/ and
  // shipped a books pin for a travel list (user feedback 2026-09-06).
  [/northern lights|aurora/i, "🌌"],
  // Genre and subject rules, all ABOVE the generic ones below. The 2026-09-06
  // twin audit found 🎬 on six lists and 📚 on five, and two mis-fires where a
  // generic rule caught a substring: "Space Opera" hit /opera/ and wore theatre
  // masks on a sci-fi list, the way "trips to Book" hit /book/.
  [/sci.?fi|space opera|intergalactic|galactic/i, "🚀"],
  [/oscar|best picture|academy award/i, "🏆"],
  [/enemies.to.lovers|slow burn|rom.?com|romance/i, "💘"],
  [/a24|indie film/i, "🎞️"],
  [/one season|binge|shows/i, "📺"],
  [/dark academia|semester/i, "🎓"],
  [/mystery|whodunit|detective/i, "🔍"],
  [/zine|collage|scrapbook/i, "✂️"],
  [/nail|manicure/i, "💅"],
  [/scent|perfume|fragrance/i, "🌸"],
  [/outfit|wardrobe|coat/i, "🧥"],
  [/decor|maximalist|interior/i, "🛋️"],
  [/rail|train/i, "🚂"],
  [/solstice|candle/i, "🕯️"],
  [/hot spring|onsen|sauna/i, "♨️"],
  [/handmade|gift/i, "🎁"],
  [/phone.free|analog|detox/i, "📵"],
  [/pay ?rise|salary/i, "💰"],
  [/twilight|vampire/i, "🦇"],
  [/bridgerton|regency/i, "👑"],
  [/stargaz|astro|dark.?sky|galaxy/i, "🔭"],
  [/witch|spell|tarot/i, "🔮"],
  [/read|(?<!to )books?|novel/i, "📚"],
  [/opera|theatre|theater|ballet/i, "🎭"],
  [/\bai\b|robot/i, "🤖"],
  [/gummy|jelly|candy/i, "🍬"],
  [/coffee|caf[eé]/i, "☕"],
  [/music|playlist|concert/i, "🎶"],
  [/vision board|manifest/i, "✨"],
  [/money|wealth|invest/i, "💸"],
  [/movie|film|cinema|rewatch|netflix|series|tv\b/i, "🎬"],
  [/travel|trip|wander/i, "✈️"],
  [/halloween|spooky/i, "🎃"],
  [/winter|snow/i, "❄️"],
  [/christmas|holiday/i, "🎄"],
  [/october|autumn|fall\b/i, "🍂"],
  [/spring/i, "🌷"],
  [/summer|beach/i, "🌊"],
];

const THEME_EMOJI: Record<string, string> = {
  "Pop culture": "🎬",
  Manifestation: "✨",
  Seasonal: "🍂",
  "It-girl / Aesthetic": "🎀",
  Travel: "✈️",
  "Books & Learning": "📚",
  "Creative projects": "🎨",
  "Career & Skills": "💼",
  "Luxury & Lifestyle": "🥂",
};

export function emojiFor(theme?: string, board?: string, seed = ""): string {
  for (const [re, emoji] of EMOJI_KEYWORDS) {
    if (re.test(seed)) return emoji;
  }
  return THEME_EMOJI[themeKey(theme, board)];
}
