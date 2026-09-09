import { test } from "node:test";
import assert from "node:assert/strict";
import { notionApi } from "../review-worker/src/notion-fetch.js";

const rt = (s: string) => [{ plain_text: s }];
const page = (id: string) => ({ id, properties: { Name: { title: rt(`List ${id}`) }, Status: { select: { name: "In Review" } }, "Pin image": { files: [{ file: { url: `https://s3/${id}.png` } }] } } });

function fakeFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = handler(url, init);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fn, calls };
}

test("queryInReview posts the status filter with auth + version headers and maps pages", async () => {
  const { fn, calls } = fakeFetch(() => ({ results: [page("a"), page("b")], has_more: false }));
  const api = notionApi("secret", fn);
  const rows = await api.queryInReview("db1");
  assert.equal(calls[0].url, "https://api.notion.com/v1/databases/db1/query");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["Authorization"], "Bearer secret");
  assert.equal(headers["Notion-Version"], "2022-06-28");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)).filter, { property: "Status", select: { equals: "In Review" } });
  assert.deepEqual(rows.map((r) => r.name), ["List a", "List b"]);
  assert.deepEqual(rows[0].imageUrls, ["https://s3/a.png"]);
});

test("updatePage PATCHes Status and, when present, Notes", async () => {
  const { fn, calls } = fakeFetch(() => ({}));
  await notionApi("t", fn).updatePage("p1", { status: "Needs changes", notes: "revise 2026-09-09: fix 3" });
  assert.equal(calls[0].url, "https://api.notion.com/v1/pages/p1");
  assert.equal(calls[0].init?.method, "PATCH");
  const props = JSON.parse(String(calls[0].init?.body)).properties;
  assert.deepEqual(props.Status, { select: { name: "Needs changes" } });
  assert.deepEqual(props.Notes, { rich_text: [{ type: "text", text: { content: "revise 2026-09-09: fix 3" } }] });
  await notionApi("t", fn).updatePage("p2", { status: "Approved" });
  assert.equal(JSON.parse(String(calls[1].init?.body)).properties.Notes, undefined);
});

test("pageImageUrls retrieves the page and returns freshly signed URLs", async () => {
  const { fn, calls } = fakeFetch(() => page("z"));
  const urls = await notionApi("t", fn).pageImageUrls("z");
  assert.equal(calls[0].url, "https://api.notion.com/v1/pages/z");
  assert.deepEqual(urls, ["https://s3/z.png"]);
});

test("a non-2xx Notion response throws with the status and message", async () => {
  const fn = async () => new Response(JSON.stringify({ message: "invalid token" }), { status: 401 });
  await assert.rejects(notionApi("bad", fn).queryInReview("db"), /401.*invalid token/);
});
