// The approve stage's HTTP core, kept free of Notion so it's testable:
// the stage injects pins and an onDecision callback. Decisions are
// written through the callback BEFORE the 200 goes back — the page's
// card state never gets ahead of Notion.
import http from "node:http";
import { renderApprovePage } from "./page.js";

export interface ApprovePin {
  pageId: string;
  name: string;
  pinTitle: string;
  pinDescription: string;
  altText: string;
  board: string;
  listItems: string;
  imageUrls: string[];
}

export type Decision = "approve" | "reject";
export type OnDecision = (pageId: string, decision: Decision, note?: string) => Promise<void>;

export function createApproveServer(
  pins: ApprovePin[],
  onDecision: OnDecision,
  onAllDecided?: () => void,
): http.Server {
  const remaining = new Set(pins.map((p) => p.pageId));
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderApprovePage(pins));
      return;
    }
    if (req.method === "POST" && req.url === "/decide") {
      let body = "";
      for await (const chunk of req) body += chunk;
      let parsed: { pageId?: string; decision?: string; note?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad JSON" }));
        return;
      }
      const { pageId, decision, note } = parsed;
      if (!pageId || !remaining.has(pageId) || (decision !== "approve" && decision !== "reject")) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unknown pin or bad decision" }));
        return;
      }
      try {
        await onDecision(pageId, decision, note || undefined);
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }
      remaining.delete(pageId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, remaining: remaining.size }));
      if (remaining.size === 0 && onAllDecided) setTimeout(onAllDecided, 500);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
}
