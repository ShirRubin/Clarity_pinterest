// HTML→MP4 video pin renderer (Phase 5a — see ../../../VIDEO_PINS_PLAN.html).
// Same templates, same palettes, same fonts as renderPin.ts: the template is opened
// with a `data-video` attribute, which switches on the [data-video] keyframe blocks,
// and the animation is *stepped* frame by frame rather than recorded. Stepping is
// what makes the output byte-identical across runs, exactly like the PNGs —
// page.video()/recordVideo would drift with wall-clock timing.
//
// Output: 1080×1620 MP4 (H.264, silent, faststart) — 2:3, so the video sits in the
// feed at the same size as our statics — plus the cover PNG, which is frame 0.
import { chromium, type Browser, type Page } from "playwright-core";
import { spawn } from "node:child_process";
import { readFile, writeFile, unlink, mkdir, rm, copyFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { fillTemplate, launchBrowser, type PinContent } from "./renderPin.js";
import type { TemplateName } from "../templates.js";

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "templates");

/**
 * Templates that carry [data-video] keyframes. The rest render statics only.
 *
 * `cover` is which frame Pinterest should show before the video plays, and the rule
 * from DESIGN.md is that it has to read as a finished pin on its own:
 *  - checklist reveal starts on the whole list (boxes empty) and ticks it off → "first"
 *  - numbers countdown starts on a bare title card and builds the list → "last"
 */
export const VIDEO_TEMPLATES = {
  "classic-checklist": { cover: "first" },
  "big-numbers": { cover: "last" },
} as const satisfies Record<string, { cover: "first" | "last" }>;
export type VideoTemplate = keyof typeof VIDEO_TEMPLATES;

export const isVideoTemplate = (t: string): t is VideoTemplate => t in VIDEO_TEMPLATES;

export interface VideoOptions {
  fps?: number; // 30 is plenty for text motion and keeps the file small
  tailMs?: number; // hold on the last frame after the CTA pulse ends
  cover?: "first" | "last"; // override the template's default cover frame
  browser?: Browser;
}

export interface VideoResult {
  videoPath: string;
  coverPath: string;
  coverFrame: number;
  seconds: number;
  frames: number;
}

/** Longest animation end time on the page, in ms — the CSS declares the timeline, we just read it. */
async function timelineEndMs(page: Page): Promise<number> {
  return page.evaluate(() => {
    let end = 0;
    for (const a of document.getAnimations()) {
      const t = a.effect?.getComputedTiming();
      if (!t) continue;
      const delay = typeof t.delay === "number" ? t.delay : 0;
      const active = typeof t.activeDuration === "number" ? t.activeDuration : 0;
      end = Math.max(end, delay + active);
    }
    return end;
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (c) => (err += String(c)));
    p.on("error", (e) => reject(new Error(`ffmpeg could not be started (${e.message}) — is it on the PATH?`)));
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}:\n${err.slice(-2000)}`)),
    );
  });
}

/**
 * Render one list through one video template. Returns the mp4 path, the cover PNG
 * path (frame 0) and the measured duration.
 */
export async function renderVideo(
  content: PinContent,
  template: TemplateName,
  outPath: string,
  opts: VideoOptions = {},
): Promise<VideoResult> {
  const fps = opts.fps ?? 30;
  const tailMs = opts.tailMs ?? 500;
  const own = !opts.browser;
  const b = opts.browser ?? (await launchBrowser());

  // The filled HTML sits next to the templates so the relative font URLs resolve.
  const tmpHtml = path.join(TEMPLATES_DIR, `.tmpvid-${process.pid}-${template}.html`);
  const framesDir = path.join(path.dirname(outPath), `.frames-${process.pid}-${template}`);
  const coverPath = outPath.replace(/\.mp4$/i, "-cover.png");

  try {
    const raw = await readFile(path.join(TEMPLATES_DIR, `${template}.html`), "utf8");
    const filled = fillTemplate(raw, content).replace("<html>", "<html data-video>");
    if (!filled.includes("<html data-video>")) {
      throw new Error(`${template}.html has no plain <html> tag to switch into video mode.`);
    }
    await writeFile(tmpHtml, filled, "utf8");
    await mkdir(framesDir, { recursive: true });
    await mkdir(path.dirname(outPath), { recursive: true });

    // 1000×1500 at 1.08× = 1080×1620, Pinterest's 2:3 video size.
    const page = await b.newPage({ viewport: { width: 1000, height: 1500 }, deviceScaleFactor: 1.08 });
    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: "networkidle" });
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);

    const endMs = await timelineEndMs(page);
    if (endMs <= 0) {
      throw new Error(`${template}.html declared no [data-video] animations — nothing to render.`);
    }
    const seconds = (endMs + tailMs) / 1000;
    const frames = Math.ceil(seconds * fps);

    for (let i = 0; i < frames; i++) {
      const t = (i / fps) * 1000;
      await page.evaluate((ms) => {
        for (const a of document.getAnimations()) a.currentTime = ms;
      }, t);
      await page.screenshot({ path: path.join(framesDir, `${String(i).padStart(4, "0")}.png`), type: "png" });
    }
    await page.close();

    // The cover is a frame we already rendered — no second pass, and it is guaranteed
    // to be exactly what the viewer sees when the video stops there.
    const which = opts.cover ?? (isVideoTemplate(template) ? VIDEO_TEMPLATES[template].cover : "first");
    const coverFrame = which === "last" ? frames - 1 : 0;
    await copyFile(path.join(framesDir, `${String(coverFrame).padStart(4, "0")}.png`), coverPath);
    await runFfmpeg([
      "-y",
      "-framerate", String(fps),
      "-i", path.join(framesDir, "%04d.png"),
      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outPath,
    ]);

    return { videoPath: outPath, coverPath, coverFrame, seconds, frames };
  } finally {
    await unlink(tmpHtml).catch(() => {});
    await rm(framesDir, { recursive: true, force: true }).catch(() => {});
    if (own) await b.close();
  }
}
