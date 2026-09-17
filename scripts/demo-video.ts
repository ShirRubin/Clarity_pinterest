// One-off: render a "checklist reveal" video pin so we can look at one before
// building the real `clarity video` stage (Phase 5a — ../../VIDEO_PINS_PLAN.html).
//
//   npx tsx scripts/demo-video.ts                            # Winter Arc, checklist reveal
//   npx tsx scripts/demo-video.ts "gilmore"                  # any row, matched on Name
//   npx tsx scripts/demo-video.ts "winter arc" big-numbers   # the other video template
//
// Writes exports/video-demo/<slug>-<template>.mp4 + -cover.png.
// Reads the list straight out of Notion so the example is real content with the
// row's own palette and emoji — nothing here writes back.
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAllPins } from "../src/notion.js";
import { renderVideo, isVideoTemplate, VIDEO_TEMPLATES } from "../src/render/renderVideo.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

async function main() {
  const needle = (process.argv[2] ?? "winter arc").toLowerCase();
  const template = process.argv[3] ?? "classic-checklist";
  if (!isVideoTemplate(template)) {
    throw new Error(`"${template}" has no video mode. Try: ${Object.keys(VIDEO_TEMPLATES).join(", ")}`);
  }

  const pins = await listAllPins();
  const row = pins.find((p) => p.name.toLowerCase().includes(needle) && (p.listItems ?? "").trim());
  if (!row) throw new Error(`No row with list items matching "${needle}".`);

  console.log(`Rendering: ${row.name}`);
  console.log(`  theme=${row.theme ?? "—"}  board=${row.board ?? "—"}`);

  const out = path.join(ROOT, "exports", "video-demo", `${slugify(row.name)}-${template}.mp4`);
  const started = Date.now();
  const res = await renderVideo(
    { name: row.name, listItems: row.listItems!, theme: row.theme, board: row.board },
    template,
    out,
  );

  console.log(`\n  ${res.frames} frames · ${res.seconds.toFixed(1)}s · rendered in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`  video: ${res.videoPath}`);
  console.log(`  cover: ${res.coverPath} (frame ${res.coverFrame})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
