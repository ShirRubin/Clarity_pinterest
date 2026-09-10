import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest, toApprovePin, type HandlerDeps } from "../review-worker/src/handler.js";
import type { PinSummary } from "../src/notionPage.js";

const row = (id: string, extra: Partial<PinSummary> = {}): PinSummary => ({
  pageId: id,
  name: `List ${id}`,
  pinTitle: `Title ${id}`,
  pinDescription: "d",
  altText: "a",
  board: "Travel & Festivals",
  listItems: "1. x",
  notes: "old",
  imageUrls: ["https://s3/1.png", "https://s3/2.png"],
  ...extra,
});

function deps(rows: PinSummary[]) {
  const updates: { pageId: string; patch: unknown }[] = [];
  const d: HandlerDeps & { updates: typeof updates } = {
    updates,
    listInReview: async () => rows,
    updatePage: async (pageId, patch) => {
      updates.push({ pageId, patch });
    },
    imageUrls: async (pageId) => (pageId === "p1" ? ["https://s3/fresh-0.png", "https://s3/fresh-1.png"] : []),
    today: () => "2026-09-09",
  };
  return d;
}
const post = (body: unknown) => new Request("https://review.clarity-lists.com/decide", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("GET / renders the queue with each pin's title and an image count, never the URLs", async () => {
  const res = await handleRequest(new Request("https://r/"), deps([row("p1"), row("p2")]));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const html = await res.text();
  assert.match(html, /Title p1/);
  assert.match(html, /Title p2/);
  assert.doesNotMatch(html, /s3\/1\.png/);
  assert.match(html, /"imageCount":2/);
});

test("GET / with an empty queue renders the nothing-to-review page", async () => {
  const res = await handleRequest(new Request("https://r/"), deps([]));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Nothing to review/);
});

test("GET /img re-signs on every request and redirects with no-store", async () => {
  const res = await handleRequest(new Request("https://r/img/p1/1"), deps([row("p1")]));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://s3/fresh-1.png");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const missing = await handleRequest(new Request("https://r/img/p9/0"), deps([]));
  assert.equal(missing.status, 404);
});

test("POST /decide writes the decision patch to Notion before answering", async () => {
  const d = deps([row("p1")]);
  const res = await handleRequest(post({ pageId: "p1", decision: "revise", note: "items 3 and 7" }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(d.updates, [{ pageId: "p1", patch: { status: "Needs changes", notes: "old | revise 2026-09-09: items 3 and 7" } }]);
});

test("POST /decide refuses revise without a note, bad decisions, bad JSON", async () => {
  const d = deps([row("p1")]);
  assert.equal((await handleRequest(post({ pageId: "p1", decision: "revise" }), d)).status, 400);
  assert.equal((await handleRequest(post({ pageId: "p1", decision: "publish" }), d)).status, 400);
  assert.equal((await handleRequest(new Request("https://r/decide", { method: "POST", body: "{nope" }), d)).status, 400);
  assert.deepEqual(d.updates, []);
});

test("POST /decide for a pin no longer In Review is a 404 (already decided elsewhere)", async () => {
  const d = deps([row("p2")]);
  const res = await handleRequest(post({ pageId: "p1", decision: "approve" }), d);
  assert.equal(res.status, 404);
  assert.deepEqual(d.updates, []);
});

test("a Notion failure is a 502 and the page can retry", async () => {
  const d = deps([row("p1")]);
  d.updatePage = async () => {
    throw new Error("Notion 500");
  };
  const res = await handleRequest(post({ pageId: "p1", decision: "approve" }), d);
  assert.equal(res.status, 502);
  assert.match((await res.json() as { error: string }).error, /Notion 500/);
});

test("GET / when Notion is unreachable is a 502 page, not a crash", async () => {
  const d = deps([row("p1")]);
  d.listInReview = async () => {
    throw new Error("Notion 500");
  };
  const res = await handleRequest(new Request("https://r/"), d);
  assert.equal(res.status, 502);
  assert.match(await res.text(), /unreachable/);
});

test("POST /decide when the stateless re-check hits a Notion failure is a 502, and nothing is written", async () => {
  const d = deps([row("p1")]);
  d.listInReview = async () => {
    throw new Error("Notion 500");
  };
  const res = await handleRequest(post({ pageId: "p1", decision: "approve" }), d);
  assert.equal(res.status, 502);
  assert.match((await res.json() as { error: string }).error, /Notion 500/);
  assert.deepEqual(d.updates, []);
});

test("unknown routes are 404; toApprovePin falls back to the name when there is no title", async () => {
  assert.equal((await handleRequest(new Request("https://r/whatever"), deps([]))).status, 404);
  assert.equal(toApprovePin(row("p1", { pinTitle: "" })).pinTitle, "List p1");
});
