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
