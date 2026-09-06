import { Client } from "@notionhq/client";
import "dotenv/config";
import { DB_PROPERTIES, STATUSES, type Board, type Status } from "./schema.js";

export function notionClient(): Client {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN missing — copy .env.example to .env and fill it in.");
  return new Client({ auth: token });
}

export function dbId(): string {
  const id = process.env.NOTION_DB_ID;
  if (!id) throw new Error("NOTION_DB_ID missing — run `npm run setup-notion` first.");
  return id;
}

// Notion caps each rich-text item at 2000 chars — chunk instead of truncating.
const rt = (content: string) => {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < content.length && chunks.length < 10; i += 2000) {
    chunks.push({ type: "text", text: { content: content.slice(i, i + 2000) } });
  }
  return chunks.length ? chunks : [{ type: "text" as const, text: { content: "" } }];
};

export interface PinRow {
  name: string;
  status: Status;
  board?: Board;
  theme?: string;
  trend?: string;
  source?: "pipeline" | "backfill";
  template?: string;
  listItems?: string;
  pinTitle?: string;
  pinDescription?: string;
  altText?: string;
  keywords?: string[];
  imageUrl?: string;
  canvaLink?: string;
  destinationLink?: string;
  pinUrl?: string;
  pinterestPinId?: string;
  publishedDate?: string; // YYYY-MM-DD
  scheduledDate?: string; // YYYY-MM-DD — when the pin should go live on Pinterest
  seasonWindow?: string; // YYYY-MM-DD
  impressions?: number;
  saves?: number;
  clicks?: number;
  statsUpdated?: string; // YYYY-MM-DD — end of the analytics window these numbers cover
  notes?: string;
}

export function toNotionProperties(row: PinRow): Record<string, unknown> {
  const p: Record<string, unknown> = {
    Name: { title: rt(row.name) },
    Status: { select: { name: row.status } },
  };
  if (row.board) p["Board"] = { select: { name: row.board } };
  if (row.theme) p["Theme"] = { select: { name: row.theme } };
  if (row.trend) p["Trend"] = { select: { name: row.trend } };
  if (row.source) p["Source"] = { select: { name: row.source } };
  if (row.template) p["Template"] = { select: { name: row.template } };
  if (row.listItems) p["List items"] = { rich_text: rt(row.listItems) };
  if (row.pinTitle) p["Pin title"] = { rich_text: rt(row.pinTitle) };
  if (row.pinDescription) p["Pin description"] = { rich_text: rt(row.pinDescription) };
  if (row.altText) p["Alt text"] = { rich_text: rt(row.altText) };
  if (row.keywords?.length) p["Keywords"] = { multi_select: row.keywords.map((name) => ({ name })) };
  if (row.imageUrl)
    p["Pin image"] = { files: [{ type: "external", name: "pin", external: { url: row.imageUrl } }] };
  if (row.canvaLink) p["Canva link"] = { url: row.canvaLink };
  if (row.destinationLink) p["Destination link"] = { url: row.destinationLink };
  if (row.pinUrl) p["Pin URL"] = { url: row.pinUrl };
  if (row.pinterestPinId) p["Pinterest pin ID"] = { rich_text: rt(row.pinterestPinId) };
  if (row.publishedDate) p["Published date"] = { date: { start: row.publishedDate } };
  if (row.scheduledDate) p["Scheduled date"] = { date: { start: row.scheduledDate } };
  if (row.seasonWindow) p["Season window"] = { date: { start: row.seasonWindow } };
  // 0 is meaningful here (a pin that truly got nothing), so test for undefined.
  if (row.impressions !== undefined) p["Impressions"] = { number: row.impressions };
  if (row.saves !== undefined) p["Saves"] = { number: row.saves };
  if (row.clicks !== undefined) p["Clicks"] = { number: row.clicks };
  if (row.statsUpdated) p["Stats updated"] = { date: { start: row.statsUpdated } };
  if (row.notes) p["Notes"] = { rich_text: rt(row.notes) };
  return p;
}

export async function createPin(row: PinRow): Promise<string> {
  const notion = notionClient();
  const res = await notion.pages.create({
    parent: { database_id: dbId() },
    properties: toNotionProperties(row) as never,
  });
  return res.id;
}

/**
 * Make sure every status in schema.ts exists as an option on the live DB's
 * Status select. Notion rejects nothing here — it merges — so this is safe to
 * call repeatedly, and it keeps schema.ts the single source of truth when a new
 * status (e.g. "Needs changes") is added after the DB was created.
 */
export async function ensureStatusOptions(): Promise<void> {
  const notion = notionClient();
  const db = (await notion.databases.retrieve({ database_id: dbId() })) as unknown as {
    properties: Record<string, { type?: string; select?: { options?: { name: string }[] } }>;
  };
  const existing = new Set((db.properties["Status"]?.select?.options ?? []).map((o) => o.name));
  const missing = STATUSES.filter((s) => !existing.has(s));
  if (!missing.length) return;
  await notion.databases.update({
    database_id: dbId(),
    properties: {
      Status: { select: { options: [...existing, ...missing].map((name) => ({ name })) } },
    } as never,
  });
  console.log(`Notion Status options synced (added: ${missing.join(", ")}).`);
}

