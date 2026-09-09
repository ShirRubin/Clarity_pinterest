// review-worker/src/access.ts — verify Cloudflare Access's JWT ourselves. Access
// already sits in front of review.clarity-lists.com, but a direct workers.dev
// hit or a misrouted DNS record would bypass it; this makes the Worker refuse
// anything that did not come through the login.
import type { FetchLike } from "./notion-fetch.js";

export interface AccessOpts {
  teamDomain: string;
  aud: string;
  fetchFn?: FetchLike;
  now?: () => number;
}
export interface AccessIdentity {
  email?: string;
  sub: string;
}

export const certsUrl = (teamDomain: string) => `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;

type Jwk = JsonWebKey & { kid?: string };
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { keys: Jwk[]; at: number }>();

async function jwks(teamDomain: string, fetchFn: FetchLike): Promise<Jwk[]> {
  const hit = cache.get(teamDomain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.keys;
  const res = await fetchFn(certsUrl(teamDomain));
  if (!res.ok) throw new Error(`access: certs ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  cache.set(teamDomain, { keys, at: Date.now() });
  return keys;
}

const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(fromB64u(s))) as Record<string, unknown>;

export async function verifyAccessJwt(token: string | null, opts: AccessOpts): Promise<AccessIdentity> {
  if (!token) throw new Error("access: no token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("access: malformed token");
  const [h, p, s] = parts;
  const header = json(h);
  if (header.alg !== "RS256") throw new Error("access: alg must be RS256");
  const keys = await jwks(opts.teamDomain, opts.fetchFn ?? fetch);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("access: unknown key id");

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("access: bad signature");

  const claims = json(p) as { aud?: string | string[]; iss?: string; exp?: number; email?: string; sub?: string };
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.aud)) throw new Error("access: aud mismatch");
  if (claims.iss !== `https://${opts.teamDomain}.cloudflareaccess.com`) throw new Error("access: iss mismatch");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new Error("access: expired");
  if (!claims.sub) throw new Error("access: no subject");
  return { email: claims.email, sub: claims.sub };
}
