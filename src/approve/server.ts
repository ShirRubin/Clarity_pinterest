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

export type Decision = "approve" | "reject" | "revise";

const DECISIONS: readonly Decision[] = ["approve", "reject", "revise"];
export type OnDecision = (pageId: string, decision: Decision, note?: string) => Promise<void>;
/** Resolve a freshly-signed URL for one pin image, by page and image index. */
export type ResolveImage = (pageId: string, index: number) => Promise<string | undefined>;

export function createApproveServer(
  pins: ApprovePin[],
  onDecision: OnDecision,
  onAllDecided?: () => void,
  resolveImage?: ResolveImage,
): http.Server {
  // Note: callers must not construct with an empty pins array if they rely on onAllDecided.
  const remaining = new Set(pins.map((p) => p.pageId));
  const inFlight = new Set<string>();
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderApprovePage(pins));
      return;
    }
    // Notion signs image URLs for an hour. Embedding them once meant every image
    // 403'd on a review session left open longer than that, so the page points
    // here and we re-sign on demand.
    if (req.method === "GET" && req.url?.startsWith("/img/")) {
      const m = /^\/img\/([^/?]+)\/(\d+)$/.exec(req.url);
      if (!m || !resolveImage) {
        res.writeHead(404);
        res.end("no image");
        return;
      }
      try {
        const url = await resolveImage(m[1], Number(m[2]));
        if (!url) {
          res.writeHead(404);
          res.end("no image");
          return;
        }
        res.writeHead(302, { location: url, "cache-control": "no-store" });
        res.end();
      } catch {
        res.writeHead(502);
        res.end("image lookup failed");
      }
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
      if (!pageId || !remaining.has(pageId) || !DECISIONS.includes(decision as Decision)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unknown pin or bad decision" }));
        return;
      }
      // "revise" exists to carry feedback into the next draft — without a note
      // there is nothing for `clarity revise` to act on, so refuse it here.
      if (decision === "revise" && !note?.trim()) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "needs-changes requires a note saying what to change" }));
        return;
      }
      if (inFlight.has(pageId)) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "decision already in flight" }));
        return;
      }
      inFlight.add(pageId);
      try {
        await onDecision(pageId, decision as Decision, note?.trim() || undefined);
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
        return;
      } finally {
        inFlight.delete(pageId);
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