/**
 * Add any property in schema.ts that the live DB does not have yet. The DB was
 * created once from DB_PROPERTIES, so a property added to schema.ts afterwards
 * (e.g. "Stats updated") exists only in code until this runs. Existing
 * properties are left untouched — Notion merges rather than replaces.
 */
export async function ensureSchemaProperties(): Promise<void> {
  const notion = notionClient();
  const db = (await notion.databases.retrieve({ database_id: dbId() })) as unknown as {
    properties: Record<string, unknown>;
  };
  const missing = Object.entries(DB_PROPERTIES).filter(([name]) => !(name in db.properties));
  if (!missing.length) return;
  await notion.databases.update({
    database_id: dbId(),
    properties: Object.fromEntries(missing) as never,
  });
  console.log(`Notion schema synced (added: ${missing.map(([n]) => n).join(", ")}).`);
}

export async function listPinsByStatus(status: Status) {
  const notion = notionClient();
  const res = await notion.databases.query({
    database_id: dbId(),
    filter: { property: "Status", select: { equals: status } },
    page_size: 100,
  });
  return res.results;
}

type NotionPage = {
  id: string;
  properties: Record<string, {
    title?: { plain_text: string }[];
    rich_text?: { plain_text: string }[];
    select?: { name: string } | null;
    number?: number | null;
    url?: string | null;
    date?: { start: string } | null;
    files?: { file?: { url: string }; external?: { url: string } }[];
  }>;
};

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
  scheduledDate?: string;
  publishedDate?: string;
  impressions?: number;
  saves?: number;
  clicks?: number;
  statsUpdated?: string;
  notes?: string;
  imageUrls: string[];
}

function pageToSummary(page: NotionPage): PinSummary {
  const p = page.properties;
  const text = (prop?: { title?: { plain_text: string }[]; rich_text?: { plain_text: string }[] }) =>
    (prop?.title ?? prop?.rich_text ?? []).map((t) => t.plain_text).join("");
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
    scheduledDate: p["Scheduled date"]?.date?.start,
    publishedDate: p["Published date"]?.date?.start,
    impressions: p["Impressions"]?.number ?? undefined,
    saves: p["Saves"]?.number ?? undefined,
    clicks: p["Clicks"]?.number ?? undefined,
    statsUpdated: p["Stats updated"]?.date?.start,
    notes: text(p["Notes"]),
    imageUrls: (p["Pin image"]?.files ?? [])
      .map((f) => f.file?.url ?? f.external?.url)
      .filter((u): u is string => !!u),
  };
}

/**
 * Freshly-signed image URLs for one page. Notion signs file URLs with a 1-hour
 * expiry, so a URL captured when a long-lived process started will 403 later —
 * the review page re-fetches through this instead of embedding them once.
 */
export async function pinImageUrls(pageId: string): Promise<string[]> {
  const notion = notionClient();
  const page = (await notion.pages.retrieve({ page_id: pageId })) as unknown as NotionPage;
  return (page.properties["Pin image"]?.files ?? [])
    .map((f) => f.file?.url ?? f.external?.url)
    .filter((u): u is string => !!u);
}

// --- File uploads (raw fetch: @notionhq/client 2.x predates the file-upload API) ---

const NOTION_VERSION = "2022-06-28";

/** Upload a local file to Notion; returns the file_upload id to attach to a files property. */
export async function uploadFileToNotion(filePath: string, filename: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const headers = {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
  };

  const created = await fetch("https://api.notion.com/v1/file_uploads", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content_type: "image/png" }),
  });
  if (!created.ok) throw new Error(`file_uploads create failed (${created.status}): ${await created.text()}`);
  const { id, upload_url } = (await created.json()) as { id: string; upload_url: string };

  const form = new FormData();
  form.append("file", new Blob([await readFile(filePath)], { type: "image/png" }), filename);
  const sent = await fetch(upload_url, { method: "POST", headers, body: form });
  if (!sent.ok) throw new Error(`file upload send failed (${sent.status}): ${await sent.text()}`);
  return id;
}

/** Attach uploaded files to a page's "Pin image" property (replaces existing attachments). */
export async function attachPinImages(
  pageId: string,
  uploads: { id: string; name: string }[],
): Promise<void> {
  const notion = notionClient();
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Pin image": {
        files: uploads.map((u) => ({ type: "file_upload", name: u.name, file_upload: { id: u.id } })),
      },
    } as never,
  });
}

export async function listAllPins(): Promise<PinSummary[]> {
  const notion = notionClient();
  const all: PinSummary[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({
      database_id: dbId(),
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) all.push(pageToSummary(page as unknown as NotionPage));
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return all;
}

export async function pinsByStatus(status: Status): Promise<PinSummary[]> {
  const results = await listPinsByStatus(status);
  return results.map((page) => pageToSummary(page as unknown as NotionPage));
}

// Update any subset of a pin row's properties (name/status included when given).
export async function updatePin(pageId: string, patch: Partial<PinRow>): Promise<void> {
  const notion = notionClient();
  const full = toNotionProperties({ name: "x", status: "Idea", ...patch });
  if (patch.name === undefined) delete (full as Record<string, unknown>)["Name"];
  if (patch.status === undefined) delete (full as Record<string, unknown>)["Status"];
  await notion.pages.update({ page_id: pageId, properties: full as never });
}
