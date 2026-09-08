// Blogpost stage — every approved list becomes a blog post on clarity-lists.com.
// Approved/Published rows with list items → Clarity_blog/src/content/posts/<slug>.md
// (+ a web-sized cover from the pin's design PNG), and the row's Destination link
// is pointed at the post URL — the pin now lands readers on its own article
// (landing-page relevance is a Pinterest ranking factor; see ../CLARITY_PLAN.md).
// Existing post files are skipped, so reruns are cheap and non-destructive.
import { access, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { listAllPins, updatePin, type PinSummary } from "../notion.js";
import { generateJSON } from "../claude.js";
import { tmpdir } from "node:os";
import { SITE, slugify, shortTitle } from "../destination.js";

const BLOG_DIR = process.env.CLARITY_BLOG_DIR ?? path.join("..", "Clarity_blog");
const POSTS_DIR = path.join(BLOG_DIR, "src", "content", "posts");
const COVERS_DIR = path.join(BLOG_DIR, "public", "images", "covers", "pins");
const DESIGNS_DIR = path.join("exports", "designs");

// Pipeline themes → blog categories (category pages auto-generate from these)
const THEME_CATEGORY: Record<string, string> = {
  "Pop culture": "Pop Culture",
  Manifestation: "Self-Care",
  Seasonal: "Seasonal",
  "It-girl / Aesthetic": "Self-Care",
  Travel: "Travel",
  "Books & Learning": "Books",
  "Creative projects": "Creative Projects",
  "Career & Skills": "Career",
  "Luxury & Lifestyle": "Lifestyle",
};


// Pin description doubles as the post lead — hashtags belong on Pinterest only
const stripHashtags = (s: string) => s.replace(/\s*#[\w-]+/g, "").trim();

const exists = (p: string) => access(p).then(() => true, () => false);

async function findDesignPng(name: string): Promise<string | undefined> {
  const wanted = slugify(name);
  let dirs: string[] = [];
  try {
    dirs = await readdir(DESIGNS_DIR);
  } catch {
    return undefined;
  }
  const dir = dirs.find((d) => d === wanted || d.startsWith(wanted.slice(0, 40)));
  if (!dir) return undefined;
  const files = await readdir(path.join(DESIGNS_DIR, dir));
  const png = files.find((f) => f.endsWith(".png"));
  return png ? path.join(DESIGNS_DIR, dir, png) : undefined;
}

// Downscale the 2000×3000 pin PNG (~1.2MB) to a 900-wide web cover (~100-200KB JPEG)
// using installed Chrome — same approach as the pin renderer, no new dependencies.
async function writeWebCover(srcPng: string, outJpg: string): Promise<void> {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(srcPng)).href);
    const dataUrl = await page.evaluate(async () => {
      const img = document.querySelector("img")!;
      await (img as HTMLImageElement).decode();
      const el = img as HTMLImageElement;
      const w = Math.min(900, el.naturalWidth); // never upscale a 736px source
      const h = Math.round((el.naturalHeight / el.naturalWidth) * w);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(el, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.85);
    });
    await writeFile(outJpg, Buffer.from(dataUrl.split(",")[1], "base64"));
  } finally {
    await browser.close();
  }
}

// Live boards -> blog categories for backfill pins (theme is often unset on those rows)
const BOARD_CATEGORY: Record<string, string> = {
  "TV & Movie Bucket Lists": "Entertainment",
  "Aesthetic Life Lists": "Self-Care",
  "Travel & Festivals": "Travel",
  "Books · Learning & Culture": "Books",
  "Smart & Creative Projects": "Creative Projects",
  "Manifest & Magic Life": "Self-Care",
  "Luxury & Lifestyle": "Lifestyle",
  "Career & Learn New Skills": "Career",
};

interface BackfillPost {
  title: string;
  intro: string;
  items: string[];
}

const BACKFILL_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 60 },
    intro: { type: "string", maxLength: 300 },
    items: { type: "array", items: { type: "string" }, minItems: 8, maxItems: 16 },
  },
  required: ["title", "intro", "items"],
  additionalProperties: false,
};

// A schema-forced reply can't refuse, so a failed image read comes back AS the
// content ("Blocked — could not read pin image"). Detect it and fail the row
// instead of publishing the refusal as a post (which once also hijacked the
// "same-topic → link existing" path for every later failure).
const looksBlocked = (gen: BackfillPost) =>
  /blocked|cannot read|could not read|unable to (read|view|see)/i.test(
    `${gen.title} ${gen.items[0] ?? ""}`,
  );

