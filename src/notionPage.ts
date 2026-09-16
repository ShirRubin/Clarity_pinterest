// src/notionPage.ts — the pure half of the Notion layer: raw page JSON → PinSummary.
// No SDK, no env, no I/O, so the review Worker can use it with plain fetch.

type NotionProp = {
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  select?: { name: string } | null;
  number?: number | null;
  url?: string | null;
  date?: { start: string } | null;
  files?: { file?: { url: string }; external?: { url: string } }[];
};

export type NotionPage = { id: string; properties: Record<string, NotionProp> };

export interface PinSummary {
  pageId: string;
  name: string;
  theme?: string;
  trend?: string;
  board?: string;
  status?: string;
  pinTitle?: string;
  pinDescription?: string;
  altText?: string;
  listItems?: string;
  source?: string;
  destinationLink?: string;
  pinUrl?: string;
  pinterestPinId?: string;
  scheduledDate?: string;
  publishedDate?: string;
  impressions?: number;
  saves?: number;
  clicks?: number;
  statsUpdated?: string;
  notes?: string;
  imageUrls: string[];
}

const text = (prop?: NotionProp) => (prop?.title ?? prop?.rich_text ?? []).map((t) => t.plain_text).join("");

// Notion caps each rich-text item at 2000 chars — chunk instead of truncating.
// Shared by src/notion.ts (SDK) and review-worker/src/notion-fetch.ts (plain
// fetch) so the chunking logic can't drift between the two.
export function rt(content: string): { type: "text"; text: { content: string } }[] {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < content.length && chunks.length < 10; i += 2000) {
    chunks.push({ type: "text", text: { content: content.slice(i, i + 2000) } });
  }
  return chunks.length ? chunks : [{ type: "text" as const, text: { content: "" } }];
}

export function imageUrlsOf(page: NotionPage): string[] {
  return (page.properties["Pin image"]?.files ?? [])
    .map((f) => f.file?.url ?? f.external?.url)
    .filter((u): u is string => !!u);
}

export function pageToSummary(page: NotionPage): PinSummary {
  const p = page.properties;
  return {
    pageId: page.id,
    name: text(p["Name"]),
    theme: p["Theme"]?.select?.name,
    trend: p["Trend"]?.select?.name,
    board: p["Board"]?.select?.name,
    status: p["Status"]?.select?.name,
    pinTitle: text(p["Pin title"]),
    pinDescription: text(p["Pin description"]),
    altText: text(p["Alt text"]),
    listItems: text(p["List items"]),
    source: p["Source"]?.select?.name,
    destinationLink: p["Destination link"]?.url ?? undefined,
    pinUrl: p["Pin URL"]?.url ?? undefined,
    pinterestPinId: text(p["Pinterest pin ID"]) || undefined,
    scheduledDate: p["Scheduled date"]?.date?.start,
    publishedDate: p["Published date"]?.date?.start,
    impressions: p["Impressions"]?.number ?? undefined,
    saves: p["Saves"]?.number ?? undefined,
    clicks: p["Clicks"]?.number ?? undefined,
    statsUpdated: p["Stats updated"]?.date?.start,
    notes: text(p["Notes"]),
    imageUrls: imageUrlsOf(page),
  };
}
