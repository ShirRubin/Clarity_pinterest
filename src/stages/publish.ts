// Publish stage — Stage A (no Pinterest API): Approved → Published.
// Writes each approved pin as a self-contained pack in exports/packs/:
// the rendered PNG variants plus post.txt with everything to paste into
// Pinterest's pin builder (or Metricool / the native scheduler).
// Stage B (direct API posting) replaces the export step once Standard access lands.
import { cp, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { pinsByStatus, updatePin } from "../notion.js";
import { TEMPLATE_NAMES } from "../render/renderPin.js";

const PROFILE_URL = "https://www.pinterest.com/ClarityBucketLists/";

// Until the blog is live, each pin links to ITS BOARD's URL, not the profile:
// destinations stay unique per board, so the "never the same URL twice in 72h"
// cadence rule survives posting several pins in one day. Slugs match data/rss/.
const BOARD_URLS: Record<string, string> = {
  "TV & Movie Bucket Lists": `${PROFILE_URL}tv-movie-bucket-lists/`,
  "Aesthetic Life Lists": `${PROFILE_URL}aesthetic-life-lists/`,
  "Travel & Festivals": `${PROFILE_URL}travel-festivals/`,
  "Books · Learning & Culture": `${PROFILE_URL}books-learning-culture/`,
  "Smart & Creative Projects": `${PROFILE_URL}smart-creative-projects/`,
  "Manifest & Magic Life": `${PROFILE_URL}manifest-magic-life/`,
  "Luxury & Lifestyle": `${PROFILE_URL}luxury-lifestyle/`,
  "Career & Learn New Skills": `${PROFILE_URL}career-learn-new-skills/`,
};

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export async function runPublish(limit = 10): Promise<void> {
  const approved = await pinsByStatus("Approved");
  if (!approved.length) {
    console.log("No rows in status Approved — approve some In Review rows in Notion first.");
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  let packed = 0;

  for (const row of approved.slice(0, limit)) {
    const slug = slugify(row.name);
    const designDir = path.join("exports", "designs", slug);
    const packDir = path.join("exports", "packs", `${today}--${slug}`);
    await mkdir(packDir, { recursive: true });

    const variants: string[] = [];
    for (const t of TEMPLATE_NAMES) {
      const src = path.join(designDir, `${t}.png`);
      try {
        await access(src);
      } catch {
        console.warn(`⚠ Missing render ${src} — run \`clarity design\` again for this row.`);
        continue;
      }
      await cp(src, path.join(packDir, `${t}.png`));
      variants.push(`${t}.png`);
    }
    if (!variants.length) continue;

    const post = [
      `TITLE (paste as pin title):`,
      row.pinTitle ?? row.name,
      ``,
      `DESCRIPTION (paste as pin description):`,
      row.pinDescription ?? "",
      ``,
      `ALT TEXT (paste into the pin's alt-text field):`,
      row.altText ?? "",
      ``,
      `BOARD: ${row.board ?? "(pick manually)"}`,
      `DESTINATION LINK: ${(row.board && BOARD_URLS[row.board]) || PROFILE_URL}   <- swap for the blog post URL once the blog is live`,
      ``,
      `IMAGES: ${variants.join(", ")}`,
      `Post ONE variant now; save the other for a later day. Each variant counts`,
      `as a fresh pin, but never pin the same destination URL twice within 72h.`,
      ``,
      `TAGGED TOPICS: always add 10 (the max) in the pin builder. The taxonomy has no`,
      `"bucket list"/"self care" topics — search concrete nouns from the list items`,
      `(tea, baking, candles, movie night...) plus vibe topics (Cozy Living, Autumn Day).`,
      ``,
      `After posting: paste the live pin's URL into the row's "Pin URL" in Notion.`,
    ].join("\n");
    await writeFile(path.join(packDir, "post.txt"), post, "utf8");

    await updatePin(row.pageId, {
      status: "Published",
      publishedDate: today,
      destinationLink: (row.board && BOARD_URLS[row.board]) || PROFILE_URL,
    });
    packed++;
    console.log(`✓ Pack ready: ${packDir}`);
  }
  console.log(`\n${packed} pack(s) in exports/packs/ — post from there, or hand them to Metricool.`);
}
