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
// JWKS cache lifetime — a Worker isolate lives across requests. Measured in
// seconds against the injectable `now()` so the cache clock is testable.
const CACHE_TTL_S = 10 * 60;
// Floor between refetches triggered by an unknown kid: bounds refetch storms
// from junk tokens while still picking up a real Cloudflare key rotation.
const MIN_REFETCH_GAP_S = 30;
const cache = new Map<string, { keys: Jwk[]; at: number }>();

async function fetchKeys(teamDomain: string, fetchFn: FetchLike, now: number): Promise<Jwk[]> {
  const res = await fetchFn(certsUrl(teamDomain));
  if (!res.ok) throw new Error(`access: certs ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  cache.set(teamDomain, { keys, at: now });
  return keys;
}

// Resolves the signing key for `kid`. A cache hit that lacks `kid` is allowed
// one refetch — but only once the cached entry is at least MIN_REFETCH_GAP_S
// old — so a forged/unknown kid can't force repeated fetches, while a real
// key rotation on Cloudflare's side is picked up well inside CACHE_TTL_S.
async function findKey(teamDomain: string, kid: string | undefined, fetchFn: FetchLike, now: number): Promise<Jwk> {
  const hit = cache.get(teamDomain);
  let keys = hit && now - hit.at < CACHE_TTL_S ? hit.keys : await fetchKeys(teamDomain, fetchFn, now);
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    const entry = cache.get(teamDomain);
    const age = entry ? now - entry.at : Infinity;
    if (age >= MIN_REFETCH_GAP_S) {
      keys = await fetchKeys(teamDomain, fetchFn, now);
      jwk = keys.find((k) => k.kid === kid);
    }
  }
  if (!jwk) throw new Error("access: unknown key id");
  return jwk;
}

const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(fromB64u(s))) as Record<string, unknown>;

// `atob`/`JSON.parse` throw raw DOMException/SyntaxError on garbage input —
// never let those escape past our "access: <reason>" contract.
function decodeOrThrow<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new Error("access: malformed token");
  }
}

export async function verifyAccessJwt(token: string | null, opts: AccessOpts): Promise<AccessIdentity> {
  if (!token) throw new Error("access: no token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("access: malformed token");
  const [h, p, s] = parts;
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();

  const header = decodeOrThrow(() => json(h));
  if (header.alg !== "RS256") throw new Error("access: alg must be RS256");

  const jwk = await findKey(opts.teamDomain, header.kid as string | undefined, opts.fetchFn ?? fetch, now);

  const sigBytes = decodeOrThrow(() => fromB64u(s));

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sigBytes, new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("access: bad signature");

  const claims = decodeOrThrow(
    () => json(p) as { aud?: string | string[]; iss?: string; exp?: number; email?: string; sub?: string },
  );
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.aud)) throw new Error("access: aud mismatch");
  if (claims.iss !== `https://${opts.teamDomain}.cloudflareaccess.com`) throw new Error("access: iss mismatch");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new Error("access: expired");
  if (!claims.sub) throw new Error("access: no subject");
  return { email: claims.email, sub: claims.sub };
}
