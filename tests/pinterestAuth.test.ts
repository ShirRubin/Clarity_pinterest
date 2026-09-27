import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeUrl, needsRefresh, storeFromTokenResponse, type TokenStore } from "../src/pinterestAuth.js";

const now = Date.parse("2026-09-27T20:00:00Z");

test("a fresh token response becomes a store with absolute expiry times", () => {
  const s = storeFromTokenResponse(
    { access_token: "pina_x", refresh_token: "pinr_y", expires_in: 2592000, refresh_token_expires_in: 31536000, scope: "pins:read boards:read" },
    now,
  );
  assert.equal(s.accessToken, "pina_x");
  assert.equal(s.refreshToken, "pinr_y");
  assert.equal(s.expiresAt, now + 2592000 * 1000);
  assert.equal(s.refreshExpiresAt, now + 31536000 * 1000);
  assert.equal(s.scope, "pins:read boards:read");
});

test("a refresh response without a new refresh token keeps the old one and its expiry", () => {
  const old: TokenStore = { accessToken: "a", refreshToken: "r-old", expiresAt: now, refreshExpiresAt: now + 5000, scope: "x", obtainedAt: now - 1 };
  const s = storeFromTokenResponse({ access_token: "a2", expires_in: 100 }, now, old);
  assert.equal(s.accessToken, "a2");
  assert.equal(s.refreshToken, "r-old");
  assert.equal(s.refreshExpiresAt, now + 5000);
  assert.equal(s.expiresAt, now + 100 * 1000);
});

test("refresh is due when the access token expires within two days, never earlier", () => {
  const base: TokenStore = { accessToken: "a", refreshToken: "r", expiresAt: 0, refreshExpiresAt: now + 10 ** 9, scope: "", obtainedAt: now };
  assert.equal(needsRefresh({ ...base, expiresAt: now + 3 * 86400 * 1000 }, now), false);
  assert.equal(needsRefresh({ ...base, expiresAt: now + 1 * 86400 * 1000 }, now), true);
  assert.equal(needsRefresh({ ...base, expiresAt: now - 1 }, now), true);
});

test("the authorize URL carries the app id, redirect, scopes and state", () => {
  const u = new URL(authorizeUrl({ clientId: "1615659", redirectUri: "http://localhost:8085/callback", scopes: ["pins:read", "boards:read"], state: "abc" }));
  assert.equal(u.origin + u.pathname, "https://www.pinterest.com/oauth/");
  assert.equal(u.searchParams.get("client_id"), "1615659");
  assert.equal(u.searchParams.get("redirect_uri"), "http://localhost:8085/callback");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("scope"), "pins:read,boards:read");
  assert.equal(u.searchParams.get("state"), "abc");
});
