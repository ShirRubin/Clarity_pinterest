# Video pins for Clarity — design (2026-09-17)

Research (`PINTEREST_RESEARCH.md` §4, §8 play 5): static pins win clicks (4.8 outbound clicks per 1,000 impressions vs 1.6 for video), video wins reach and saves (~185% more impressions, 3.2× engagement, 0.3–0.5% save rate). Video is the one lever in the plan that grows *followers* (133 today) rather than clicks. The barbell: statics for traffic, video for reach — from the same Notion row.

## Goal

Every approved list can also ship as one 6–15 s vertical video pin, rendered by the same free, deterministic, offline HTML pipeline that makes the four static variants, posted through the same `/clarity-post` builder flow, bookkept in the same Notion row. No new ideation, no new copy, no new tooling that costs money.

Non-goals for v1: narration, music, per-list creative direction, 9:16 Idea-pin carousels, anything that needs the Pinterest API.

## Pinterest video facts that shape the design

- Format MP4 (H.264) or MOV; **2:3 (1000×1500) or 9:16 (1080×1920)**; 4 s minimum, 6–15 s is the sweet spot; ≤2 GB. We render **1080×1620 (2:3)** so the video sits in the feed at exactly the size of our statics and the cover frame *is* a Clarity pin.
- Watched with sound off — on-screen text must carry the whole message. No audio track in v1 (silent MP4 is accepted).
- The pin builder takes video through the same `input[type=file]` the skill already uses for PNGs, then asks for a **cover frame** (a slider). Title, description, alt text, board, link and tagged topics are identical to a static pin. Scheduling works the same way ("Publish at a later date").
- A video pin is a *fresh pin* (new asset) — it earns its own 24–48 h boost and does not count against the 72 h same-URL rule differently from a static (`src/schedule.ts` enforces per-URL spacing regardless of format).

## Format options (pick 2 for v1, keep the rest as future templates)

Every option reuses the existing template HTML, palettes (`src/render/palettes.ts`), fonts and the "no twins" uniqueness rules — the video is the static pin *over time*.

1. **Checklist reveal** (recommended, v1 default). Cover = the `classic-checklist` pin with every box empty. Items check themselves off one per beat (0.55–0.7 s each, 12–15 items → 8–11 s), ending on the open "your turn" slot pulsing for 1.5 s. Message: "here is the whole list, save it". Cheapest possible: one CSS keyframe on `.item.checked`, staggered by index.
2. **Big-numbers countdown.** Cover = `big-numbers` with only the title visible. Numerals drop in 1→N with a slight overshoot, text slides in after each numeral. Same duration; different silhouette so the feed never shows twins.
3. **Sticky-note peel.** Cover = `sticky-note` tilted paper, blank. The paper "unpeels" (clip-path from top) to reveal the list, then a hand-drawn check appears on 3 highlighted items. Best for seasonal boards (Fall, Christmas & Winter) where the paper look already converts.
4. **Title-card + 3 hero items** (6 s, reach-optimised). Cover = title only, huge type. Three items fade in one at a time with the subject emoji, last frame says "12 more on the list → save". Shortest, highest completion rate; pairs with the static pin that carries the full list.
5. **Before/after glow** (Glow Up, Self Care boards). Two-panel: muted palette variant on the left, full palette on the right, a wipe reveals the "after" while items tick. Uses the 3 palette variants per theme that already exist.
6. **Board teaser** (account growth, monthly). 4 pins from one board slide through as a deck, 2 s each, ending on the board name — links to the board URL (the one legitimate use of a board link) and asks to follow.

Options 1 and 2 need zero new template work beyond keyframes. 3–5 need one new template file each. 6 is a different renderer (multi-pin) and waits for Phase 5b.

## Rendering path

### 5a — Playwright frame capture + ffmpeg (ship this)

Already available: `playwright-core` drives installed Chrome/Edge for the PNGs (`src/render/renderPin.ts`), and `ffmpeg 9.0` is on the PATH. No new dependency.

- New module `src/render/renderVideo.ts`:
  - `renderVideo(content, template, outPath, {fps: 30, seconds})` opens the *same* filled template with a `data-video` attribute; the template's CSS turns that attribute into staggered keyframes (`animation-delay: calc(var(--i) * 0.6s)`), so one HTML file serves both formats.
  - Determinism: pause CSS animations (`animation-play-state: paused`) and step them with `page.evaluate(() => document.getAnimations().forEach(a => a.currentTime = t))` per frame, screenshot each frame to a temp dir (`page.screenshot({clip})` at 1080×1620), then `ffmpeg -framerate 30 -i %04d.png -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.mp4`. Frame-stepping (not `recordVideo`) pins each frame to an exact timeline position rather than to wall-clock timing, so the same list always yields the same motion at the same moments. **Corrected 2026-09-17 after the first real render:** this is *visual* determinism, not byte determinism — Chrome's rasterizer differs by ~1/255 on a few antialiased pixels between runs (PSNR ~105 dB), and the existing static PNGs already do the same, so "byte-identical, like the PNGs" was wrong about both.
  - Cover frame, written alongside as `<template>-video-cover.png` so the pack carries what the builder needs. **Revised 2026-09-17 after rendering both v1 formats:** it is per-template, not always frame 0 — a cover has to read as a finished pin, and the two formats build in opposite directions. Checklist reveal opens on the whole list and ticks it off (cover = first frame); numbers countdown opens on a bare title card and builds the list (cover = last frame). The map is `VIDEO_TEMPLATES` in `src/render/renderVideo.ts`; `opts.cover` overrides it.
  - Cost: 300 frames × ~40 ms ≈ 15 s per video on the laptop. Acceptable for ~1 list/day.
