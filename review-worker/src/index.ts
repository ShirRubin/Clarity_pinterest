// review-worker/src/index.ts — the only file that touches the real network.
// Access first (403 without a valid token), then the handler with Notion deps.
import type { Env } from "./env.js";
import { verifyAccessJwt } from "./access.js";
import { notionApi } from "./notion-fetch.js";
import { handleRequest } from "./handler.js";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      await verifyAccessJwt(req.headers.get("Cf-Access-Jwt-Assertion"), { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD });
    } catch (err) {
      return new Response(`Forbidden — ${(err as Error).message}`, { status: 403 });
    }
    const notion = notionApi(env.NOTION_TOKEN);
    return handleRequest(req, {
      listInReview: () => notion.queryInReview(env.NOTION_DB_ID),
      updatePage: (id, patch) => notion.updatePage(id, patch),
      imageUrls: (id) => notion.pageImageUrls(id),
    });
  },
};