// The 60 live pins have no list text in Notion — the items exist only ON the image.
// Claude reads the downloaded pin image, transcribes the real items, and writes the post.
async function generateBackfillPost(row: PinSummary, imagePath: string): Promise<BackfillPost> {
  const system = `You write posts for Clarity Bucket Lists (clarity-lists.com), a cozy bucket-list blog. Voice: warm, direct, a little playful; second person; no hashtags, no emoji walls (one emoji max).`;
  const user = `Read the pin image at ${path.resolve(imagePath)} — it is a checklist graphic from our Pinterest account.

Write the blog post for it:
- "title": a clean short post title (e.g. "Theme Party Bucket List"), Title Case, no colon, max 60 chars.
- "intro": 2-3 sentences introducing the list. Ground it in this pin description: "${(row.pinDescription ?? "").replace(/"/g, "'")}". No hashtags.
- "items": transcribe the checklist items EXACTLY as they appear on the image (same order, fix obvious OCR-style typos only), then format each as "**Item text** — one helpful sentence expanding it." Keep every item from the image; do not invent extra items unless the image has fewer than 8, in which case add fitting ones to reach 10.`;
  return generateJSON<BackfillPost>(system, user, BACKFILL_SCHEMA, {
    allowFileRead: true,
    // Without this the headless CLI silently denies the Read (tmpdir is outside
    // its cwd) and the model fabricates a list instead of transcribing.
    addDirs: [path.dirname(path.resolve(imagePath))],
  });
}

async function downloadImage(url: string, dest: string): Promise<void> {
  // pinimg 403s bare fetches — send browser-ish headers
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Referer: "https://www.pinterest.com/",
      Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
    },
  });
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

interface PostFields {
  title: string;
  category: string;
  intro: string;
  cover?: { path: string; alt: string };
  date: string;
  items: string; // numbered markdown lines
}

function buildMarkdown(f: PostFields): string {
  const itemCount = f.items.split("\n").filter((l) => /^\d+\./.test(l)).length;
  const words = f.items.split(/\s+/).length;
  const readTime = `${Math.max(2, Math.round(words / 200))} min`;
  const fm = [
    "---",
    `title: "${f.title.replace(/"/g, "'")}"`,
    `category: "${f.category}"`,
    `intro: "${f.intro.replace(/"/g, "'")}"`,
    ...(f.cover ? [`coverImage: "${f.cover.path}"`, `coverAlt: "${f.cover.alt.replace(/"/g, "'")}"`] : []),
    `date: ${f.date}`,
    `readTime: "${readTime}"`,
    `itemCount: ${itemCount}`,
    "affiliates: true",
    "---",
  ].join("\n");
  // frontmatter intro already renders in the post hero — no repeated body lead
  return `${fm}\n\n## The List\n\n${f.items}\n`;
}

