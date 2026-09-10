// tests/review-access.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { verifyAccessJwt, certsUrl } from "../review-worker/src/access.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const TEAM = "clarity";
const AUD = "aud-tag-123";
const NOW = 1_800_000_000;

function jwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }) {
  const h = b64u(JSON.stringify(header));
  const p = b64u(JSON.stringify(claims));
  const sig = nodeSign("sha256", Buffer.from(`${h}.${p}`), privateKey);
  return `${h}.${p}.${b64u(sig)}`;
}
const good = () => ({ aud: [AUD], iss: `https://${TEAM}.cloudflareaccess.com`, exp: NOW + 600, iat: NOW - 10, email: "me@example.com", sub: "u1" });
const fetchFn = async (url: string) => {
  assert.equal(url, certsUrl(TEAM));
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
};
const opts = { teamDomain: TEAM, aud: AUD, fetchFn, now: () => NOW };

test("a valid token yields the identity", async () => {
  const id = await verifyAccessJwt(jwt(good()), opts);
  assert.deepEqual(id, { email: "me@example.com", sub: "u1" });
});

test("missing token is refused", async () => {
  await assert.rejects(verifyAccessJwt(null, opts), /access: no token/);
});

test("wrong audience is refused", async () => {
  await assert.rejects(verifyAccessJwt(jwt({ ...good(), aud: ["other"] }), opts), /access: aud/);
});

test("expired token is refused", async () => {
  await assert.rejects(verifyAccessJwt(jwt({ ...good(), exp: NOW - 1 }), opts), /access: expired/);
});

test("wrong issuer is refused", async () => {
  await assert.rejects(verifyAccessJwt(jwt({ ...good(), iss: "https://evil.cloudflareaccess.com" }), opts), /access: iss/);
});

test("a tampered payload fails signature verification", async () => {
  const [h, , s] = jwt(good()).split(".");
  const forged = `${h}.${b64u(JSON.stringify({ ...good(), email: "attacker@example.com" }))}.${s}`;
  await assert.rejects(verifyAccessJwt(forged, opts), /access: bad signature/);
});

test("unknown kid is refused", async () => {
  await assert.rejects(verifyAccessJwt(jwt(good(), { alg: "RS256", kid: "nope" }), opts), /access: unknown key/);
});

test("alg other than RS256 is refused before any key lookup", async () => {
  await assert.rejects(verifyAccessJwt(jwt(good(), { alg: "none", kid: "k1" }), opts), /access: alg/);
});

test("a malformed header segment is refused", async () => {
  const [, p, s] = jwt(good()).split(".");
  const forged = `!!!not-base64!!!.${p}.${s}`;
  await assert.rejects(verifyAccessJwt(forged, opts), /access: malformed token/);
});

test("a malformed signature segment is refused", async () => {
  const [h, p] = jwt(good()).split(".");
  const forged = `${h}.${p}.!!!not-base64!!!`;
  await assert.rejects(verifyAccessJwt(forged, opts), /access: malformed token/);
});

test("JWKS cache refetches once after 30s when a key rotates in, but not again within 30s", async () => {
  const rotateKp = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk1r = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const jwk2r = { ...rotateKp.publicKey.export({ format: "jwk" }), kid: "k2", alg: "RS256", use: "sig" };

  const ROTATE_TEAM = "clarity-rotate";
  const ROTATE_AUD = "aud-rotate-789";
  let rotateNow = NOW;
  let currentKeys = [jwk1r];
  let fetchCalls = 0;
  const rotateFetch = async (url: string) => {
    fetchCalls++;
    assert.equal(url, certsUrl(ROTATE_TEAM));
    return new Response(JSON.stringify({ keys: currentKeys }), { status: 200 });
  };
  const rotateOpts = { teamDomain: ROTATE_TEAM, aud: ROTATE_AUD, fetchFn: rotateFetch, now: () => rotateNow };

  const sign = (kid: string, priv: typeof privateKey) => {
    const header = { alg: "RS256", kid, typ: "JWT" };
    const claims = {
      aud: [ROTATE_AUD],
      iss: `https://${ROTATE_TEAM}.cloudflareaccess.com`,
      exp: rotateNow + 600,
      iat: rotateNow - 10,
      email: "me@example.com",
      sub: "u1",
    };
    const h = b64u(JSON.stringify(header));
    const p = b64u(JSON.stringify(claims));
    const sig = nodeSign("sha256", Buffer.from(`${h}.${p}`), priv);
    return `${h}.${p}.${b64u(sig)}`;
  };

  // 1. token signed with k1 verifies against the initial JWKS fetch.
  const id1 = await verifyAccessJwt(sign("k1", privateKey), rotateOpts);
  assert.deepEqual(id1, { email: "me@example.com", sub: "u1" });
  assert.equal(fetchCalls, 1);

  // 2. Cloudflare rotates its key: the endpoint now serves k2 only, and time
  // moves forward 60s (past the 30s refetch floor).
  currentKeys = [jwk2r];
  rotateNow += 60;

  // 3. a token signed by the new key verifies — the cache missed k2, was
  // older than 30s, so it refetched once (2 fetch calls total).
  const id2 = await verifyAccessJwt(sign("k2", rotateKp.privateKey), rotateOpts);
  assert.deepEqual(id2, { email: "me@example.com", sub: "u1" });
  assert.equal(fetchCalls, 2);

  // 4. an unknown kid at the same `now` still fails — the cache was just
  // refreshed (age 0s), so no third fetch happens within the 30s floor.
  await assert.rejects(verifyAccessJwt(sign("k9", privateKey), rotateOpts), /access: unknown key/);
  assert.equal(fetchCalls, 2);
});
