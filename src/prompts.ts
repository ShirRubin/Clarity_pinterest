import { BOARDS, THEMES, TRENDS } from "./schema.js";

export const BRAND_CONTEXT = `Clarity Bucket Lists is a Pinterest-first content brand (@claritybucketlists) publishing
curated, aesthetic bucket lists: pop culture eras, self-growth, manifestation, travel, fandoms, it-girl energy.
Audience: mostly Gen Z and young-millennial women who save aspirational-but-doable lists.
Voice: warm, direct, second person, a little playful. Confident short sentences. Em dashes. Never corporate,
never generic listicle filler. Every item is specific enough to actually do.

Boards: ${BOARDS.join(" · ")}
Themes: ${THEMES.join(" · ")}
Trend tags (Pinterest Predicts 2026 waves + evergreen): ${TRENDS.join(" · ")}`;

// Real excerpt from the blog — the canonical Clarity voice for list items.
export const VOICE_EXAMPLE = `Example of the Clarity voice (from "It Girl Era Bucket List"):
"The It Girl era is a mindset shift, not a makeover. It's about choosing yourself on purpose — your style, your routines, your energy."
1. **Curate your signature style** — Stop dressing for trends. Identify 3 words that describe how you want to look and build from there.
2. **Build your glow-up morning routine** — Skincare, movement, something for your mind. 30 minutes before your phone. Non-negotiable.
3. **Do a solo café or bookstore day** — Just you, a coffee, a book or journal. No agenda. A reminder that your company is good company.`;

// Non-negotiable Pinterest SEO rules from PINTEREST_RESEARCH.md.
export const SEO_RULES = `Pinterest SEO rules (follow exactly):
- Pin title: under 100 characters, leads with the exact phrase people search for, states clear value.
- Pin description: 2-3 natural sentences weaving in secondary keywords, ends with a save/do call to action.
  NO hashtag walls (max 0-2 hashtags, usually zero). One or two fitting emoji are on-brand.
- Keywords: 4-8 search phrases the pin targets (used for tracking, not stuffed into copy).
- The final list item is always an open slot inviting comments, e.g. "#12 — your turn. What would you add?"`;
