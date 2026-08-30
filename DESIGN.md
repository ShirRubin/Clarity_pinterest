# Clarity pin design system

## Templates
- `classic-checklist` — the signature pastel look. A diagonal pastel gradient (`{{BG}}` → `{{BG2}}`, 160°) fills the full 1000×1500 canvas. A centered header carries the big rounded-uppercase Fredoka (700) title in the theme's accent color, sized down (96px → 78px → 62px) as the title gets longer so it never wraps past two lines, with a letter-spaced "BUCKET LIST" subtitle in Fredoka 600 beneath it. The checklist fills the remaining vertical space (`justify-content: space-evenly`), each item a rounded 46px checkbox next to hand-lettered Patrick Hand SC uppercase text; the final row is always the open-slot line ("💬 …") rendered in accent-colored Fredoka instead of a checkbox. A huge (400px) subject emoji sits rotated and faded (14% opacity) in the bottom-right as ambient decoration, and an "@claritybucketlists" watermark closes the footer. This is the account's original, playful, illustrated-feel look — cozy and handwritten — and every list gets one of these regardless of theme, since it's rendered for all rows, not selected per list.
- `bold-panel` — white-card variant. The same three brand fonts sit on a deeper three-stop diagonal gradient (`{{ACCENT_SOFT}}` → `{{BG}}` → `{{BG2}}`, 150°), but the title is left-aligned near the top in Fredoka 700 using the darker `{{ACCENT_DARK}}` shade, with a small emoji cluster in the top-right corner and a pill-shaped "BUCKET LIST" chip (solid accent background, white text) beneath the title. The checklist itself lives inside a floating white card (92% opacity, 44px corner radius, soft drop shadow) rather than directly on the gradient, giving it a cleaner, more editorial "clean card" feel; checkboxes here fill with `{{BG2}}` instead of translucent white, and text runs slightly smaller (37px vs 40px) to fit the card's padding. Same watermark footer. Both templates are rendered for every list (`src/stages/design.ts` loops `TEMPLATE_NAMES` unconditionally), so `bold-panel` isn't "chosen" over `classic-checklist` — it exists to give each list two visually distinct fresh pins, which is what keeps a posting batch from reading as duplicates and reinforces the no-twins invariant below.
- **Standing rule:** serif looks are out — `soft-editorial` was piloted 2026-08-22 and rejected by the user. A third template (research says 3–5 variants/list) gets designed fresh, never resurrected.

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
- 1 list = 2 scheduled pins — one per template variant, each its own pack.
- `src/stages/publish.ts` skips variants that are already packed and only marks a row scheduled in Notion once every one of its variants has a pack — a partially packed row is left unscheduled and retried on a later run.
- Tagged topics: fill all 10; concrete nouns from list items + vibe topics — the taxonomy has no "bucket list"/"self care".
- Rhythm: batch posting sessions ~2×/week via Pinterest's native "Publish at a later date".
- Queue target: keep **14 days** of dated packs ahead of today (`src/queue.ts`). `clarity queue` reports runway, overdue packs and lists in flight; overdue packs never count as cover.
- Generation is queue-aware and capped at 6 lists/run — lists already between idea and approval count against the batch, so a backlog of unapproved work stops new generation instead of piling on top of it.

## Render facts
- 2000×3000 PNG via playwright-core on installed Chrome/Edge (no browser download).
- Vendored woff2 fonts: Fredoka, Patrick Hand SC — deterministic offline renders.
- Reference pins vendored in `data/reference/`; long titles auto-shrink; only bold action heads go on the image.
