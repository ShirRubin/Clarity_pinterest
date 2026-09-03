import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { createApproveServer, type ApprovePin } from "../src/approve/server.js";

const pin = (id: string): ApprovePin => ({
  pageId: id,
  name: `name-${id}`,
  pinTitle: `Title ${id}`,
  pinDescription: "desc",
  altText: "alt",
  board: "Aesthetic Life Lists",
  listItems: "one\ntwo",
  imageUrls: [],
});

const listen = (server: http.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );

test("serves the review page containing each pin's title", async () => {
  const server = createApproveServer([pin("p1"), pin("p2")], async () => {});
  const port = await listen(server);
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /Title p1/);
  assert.match(html, /Title p2/);
  server.close();
});

test("a decision reaches the callback and counts down remaining", async () => {
  const calls: unknown[][] = [];
  const server = createApproveServer([pin("p1")], async (...a) => {
    calls.push(a);
  });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/decide`, {
    method: "POST",
    body: JSON.stringify({ pageId: "p1", decision: "approve", note: "nice" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, remaining: 0 });
  assert.deepEqual(calls, [["p1", "approve", "nice"]]);
  server.close();
});

test("unknown pin id is a 400 and never reaches the callback", async () => {
  let called = false;
  const server = createApproveServer([pin("p1")], async () => {
    called = true;
  });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/decide`, {
    method: "POST",
    body: JSON.stringify({ pageId: "nope", decision: "approve" }),
  });
  assert.equal(res.status, 400);
  assert.equal(called, false);
  server.close();
});

test("a failing callback returns 500 and keeps the pin pending for retry", async () => {
  let attempts = 0;
  const server = createApproveServer([pin("p1")], async () => {
    attempts++;
    if (attempts === 1) throw new Error("notion hiccup");
  });
  const port = await listen(server);
  const body = JSON.stringify({ pageId: "p1", decision: "reject" });
  const first = await fetch(`http://127.0.0.1:${port}/decide`, { method: "POST", body });
  assert.equal(first.status, 500);
  const second = await fetch(`http://127.0.0.1:${port}/decide`, { method: "POST", body });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: true, remaining: 0 });
  server.close();
});

test("onAllDecided fires after the last decision", async () => {
  let callbackFired = false;
  const server = createApproveServer([pin("p1"), pin("p2")], async () => {}, () => {
    callbackFired = true;
  });
  const port = await listen(server);
  await fetch(`http://127.0.0.1:${port}/decide`, {
    method: "POST",
    body: JSON.stringify({ pageId: "p1", decision: "approve" }),
  });
  await fetch(`http://127.0.0.1:${port}/decide`, {
    method: "POST",
    body: JSON.stringify({ pageId: "p2", decision: "reject" }),
  });
  // Wait for the 500ms setTimeout in onAllDecided
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(callbackFired, true);
  server.close();
});

test("a revise decision reaches the callback with its note", async () => {
  const calls: unknown[][] = [];
  const server = createApproveServer([pin("p1")], async (...a) => {
    calls.push(a);
  });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/decide`, {
    method: "POST",
    body: JSON.stringify({ pageId: "p1", decision: "revise", note: "items 3 and 7 are vague" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [["p1", "revise", "items 3 and 7 are vague"]]);
  server.close();
});

test("revise without a note is refused — the rewrite has nothing to act on", async () => {
  const calls: unknown[][] = [];
  const server = createApproveServer([pin("p1")], async (...a) => {
    calls.push(a);
  });
  const port = await listen(server);
  for (const body of [
    JSON.stringify({ pageId: "p1", decision: "revise" }),
    JSON.stringify({ pageId: "p1", decision: "revise", note: "   " }),
  ]) {
    const res = await fetch(`http://127.0.0.1:${port}/decide`, { method: "POST", body });
    assert.equal(res.status, 400);
  }
  assert.deepEqual(calls, []);
  // still undecided, so a real decision is still accepted
  const ok = await fetch(`http://127.0.0.1:${port}/decide`, {
    method: "POST",
    body: JSON.stringify({ pageId: "p1", decision: "revise", note: "shorten the title" }),
  });
  assert.equal(ok.status, 200);
  server.close();
});

test("the page offers all three verdicts", async () => {
  const server = createApproveServer([pin("p1")], async () => {});
  const port = await listen(server);
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /Approve \(A\)/);
  assert.match(html, /Needs changes \(M\)/);
  assert.match(html, /Reject \(R\)/);
  server.close();
});

test("images are served through the proxy, re-signed per request", async () => {
  const withImage: ApprovePin = { ...pin("p1"), imageUrls: ["stale-url-1", "stale-url-2"] };
  let calls = 0;
  const server = createApproveServer([withImage], async () => {}, undefined, async (pageId, i) => {
    calls++;
    return `https://example.test/${pageId}/${i}.png?sig=fresh`;
  });
  const port = await listen(server);

  // The page must NOT embed the captured URLs — they expire after an hour. It
  // ships a count instead and builds /img/<pageId>/<i> srcs in the browser.
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.doesNotMatch(html, /stale-url-1/);
  assert.doesNotMatch(html, /stale-url-2/);
  assert.match(html, /"imageCount":2/);
  assert.match(html, /src="\/img\//);

  const res = await fetch(`http://127.0.0.1:${port}/img/p1/1`, { redirect: "manual" });
  await res.text();
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://example.test/p1/1.png?sig=fresh");
  assert.equal(calls, 1);
  server.close();
});

test("a missing image is a 404, not a crash", async () => {
  const server = createApproveServer([pin("p1")], async () => {}, undefined, async () => undefined);
  const port = await listen(server);
  for (const path of ["/img/p1/9", "/img/nonsense"]) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    await r.text();
    assert.equal(r.status, 404);
  }
  server.close();
});
