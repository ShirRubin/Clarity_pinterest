# Clarity pin design system

## Templates
- `classic-checklist` — the signature pastel look. A diagonal pastel gradient (`{{BG}}` → `{{BG2}}`, 160°) fills the full 1000×1500 canvas. A centered header carries the big rounded-uppercase Fredoka (700) title in the theme's accent color, sized down (96px → 78px → 62px) as the title gets longer so it never wraps past two lines, with a letter-spaced "BUCKET LIST" subtitle in Fredoka 600 beneath it. The checklist fills the remaining vertical space (`justify-content: space-evenly`), each item a rounded 46px checkbox next to hand-lettered Patrick Hand SC uppercase text; the final row is always the open-slot line ("💬 …") rendered in accent-colored Fredoka instead of a checkbox. A huge (400px) subject emoji sits rotated and faded (14% opacity) in the bottom-right as ambient decoration, and an "@claritybucketlists" watermark closes the footer. This is the account's original, playful, illustrated-feel look — cozy and handwritten — and every list gets one of these regardless of theme, since it's rendered for all rows, not selected per list.
- `bold-panel` — white-card variant. The same three brand fonts sit on a deeper three-stop diagonal gradient (`{{ACCENT_SOFT}}` → `{{BG}}` → `{{BG2}}`, 150°), but the title is left-aligned near the top in Fredoka 700 using the darker `{{ACCENT_DARK}}` shade, with a small emoji cluster in the top-right corner and a pill-shaped "BUCKET LIST" chip (solid accent background, white text) beneath the title. The checklist itself lives inside a floating white card (92% opacity, 44px corner radius, soft drop shadow) rather than directly on the gradient, giving it a cleaner, more editorial "clean card" feel; checkboxes here fill with `{{BG2}}` instead of translucent white, and text runs slightly smaller (37px vs 40px) to fit the card's padding. Same watermark footer. All four templates are rendered for every list (`src/stages/design.ts` loops `TEMPLATE_NAMES` unconditionally), so `bold-panel` isn't "chosen" over `classic-checklist` — each exists to give the list another visually distinct fresh pin, which is what keeps a posting batch from reading as duplicates and reinforces the no-twins invariant below.
- `sticky-note` — **chosen 2026-09-06.** The whole checklist sits on a warm-white paper square (`#fffdf8`, 880px, 18px radius) tilted −1.6° over the `{{BG}}` → `{{BG2}}` gradient, with a striped `{{ACCENT_SOFT}}` tape strip across its top edge and the subject emoji stuck on the top-right corner at 120px, rotated 12° with a drop shadow, like a sticker. Title is the centred Fredoka 700 uppercase in `{{ACCENT}}`; the “BUCKET LIST” subtitle is Patrick Hand SC letter-spaced in `{{ACCENT_SOFT}}`. Checkboxes are deliberately wonky — 42px, `{{CHECK}}` border, uneven corner radii, alternating ±3–4° rotation — so they read hand-drawn. Planner / scrapbook feel; the most on-brand of the 2026-09-06 candidates.
- `big-numbers` — **chosen 2026-09-06.** No checkboxes at all: `.box` is hidden and each item leads with a 74px Fredoka 700 numeral in `{{ACCENT}}` from a CSS counter (`decimal-leading-zero`, so 01–14), laid out as a two-column grid with `align-content: space-evenly`. Header is left-aligned under a small letter-spaced “BUCKET LIST” kicker, title in `{{ACCENT_DARK}}`, closed by a 5px `{{ACCENT}}` rule; the emoji floats faded (16%) top-right. The open slot spans both columns as a solid `{{ACCENT}}` pill with white Fredoka text. Reads at thumbnail size and is structurally unlike the three list-with-boxes templates — that distinctness is the point.
- **Standing rule:** serif looks are out — `soft-editorial` was piloted 2026-08-22 and rejected. A six-candidate pilot on 2026-09-06 (`sticky-note`, `big-numbers`, `split-poster`, `pill-chips`, `night-mode`, `blog-sticker` — the last matched the blog's serif system by explicit request) was rendered against *The Winter Arc Bucket List*; the two above won and the other four were deleted along with their vendored fonts. Rejected templates are never resurrected; the reference renders survive in `exports/candidates/winter-arc/`.

## Top-up after adding a template
- `clarity topup` renders whatever templates a not-yet-posted row is missing on disk (Designed / In Review / Approved, plus Published rows with no pin URL and no scheduled date) and re-attaches the full set to Notion — `attachPinImages` replaces, so the old variants are re-rendered too (deterministic, byte-identical). Without it, `publish` leaves those rows unscheduled because it requires every template packed. Rows already live or scheduled are not touched.

## Uniqueness invariant ("no twins")
- 9 theme-keyed palettes; 3 palette variants per theme, picked deterministically per list name, collision-bumped within a batch.
- Emoji is subject-first from the list name.
- Hard constraint on every future template or palette.

## Copy playbook (2026)
- Title 40–60 chars, keyword-first; hard cap <100.
- Description <500 chars with 3–5 hashtags; 1–2 emoji.
- Alt text 80–140 chars.
- Keyword visibly on the image; open slot renders as comment bait.

## Posting rules
- 3 fresh pins/day, held for 90 days; never the same destination URL twice within 72h (`src/schedule.ts` enforces both).
- 1 list = 4 scheduled pins — one per template variant, each its own pack (`VARIANTS_PER_LIST` in `src/queue.ts` must equal `TEMPLATE_NAMES.length`; a test guards the drift).
- `src/stages/publish.ts` skips variants that are already packed and only marks a row scheduled in Notion once every one of its variants has a pack — a partially packed row is left unscheduled and retried on a later run.
- Tagged topics: fill all 10; concrete nouns from list items + vibe topics — the taxonomy has no "bucket list"/"self care".
- Rhythm: batch posting sessions ~2×/week via Pinterest's native "Publish at a later date".
- Queue target: keep **14 days** of dated packs ahead of today (`src/queue.ts`). `clarity queue` reports runway, overdue packs and lists in flight; overdue packs never count as cover.
- Generation is queue-aware and capped at 6 lists/run — lists already between idea and approval count against the batch, so a backlog of unapproved work stops new generation instead of piling on top of it.

## Render facts
- 2000×3000 PNG via playwright-core on installed Chrome/Edge (no browser download).
- Vendored woff2 fonts: Fredoka, Patrick Hand SC — deterministic offline renders.
- Reference pins vendored in `data/reference/`; long titles auto-shrink; only bold action heads go on the image.
