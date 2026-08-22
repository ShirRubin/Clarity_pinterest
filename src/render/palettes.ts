// Theme-driven palettes, derived from the live account's pins: every board runs
// pastel background + saturated accent + near-black text. Theme picks the palette
// (a seasonal list should look seasonal wherever it's boarded); board is fallback.

export interface Palette {
  bg: string; // page background (light pastel)
  bg2: string; // gradient partner / checkbox fill
  accent: string; // title + watermark
  accentDark: string; // darker accent for bold-panel titles
  accentSoft: string; // subtitle / flourish
  check: string; // checkbox border
  text: string; // list items (near-black, tinted toward the palette)
}

const PALETTES: Record<string, Palette> = {
  "Pop culture": {
    bg: "#D9EBFB", bg2: "#EFF7FE", accent: "#3E8DD6", accentDark: "#2A5F96",
    accentSoft: "#8FBFE8", check: "#7A93A8", text: "#1E2B38",
  },
  Manifestation: {
    bg: "#E9E4F9", bg2: "#F6F3FD", accent: "#7C5FC9", accentDark: "#54408F",
    accentSoft: "#B3A3E3", check: "#9184B8", text: "#2A2340",
  },
  Seasonal: {
    bg: "#F9EFDF", bg2: "#FDF8EE", accent: "#C96F3B", accentDark: "#934E24",
    accentSoft: "#E3A87C", check: "#B08A66", text: "#3B2A1C",
  },
  "It-girl / Aesthetic": {
    bg: "#FBE3EE", bg2: "#FEF4F9", accent: "#DE5397", accentDark: "#A33A70",
    accentSoft: "#F0A2C8", check: "#C58BA6", text: "#38222E",
  },
  Travel: {
    bg: "#D8F0E8", bg2: "#EFFAF5", accent: "#2C9B80", accentDark: "#1E6D5A",
    accentSoft: "#8FD0BE", check: "#7FAF9F", text: "#1D2F29",
  },
  "Books & Learning": {
    bg: "#F3ECDF", bg2: "#FAF6EE", accent: "#9A6B35", accentDark: "#6E4A22",
    accentSoft: "#C9A97E", check: "#A98F6B", text: "#33291B",
  },
  "Creative projects": {
    bg: "#E4F3DC", bg2: "#F3FAEE", accent: "#57A244", accentDark: "#3B722E",
    accentSoft: "#9CCB8D", check: "#8BAF7E", text: "#243020",
  },
  "Career & Skills": {
    bg: "#FDEBD7", bg2: "#FEF6EC", accent: "#DE8B33", accentDark: "#A2621F",
    accentSoft: "#EFB97F", check: "#BE9B72", text: "#37291A",
  },
  "Luxury & Lifestyle": {
    bg: "#FBE9E4", bg2: "#FEF6F4", accent: "#D57F70", accentDark: "#9E574B",
    accentSoft: "#E8AFA5", check: "#C09287", text: "#39241F",
  },
};

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

export function paletteFor(theme?: string, board?: string): Palette {
  if (theme && PALETTES[theme]) return PALETTES[theme];
  if (board && BOARD_FALLBACK[board]) return PALETTES[BOARD_FALLBACK[board]];
  return PALETTES["It-girl / Aesthetic"];
}

// Themed decoration emoji (rendered by Segoe UI Emoji in the template).
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

export function emojiFor(theme?: string, board?: string): string {
  if (theme && THEME_EMOJI[theme]) return THEME_EMOJI[theme];
  const t = board ? BOARD_FALLBACK[board] : undefined;
  return (t && THEME_EMOJI[t]) || "✨";
}
