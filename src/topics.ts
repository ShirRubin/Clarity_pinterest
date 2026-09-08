// candidates for the pin builder's 10 tagged topics. Pinterest's
// taxonomy has no "bucket list"/"self care": concrete nouns from the items plus
// a few vibe words per theme work best (learned on the first live pin).
const VIBES: Record<string, string[]> = {
  "Pop culture": ["movie night", "tv shows", "fandom"],
  Manifestation: ["manifestation", "vision board", "journaling"],
  Seasonal: ["cozy living", "autumn day", "holiday season"],
  "It-girl / Aesthetic": ["it girl", "aesthetic", "glow up"],
  Travel: ["travel", "adventure", "weekend trip"],
  "Books & Learning": ["reading", "book club", "learning"],
  "Creative projects": ["diy", "crafts", "handmade"],
  "Career & Skills": ["career", "productivity", "skills"],
  "Luxury & Lifestyle": ["luxury lifestyle", "fine dining", "self care"],
};

const OPEN_SLOT = /your turn|what would you add/i;

export function suggestTopics(listItems: string, theme?: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim().toLowerCase();
    if (v && !out.includes(v) && out.length < 10) out.push(v);
  };
  for (const line of listItems.split(/\r?\n/)) {
    if (OPEN_SLOT.test(line)) continue;
    const head = /\*\*(.+?)\*\*/.exec(line)?.[1] ?? line.replace(/^\s*\d+[.)]\s*/, "").split(/[—–-]{1,2}\s/)[0];
    const words = head.replace(/[^\p{L}\p{N}\s-]/gu, "").trim().split(/\s+/).slice(0, 2).join(" ");
    push(words);
  }
  for (const v of VIBES[theme ?? ""] ?? []) push(v);
  return out;
}