- Templates: add `[data-video]` keyframe blocks to `classic-checklist.html` (option 1) and `big-numbers.html` (option 2). Static rendering ignores them.
- `DESIGN.md` gains a "Video" section: duration 8–12 s, first frame must read as a finished pin, last 1.5 s holds the CTA, no motion faster than 0.4 s per element (Pinterest downscales; fast motion smears).

### 5b — HyperFrames (upgrade, only if 5a proves demand)

HyperFrames skills are installed and give a real timeline, transitions and audio ducking. Move to it when we want music beds, per-board intros or the board-teaser deck. Not before stats show video earning saves.

## Data model and pipeline changes

- **Notion:** one new files property `Video pin` (mp4 + cover png) and `Video template` (select: `checklist-reveal`, `numbers-countdown`, …). Add to `DB_PROPERTIES` in `src/schema.ts`; `ensureSchemaProperties()` creates it on the live DB.
- **Variants:** keep `VARIANTS_PER_LIST = 4` and the test that ties it to `TEMPLATE_NAMES.length`. Video is *not* a fifth static variant; it is a separate `VIDEO_TEMPLATES` list with its own `clarity video` stage so the static queue math and the 3/day cadence stay untouched.
- **Stages:** `clarity video [limit]` runs on rows in `Approved` / `Scheduled` / `Published` that have list items and no `Video pin` yet; picks the video template deterministically from the list-name hash (same trick as palettes) so a theme's lists alternate between options 1 and 2; uploads mp4 + cover to Notion; never blocks the static path.
- **Packs:** `src/stages/pack.ts` writes one extra pack per list with `video: <template>.mp4`, `cover: <template>-video-cover.png`, same title/description/alt/board/link as the statics (alt text describes the *cover*). Slot rule: the video pack is dated **the day after the last static variant**, 13:00 slot, so it rides the chain-reaction window when Pinterest is already showing the list's statics.
- **Posting:** `/clarity-post` gains a `video:` branch — same builder, `file_upload` with the mp4, wait for the processing spinner, set the cover via the cover slider to frame 0 (or upload the cover png if the builder offers "Upload cover"), then the usual title / description / board / link / topics / schedule. `clarity posted` records it under the row's notes as `video: <pin url>`.
- **Cadence:** week 1–2, **2 videos/week** (Tue/Fri) on top of the 3 statics/day; from week 3, one per list if the numbers hold. Never more than 1 video/day — video is reach, statics are clicks, and the research's 3–5 fresh pins/day ceiling counts both.
- **Stats:** the Analytics CSV already carries per-pin impressions/saves/clicks; `scripts/import-analytics.ts` needs a `format` column (static/video) keyed on the pack, so the first question — *does video earn saves and follows?* — is answerable at day 30.

## Copy rules for video pins

Same playbook (`src/prompts.ts` SEO_RULES) with three deltas: title gets the word **"video"** only if it fits under 60 chars naturally (Pinterest search does surface "… video" queries; do not force it); description ends with **"Save this to watch it tick off"** as the CTA; alt text starts with "Animated checklist video titled …".

## Build order (estimate: ~2 days of pipeline work)

1. `renderVideo.ts` + `[data-video]` keyframes on two templates + `clarity video` command; render *The Winter Arc Bucket List* and *Gilmore Girls* as the two references, review on the phone review page (add a `<video>` case to the review card). ½ day.
2. Notion property + pack + `clarity posted` bookkeeping + tests (`tests/video.test.ts`: frame count = fps × seconds, cover exists, pack shape). ½ day.
3. `/clarity-post` video branch, first two manual posts, verify with `UserActivityPinsResource` that the pin is `video` type and the cover is frame 0. ½ day.
4. Stats `format` column and a `clarity stats` line "video vs static: saves / 1k impressions". ½ day.
5. Decide at day 30: if video saves-per-impression ≥ 2× static, move to one video per list and start 5b; if not, keep 2/week as the follower channel and stop investing.

## Risks

- **Builder processing time.** Pinterest transcodes on upload; the Done button stays disabled for 10–60 s. The skill must poll the enabled state, not wait a fixed time.
- **Frame-step determinism** depends on `document.getAnimations()` covering every animation; a stray JS-driven transition would drift. Rule: CSS animations only in templates.
- **Fonts and emoji** render identically to the PNGs (same Chrome, vendored fonts), so no new "no twins" work — but every video *template* is a new silhouette and must pass the same contact-sheet review as the static candidates did on Sep 6.
- **Bounce risk:** a video that promises "the whole list" must land on the post that has it (`src/destination.ts` already guarantees the blog link).
