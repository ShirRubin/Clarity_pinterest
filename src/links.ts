// src/links.ts — where every live pin actually sends a reader. Pure; the
// `clarity links` stage feeds it the API pin list and the blog's post slugs.
import type { ApiPin } from "./report.js";

export interface LinkAudit {
  ok: number;
  /** No destination at all — the pin can never send anyone to the blog. */
  noLink: ApiPin[];
  /** Points somewhere other than clarity-lists.com (a board, an old site). */
  offSite: ApiPin[];
  /** On clarity-lists.com but not a post (the homepage, /lists). */
  notAPost: ApiPin[];
  /** A /posts/<slug> the blog does not have — a 404 for every click. */
  deadPost: ApiPin[];
  /** Repins of our own pins, skipped: they have no link of their own to fix. */
  repins: number;
}

const SITE = /^(www\.)?clarity-lists\.com$/;
const POST = /^\/posts\/([^/]+)\/?$/;

export function auditLinks(pins: ApiPin[], slugs: Set<string>): LinkAudit {
  const own = new Set(pins.map((p) => p.id));
  const r: LinkAudit = { ok: 0, noLink: [], offSite: [], notAPost: [], deadPost: [], repins: 0 };
  for (const p of pins) {
    if (p.parentPinId && own.has(p.parentPinId)) {
      r.repins++;
      continue;
    }
    if (!p.link?.trim()) {
      r.noLink.push(p);
      continue;
    }
    let url: URL;
    try {
      url = new URL(p.link);
    } catch {
      r.offSite.push(p);
      continue;
    }
    if (!SITE.test(url.hostname)) {
      r.offSite.push(p);
      continue;
    }
    const post = POST.exec(url.pathname);
    if (!post) r.notAPost.push(p);
    else if (!slugs.has(post[1])) r.deadPost.push(p);
    else r.ok++;
  }
  return r;
}
