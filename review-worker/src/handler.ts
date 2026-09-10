// review-worker/src/handler.ts — the routes, with every side effect injected so
// the tests run without Notion or Access. Mirrors src/approve/server.ts (the
// local page) but is stateless: a decision is checked against the live queue.
import { renderApprovePage, emptyQueuePage } from "../../src/approve/page.js";
import type { ApprovePin } from "../../src/approve/server.js";
import { decisionPatch, isDecision, type DecisionPatch } from "../../src/approve/decide.js";
import type { PinSummary } from "../../src/notionPage.js";

export interface HandlerDeps {
  listInReview(): Promise<PinSummary[]>;
  updatePage(pageId: string, patch: DecisionPatch): Promise<void>;
  imageUrls(pageId: string): Promise<string[]>;
  today?: () => string;
}

export function toApprovePin(r: PinSummary): ApprovePin {
  return {
    pageId: r.pageId,
    name: r.name,
    pinTitle: r.pinTitle || r.name,
    pinDescription: r.pinDescription ?? "",
    altText: r.altText ?? "",
    board: r.board ?? "(no board)",
    listItems: r.listItems ?? "",
    imageUrls: r.imageUrls,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/") {
    const rows = await deps.listInReview();
    return html(rows.length ? renderApprovePage(rows.map(toApprovePin)) : emptyQueuePage());
  }

  if (req.method === "GET" && url.pathname.startsWith("/img/")) {
    const m = /^\/img\/([^/]+)\/(\d+)$/.exec(url.pathname);
    if (!m) return new Response("no image", { status: 404 });
    const target = (await deps.imageUrls(m[1]))[Number(m[2])];
    if (!target) return new Response("no image", { status: 404 });
    return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store" } });
  }

  if (req.method === "POST" && url.pathname === "/decide") {
    let body: { pageId?: unknown; decision?: unknown; note?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json(400, { error: "bad JSON" });
    }
    const { pageId, decision, note } = body;
    if (typeof pageId !== "string" || !pageId || !isDecision(decision)) return json(400, { error: "unknown pin or bad decision" });
    const cleanNote = typeof note === "string" ? note.trim() : "";
    if (decision === "revise" && !cleanNote) return json(400, { error: "needs-changes requires a note saying what to change" });

    // Stateless: confirm the pin is still In Review right now, so a second phone
    // or a retry after a timeout cannot decide it twice.
    const row = (await deps.listInReview()).find((r) => r.pageId === pageId);
    if (!row) return json(404, { error: "that list is no longer in review" });

    const today = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
    try {
      await deps.updatePage(pageId, decisionPatch(decision, cleanNote || undefined, row.notes, today));
    } catch (err) {
      return json(502, { error: (err as Error).message });
    }
    return json(200, { ok: true });
  }

  return new Response("not found", { status: 404 });
}
