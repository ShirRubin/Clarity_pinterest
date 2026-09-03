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
  ],
  Manifestation: [
    P("#E9E4F9", "#F6F3FD", "#7C5FC9", "#54408F", "#B3A3E3", "#9184B8", "#2A2340"), // lavender
    P("#F3E3F3", "#FAF1FA", "#B054AE", "#7E3A7C", "#D49AD2", "#AC87AA", "#342033"), // plum
    P("#E0EAF5", "#F0F5FB", "#5A7FB5", "#3E5A83", "#9DB8D9", "#8BA0BA", "#202934"), // moonstone blue
  ],
  Seasonal: [
    P("#F9EFDF", "#FDF8EE", "#C96F3B", "#934E24", "#E3A87C", "#B08A66", "#3B2A1C"), // cream terracotta
    P("#FAF3D9", "#FDFAEC", "#B8922A", "#82661C", "#DCC272", "#B3A26E", "#35301C"), // butter mustard
    P("#E9EEDF", "#F5F8EF", "#A85F32", "#7A4423", "#CBA486", "#9AA98B", "#2C3325"), // sage rust
  ],
  "It-girl / Aesthetic": [
    P("#FBE3EE", "#FEF4F9", "#DE5397", "#A33A70", "#F0A2C8", "#C58BA6", "#38222E"), // pink
    P("#FDE6DE", "#FEF4F0", "#E4694E", "#A84732", "#F2A794", "#C79484", "#3A241D"), // peachy coral
    P("#F6E3EA", "#FBF1F5", "#C4557E", "#8E3A59", "#DE9BB6", "#B98CA0", "#35202A"), // rose mauve
  ],
  Travel: [
    P("#D8F0E8", "#EFFAF5", "#2C9B80", "#1E6D5A", "#8FD0BE", "#7FAF9F", "#1D2F29"), // mint
    P("#DCEDF7", "#EFF8FC", "#337FAE", "#23597A", "#8FC2DD", "#7FA5BC", "#1D2C36"), // ocean
    P("#FBF0DC", "#FEF9EF", "#D89A3E", "#9C6D26", "#EBC488", "#BCA47A", "#362B18"), // sunny sand
  ],
  "Books & Learning": [
    P("#F3ECDF", "#FAF6EE", "#9A6B35", "#6E4A22", "#C9A97E", "#A98F6B", "#33291B"), // warm cream
    P("#E3EEE3", "#F2F8F2", "#4E8A57", "#35603C", "#97C29E", "#88A98D", "#22301F"), // library green
    P("#F6E5E3", "#FBF2F1", "#B05450", "#7E3A37", "#D69C99", "#B18985", "#34211F"), // burgundy blush
  ],
  "Creative projects": [
    P("#E4F3DC", "#F3FAEE", "#57A244", "#3B722E", "#9CCB8D", "#8BAF7E", "#243020"), // fresh green
    P("#DDF2F1", "#EFFAF9", "#2FA0A8", "#217175", "#8ED2D6", "#7EB0B3", "#1D2F30"), // aqua
    P("#F0E4F8", "#F8F1FC", "#9C5CC9", "#6E4090", "#C7A3E3", "#A78BB8", "#2C2135"), // orchid
  ],
  "Career & Skills": [
    P("#FDEBD7", "#FEF6EC", "#DE8B33", "#A2621F", "#EFB97F", "#BE9B72", "#37291A"), // peach
    P("#E0EDEA", "#F0F7F5", "#3D8F80", "#2A655A", "#93C4BA", "#83A8A0", "#1F2E2B"), // boardroom teal
    P("#E6E7F1", "#F2F3F8", "#6A6FB5", "#4A4E83", "#A9ACD9", "#9295BA", "#252634"), // slate iris
  ],
  "Luxury & Lifestyle": [
    P("#FBE9E4", "#FEF6F4", "#D57F70", "#9E574B", "#E8AFA5", "#C09287", "#39241F"), // blush
    P("#F6EEDC", "#FBF7EC", "#B99542", "#85691F", "#DCC684", "#B3A26E", "#33301C"), // champagne gold
    P("#EAE4F0", "#F5F2F8", "#8B6AA8", "#624A78", "#BBA3D0", "#A08BB0", "#2B2233"), // velvet lilac
  ],
};

// Subject palettes: when the list's SUBJECT beats its board for colour. A
// Christmas list living on the TV & Movie board is "Pop culture" by theme and
// came out sky blue; festive red-and-green is what a saver expects (user
// feedback 2026-09-02). Matched against the list name, first match wins.
const SUBJECT_PALETTES: [RegExp, Palette][] = [
  // Christmas: holly red title + pine green checkboxes on warm cream — red and
  // green without leaving the pastel-background brand.
  [/christmas|advent/i,
    P("#F7ECE6", "#FDF6F2", "#C4453A", "#8E2A22", "#E7A79C", "#4F7D57", "#2E2320")],
  // New Year: midnight indigo. Two earlier passes were rejected — champagne-gold
  // on cream read washed out, and the higher-contrast gold read "yellow orange"
  // (2026-09-02). Indigo keeps the midnight idea, clears both complaints, and
  // leaves the colour pop to the 🎉 decoration.
  [/new year|nye/i,
    P("#E8E7F1", "#F5F5FA", "#3D3F86", "#2A2B5E", "#A9AAD4", "#4A4C7A", "#211F30")],
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

// Per-run bookkeeping: same list name → same variant (both templates match);
// a DIFFERENT list hitting an already-used variant of the same theme is bumped
// to the next free one, so same-theme lists in a batch never look identical.
const assigned = new Map<string, number>(); // "theme|name" → variant index
const used = new Map<string, Set<number>>(); // theme → variant indexes taken

function variantIndex(themeKey: string, seed: string, count: number): number {
  const key = `${themeKey}|${seed}`;
  const prior = assigned.get(key);
  if (prior !== undefined) return prior;
  const taken = used.get(themeKey) ?? new Set<number>();
  let idx = hash(seed) % count;
  for (let i = 0; i < count && taken.has(idx); i++) idx = (idx + 1) % count;
  assigned.set(key, idx);
  taken.add(idx);
  used.set(themeKey, taken);
  return idx;
}

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
  [/christmas|advent/i, "🎄"],
  [/new year|nye/i, "🎉"],
  [/twilight|vampire/i, "🦇"],
  [/bridgerton|regency/i, "👑"],
  [/stargaz|astro|dark.?sky|galaxy/i, "🔭"],
  [/witch|spell|tarot/i, "🔮"],
  [/read|book|novel/i, "📚"],
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
