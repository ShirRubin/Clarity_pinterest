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