export async function runBlogpost(limit = 20): Promise<number> {
  if (!(await exists(POSTS_DIR))) {
    throw new Error(`Blog posts dir not found at ${POSTS_DIR} — set CLARITY_BLOG_DIR`);
  }
  await mkdir(COVERS_DIR, { recursive: true });

  const eligible = (await listAllPins()).filter(
    (r) =>
      (r.status === "Approved" || r.status === "Scheduled" || r.status === "Published") &&
      ((r.listItems ?? "").trim().length > 0 ||
        (r.source === "backfill" && r.imageUrls.length > 0)),
  );

  let written = 0;
  for (const row of eligible) {
    if (written >= limit) break;
    // Backfill rows ALWAYS take the backfill path — a rerun may find the
    // transcribed items we saved to Notion, but their slug/title/cover logic differs.
    const isPipelineRow = row.source !== "backfill" && (row.listItems ?? "").trim().length > 0;

    if (isPipelineRow) {
      // ---- pipeline row: list text lives in Notion, design PNG lives in exports/ ----
      const slug = slugify(shortTitle(row.name));
      const postPath = path.join(POSTS_DIR, `${slug}.md`);
      if (await exists(postPath)) continue; // never clobber an existing post

      let cover: PostFields["cover"];
      const designPng = await findDesignPng(row.name);
      if (designPng) {
        const coverFile = path.join(COVERS_DIR, `${slug}.jpg`);
        if (!(await exists(coverFile))) await writeWebCover(designPng, coverFile);
        cover = { path: `/images/covers/pins/${slug}.jpg`, alt: row.altText ?? shortTitle(row.name) };
      }

      await writeFile(
        postPath,
        buildMarkdown({
          title: shortTitle(row.name),
          category: THEME_CATEGORY[row.theme ?? ""] ?? "Lists",
          intro: stripHashtags(row.pinDescription ?? ""),
          cover,
          date: (row.publishedDate ?? new Date().toISOString()).slice(0, 10),
          items: (row.listItems ?? "").trim(),
        }),
        "utf8",
      );
      await updatePin(row.pageId, { destinationLink: `${SITE}/posts/${slug}` });
      console.log(`✓ ${slug}.md${cover ? " + cover" : " (no local design PNG)"} → Destination link set`);
      written++;
    } else {
      // ---- backfill row: the LIVE pin. Its image is the design already on Pinterest;
      // the list text exists only on that image, so Claude transcribes it. ----
      // Skip only if the row's destination post actually exists on disk (self-heals
      // rows left pointing at a renamed/deleted post)
      if (row.destinationLink?.startsWith(SITE)) {
        const linkedSlug = row.destinationLink.split("/").filter(Boolean).pop() ?? "";
        if (await exists(path.join(POSTS_DIR, `${linkedSlug}.md`))) continue;
      }
      try {
        const imageUrl = row.imageUrls[0];
        const ext = imageUrl.includes(".png") ? ".png" : ".jpg";
        // Notion page ids created in one batch share a long common PREFIX — only the
        // tail is unique. slice(0, 8) once collapsed all 60 rows onto one cached tmp
        // file, feeding every transcription the same wrong image. Use the full id.
        const tmpKey = row.pageId.replace(/-/g, "");
        const tmp = path.join(tmpdir(), `clarity-pin-${tmpKey}${ext}`);
        if (!(await exists(tmp))) {
          try {
            await downloadImage(imageUrl, tmp);
          } catch {
            // pinimg intermittently 403s /originals/ — the 736px variant stays up
            // and is plenty for transcription + the ~900px web cover
            await downloadImage(imageUrl.replace("/originals/", "/736x/"), tmp);
          }
        }

        // Transcribe from the 900-wide web version, not the multi-MB original —
        // oversized images fail the CLI's image read (the "blocked" failure mode).
        const tmpSmall = path.join(tmpdir(), `clarity-pin-${tmpKey}-web.jpg`);
        if (!(await exists(tmpSmall))) await writeWebCover(tmp, tmpSmall);

        const gen = await generateBackfillPost(row, tmpSmall);
        if (looksBlocked(gen)) {
          throw new Error("model could not read the pin image — row left for a retry");
        }
        const slug = slugify(gen.title);
        const postPath = path.join(POSTS_DIR, `${slug}.md`);

        if (!(await exists(postPath))) {
          const coverFile = path.join(COVERS_DIR, `${slug}.jpg`);
          if (!(await exists(coverFile))) await copyFile(tmpSmall, coverFile);
          const items = gen.items.map((it, i) => `${i + 1}. ${it}`).join("\n");
          await writeFile(
            postPath,
            buildMarkdown({
              title: gen.title,
              category: BOARD_CATEGORY[row.board ?? ""] ?? "Lists",
              intro: stripHashtags(gen.intro),
              cover: { path: `/images/covers/pins/${slug}.jpg`, alt: `${gen.title} — the original Clarity pin checklist` },
              date: (row.publishedDate ?? new Date().toISOString()).slice(0, 10),
              items,
            }),
            "utf8",
          );
          // keep the transcribed list on the row too — future designs/regens can reuse it
          await updatePin(row.pageId, {
            destinationLink: `${SITE}/posts/${slug}`,
            listItems: items,
          });
          console.log(`✓ ${slug}.md (backfill, ${gen.items.length} items transcribed from the live pin) → Destination link set`);
        } else {
          // same-topic pin: point it at the existing post rather than duplicating it
          await updatePin(row.pageId, { destinationLink: `${SITE}/posts/${slug}` });
          console.log(`→ "${row.name.slice(0, 45)}" linked to existing ${slug}.md`);
        }
        written++;
      } catch (err) {
        console.warn(`✗ backfill "${row.name.slice(0, 50)}": ${(err as Error).message}`);
      }
    }
  }

  console.log(
    written === 0
      ? "Nothing to do — every eligible list already has a post."
      : `\n${written} post(s) written to ${POSTS_DIR}. Rebuild the blog (npm run build) and run npm run pdfs there.`,
  );
  return written;
}
