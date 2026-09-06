// Where a pin sends the reader. Pure — no Notion, no filesystem — so publish
// and blogpost share one answer and it stays unit-testable.
//
// Preference order (see ../CLARITY_PLAN.md, Phase C): the list's own blog post
// on clarity-lists.com (landing-page relevance is a Pinterest ranking factor,
// and it is the only page an affiliate module can live on), else the pin's
// board URL — unique per board, so the 72h-per-URL rule still lets several
// pins go out the same day while a post is missing.

export const SITE = "https://clarity-lists.com";
export const PROFILE_URL = "https://www.pinterest.com/ClarityBucketLists/";

// Slugs match data/rss/.
export const BOARD_URLS: Record<string, string> = {
  "TV & Movie Bucket Lists": `${PROFILE_URL}tv-movie-bucket-lists/`,
  "Aesthetic Life Lists": `${PROFILE_URL}aesthetic-life-lists/`,
  "Travel & Festivals": `${PROFILE_URL}travel-festivals/`,
  "Books · Learning & Culture": `${PROFILE_URL}books-learning-culture/`,
  "Smart & Creative Projects": `${PROFILE_URL}smart-creative-projects/`,
  "Manifest & Magic Life": `${PROFILE_URL}manifest-magic-life/`,
  "Luxury & Lifestyle": `${PROFILE_URL}luxury-lifestyle/`,
  "Career & Learn New Skills": `${PROFILE_URL}career-learn-new-skills/`,
};

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// "The Winter Arc Bucket List: 12 ways to ..." → "The Winter Arc Bucket List"
export const shortTitle = (name: string) => name.split(":")[0].trim();

export const postSlugForName = (name: string) => slugify(shortTitle(name));
export const postUrlForName = (name: string) => `${SITE}/posts/${postSlugForName(name)}`;

export interface DestinationInput {
  name: string;
  board?: string;
  destinationLink?: string;
}

export interface Destination {
  url: string;
  source: "notion" | "blog" | "board";
}

export function chooseDestination(row: DestinationInput, postOnDisk: boolean): Destination {
  if (row.destinationLink?.startsWith(SITE)) return { url: row.destinationLink, source: "notion" };
  if (postOnDisk) return { url: postUrlForName(row.name), source: "blog" };
  return { url: (row.board && BOARD_URLS[row.board]) || PROFILE_URL, source: "board" };
}
