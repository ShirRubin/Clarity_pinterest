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

// Non-negotiable Pinterest SEO rules — PINTEREST_RESEARCH.md "Pin Copy Playbook" (updated 2026-08-22).
export const SEO_RULES = `Pinterest SEO rules (follow exactly):
- Pin title: 40-60 characters (hard cap 100). The exact long-tail keyword phrase (3+ words)
  must appear in the FIRST 40 characters — mobile feeds clip titles around there. Natural
  phrasing, clear value, numbers welcome. No emoji in titles.
- Pin description: 2-3 natural sentences, 150-300 characters BEFORE hashtags. Primary keyword
  in the first sentence, 1-2 secondary keywords woven in naturally, ends with a save/click
  call to action (CTR is a ranking signal). No keyword stuffing.
- Then, at the END of the description: 3-5 hashtags on one line — 1-2 broad (#bucketlist,
  #fallaesthetic) + 2-3 specific to the pin (#winterarc). Never more than 5.
- Emoji: exactly 1-2 fitting emoji inside the description (common ones only — exotic emoji
  render inconsistently). They add scannability; the text must read fine without them.
- Alt text: 80-140 characters literally describing what the IMAGE shows, keyword included
  naturally (e.g. "Pastel checklist graphic titled Winter Arc Bucket List with 14 rituals").
  Pinterest's AI cross-checks alt text against the image — describe, don't sell.
- Keywords: 4-8 search phrases the pin targets (used for tracking, not stuffed into copy).
- The final list item is always an open slot inviting comments, e.g. "#12 — your turn. What would you add?"`;
