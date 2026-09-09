// review-worker/src/notion-fetch.ts — the three Notion calls the review page
// needs, over plain fetch (no SDK in the Worker). Pure mapping lives in
// ../../src/notionPage.ts; `fetchFn` is injected so tests never hit the network.
import { pageToSummary, imageUrlsOf, type NotionPage, type PinSummary } from "../../src/notionPage.js";
import type { DecisionPatch } from "../../src/approve/decide.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// Notion caps a rich-text item at 2000 chars — chunk, don't truncate (mirrors notion.ts).
const rt = (content: string) => {
  const chunks: { type: "text"; text: { content: string } }[] = [];
  for (let i = 0; i < content.length && chunks.length < 10; i += 2000) {
    chunks.push({ type: "text", text: { content: content.slice(i, i + 2000) } });
  }
  return chunks.length ? chunks : [{ type: "text" as const, text: { content: "" } }];
};

export function notionApi(token: string, fetchFn: FetchLike = fetch) {
  const call = async <T>(path: string, init: { method: "GET" | "POST" | "PATCH"; body?: unknown }): Promise<T> => {
    const res = await fetchFn(`${BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) {
      let msg = "";
      try {
        msg = ((await res.json()) as { message?: string }).message ?? "";
      } catch {
        /* no JSON body */
      }
      throw new Error(`Notion ${res.status}${msg ? `: ${msg}` : ""}`);
    }
    return (await res.json()) as T;
  };

  return {
    async queryInReview(dbId: string): Promise<PinSummary[]> {
      const out = await call<{ results: NotionPage[] }>(`/databases/${dbId}/query`, {
        method: "POST",
        body: { filter: { property: "Status", select: { equals: "In Review" } }, page_size: 100 },
      });
      return out.results.map(pageToSummary);
    },
    async updatePage(pageId: string, patch: DecisionPatch): Promise<void> {
      const properties: Record<string, unknown> = { Status: { select: { name: patch.status } } };
      if (patch.notes !== undefined) properties["Notes"] = { rich_text: rt(patch.notes) };
      await call(`/pages/${pageId}`, { method: "PATCH", body: { properties } });
    },
    async pageImageUrls(pageId: string): Promise<string[]> {
      return imageUrlsOf(await call<NotionPage>(`/pages/${pageId}`, { method: "GET" }));
    },
  };
}
