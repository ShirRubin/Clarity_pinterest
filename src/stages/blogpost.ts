// Blogpost stage — every approved list becomes a blog post on clarity-lists.com.
// Approved/Published rows with list items → Clarity_blog/src/content/posts/<slug>.md
// (+ a web-sized cover from the pin's design PNG), and the row's Destination link
// is pointed at the post URL — the pin now lands readers on its own article
// (landing-page relevance is a Pinterest ranking factor; see ../CLARITY_PLAN.md).
// Existing post files are skipped, so reruns are cheap and non-destructive.
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { listAllPins, updatePin, type PinSummary } from "../notion.js";

const BLOG_DIR = process.env.CLARITY_BLOG_DIR ?? path.join("..", "Clarity_blog");
const POSTS_DIR = path.join(BLOG_DIR, "src", "content", "posts");
const COVERS_DIR = path.join(BLOG_DIR, "public", "images", "covers", "pins");
const DESIGNS_DIR = path.join("exports", "designs");
const SITE = "https://clarity-lists.com";

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

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// "The Winter Arc Bucket List: 12 ways to ..." → title "The Winter Arc Bucket List"
const shortTitle = (name: string) => name.split(":")[0].trim();

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
      const w = 900;
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

function postMarkdown(row: PinSummary, slug: string, coverPath: string | undefined): string {
  const title = shortTitle(row.name);
  const category = THEME_CATEGORY[row.theme ?? ""] ?? "Lists";
  const intro = stripHashtags(row.pinDescription ?? "").replace(/"/g, "'");
  const items = (row.listItems ?? "").trim();
  const itemCount = items.split("\n").filter((l) => /^\d+\./.test(l)).length;
  const words = items.split(/\s+/).length;
  const readTime = `${Math.max(2, Math.round(words / 200))} min`;
  const date = (row.publishedDate ?? new Date().toISOString()).slice(0, 10);
  const fm = [
    "---",
    `title: "${title.replace(/"/g, "'")}"`,
    `category: "${category}"`,
    `intro: "${intro}"`,
    ...(coverPath ? [`coverImage: "${coverPath}"`, `coverAlt: "${(row.altText ?? title).replace(/"/g, "'")}"`] : []),
    `date: ${date}`,
    `readTime: "${readTime}"`,
    `itemCount: ${itemCount}`,
    "affiliates: true",
    "---",
  ].join("\n");
  // frontmatter intro already renders in the post hero — don't repeat it as a body lead
  return `${fm}\n\n## The List\n\n${items}\n`;
}

export async function runBlogpost(limit = 20): Promise<void> {
  if (!(await exists(POSTS_DIR))) {
    throw new Error(`Blog posts dir not found at ${POSTS_DIR} — set CLARITY_BLOG_DIR`);
  }
  await mkdir(COVERS_DIR, { recursive: true });

  const rows = (await listAllPins()).filter(
    (r) =>
      (r.status === "Approved" || r.status === "Published") &&
      (r.listItems ?? "").trim().length > 0,
  );

  let written = 0;
  for (const row of rows) {
    if (written >= limit) break;
    const slug = slugify(shortTitle(row.name));
    const postPath = path.join(POSTS_DIR, `${slug}.md`);
    if (await exists(postPath)) continue; // never clobber an existing post

    // Cover: web-sized JPEG from the first design variant, if we have one locally
    let coverWeb: string | undefined;
    const designPng = await findDesignPng(row.name);
    if (designPng) {
      const coverFile = path.join(COVERS_DIR, `${slug}.jpg`);
      if (!(await exists(coverFile))) await writeWebCover(designPng, coverFile);
      coverWeb = `/images/covers/pins/${slug}.jpg`;
    }

    await writeFile(postPath, postMarkdown(row, slug, coverWeb), "utf8");

    // Phase D wiring: the pin's destination is now its own post
    const postUrl = `${SITE}/posts/${slug}`;
    await updatePin(row.pageId, { destinationLink: postUrl });
    console.log(`✓ ${slug}.md${coverWeb ? " + cover" : " (no local design PNG — no cover)"} → Destination link set`);
    written++;
  }

  console.log(
    written === 0
      ? "Nothing to do — every Approved/Published list already has a post."
      : `\n${written} post(s) written to ${POSTS_DIR}. Rebuild the blog (npm run build) and run npm run pdfs there.`,
  );
}
