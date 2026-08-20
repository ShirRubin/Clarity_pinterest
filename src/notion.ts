import { Client } from "@notionhq/client";
import "dotenv/config";
import type { Board, Status } from "./schema.js";

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

const rt = (content: string) => [{ type: "text" as const, text: { content: content.slice(0, 2000) } }];

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
  keywords?: string[];
  imageUrl?: string;
  canvaLink?: string;
  destinationLink?: string;
  pinUrl?: string;
  pinterestPinId?: string;
  publishedDate?: string; // YYYY-MM-DD
  seasonWindow?: string; // YYYY-MM-DD
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
  if (row.keywords?.length) p["Keywords"] = { multi_select: row.keywords.map((name) => ({ name })) };
  if (row.imageUrl)
    p["Pin image"] = { files: [{ type: "external", name: "pin", external: { url: row.imageUrl } }] };
  if (row.canvaLink) p["Canva link"] = { url: row.canvaLink };
  if (row.destinationLink) p["Destination link"] = { url: row.destinationLink };
  if (row.pinUrl) p["Pin URL"] = { url: row.pinUrl };
  if (row.pinterestPinId) p["Pinterest pin ID"] = { rich_text: rt(row.pinterestPinId) };
  if (row.publishedDate) p["Published date"] = { date: { start: row.publishedDate } };
  if (row.seasonWindow) p["Season window"] = { date: { start: row.seasonWindow } };
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

export async function listPinsByStatus(status: Status) {
  const notion = notionClient();
  const res = await notion.databases.query({
    database_id: dbId(),
    filter: { property: "Status", select: { equals: status } },
    page_size: 100,
  });
  return res.results;
}
