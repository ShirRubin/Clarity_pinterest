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

// A bare imperative ("Start", "Pour", "Book") followed by an article reads as
// an instruction, not a topic — Pinterest's taxonomy wants the noun. Only an
// exact-word match is dropped: "knitted" stays (it isn't "knit"). The verb is
// dropped ONLY when an article follows it ("Start a candle collection"): many
// of these words double as nouns ("Board game night", "Plant swap", "Book
// club night"), and without an article after them they ARE the noun.
const IMPERATIVES = new Set([
  "start", "make", "pour", "knit", "book", "try", "take", "do", "watch", "read", "write", "host",
  "learn", "build", "plan", "go", "visit", "bake", "cook", "drink", "taste", "pick", "set", "add",
  "say", "sit", "fall", "brace", "board", "blend", "press", "bottle", "embroider", "hand-pour",
  "compare", "order", "pair", "save", "rotate", "name", "lock", "choose", "put", "throw", "keep",
  "find", "get", "have", "spend", "sign", "join", "run", "walk", "wear", "buy", "light", "hang",
  "frame", "plant", "grow", "stitch", "sew", "paint", "draw", "mix", "roll",
]);
const ARTICLES = new Set(["a", "an", "the", "your", "one", "some"]);

/** The bold head, cleaned to its first two nouns — or undefined for a head
 *  that has nothing left worth tagging once the verb/article is dropped. */
function headWords(head: string): string | undefined {
  const words = head
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  let i = 0;
  if (IMPERATIVES.has(words[i]) && ARTICLES.has(words[i + 1])) {
    i += 2;
  }
  const rest = words.slice(i, i + 2);
  if (rest.length === 0) return undefined;
  if (rest.length === 1 && rest[0].length <= 2) return undefined;
  return rest.join(" ");
}

export function suggestTopics(listItems: string, theme?: string): string[] {
  const vibes = VIBES[theme ?? ""] ?? [];
  // Reserve the theme's vibe words first — a 12-item list otherwise fills all
  // 10 slots with item heads and the vibes never make it in.
  const maxHeads = Math.max(0, 10 - vibes.length);
  const heads: string[] = [];
  for (const line of listItems.split(/\r?\n/)) {
    if (heads.length >= maxHeads) break;
    if (OPEN_SLOT.test(line)) continue;
    const headRaw = /\*\*(.+?)\*\*/.exec(line)?.[1] ?? line.replace(/^\s*\d+[.)]\s*/, "").split(/[—–-]{1,2}\s/)[0];
    const words = headWords(headRaw);
    if (words && !heads.includes(words)) heads.push(words);
  }
  const out = [...heads];
  for (const v of vibes) {
    const val = v.trim().toLowerCase();
    if (val && !out.includes(val)) out.push(val);
  }
  return out;
}
