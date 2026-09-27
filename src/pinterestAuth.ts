// src/pinterestAuth.ts — Pinterest OAuth for the pipeline's own account.
//
// The dashboard token pasted into .env expired within ~36 hours (Sep 27), which
// broke `clarity report` and the nightly `reconcile api`. This module replaces
// it with the proper flow: `clarity auth` logs in once through the browser and
// stores an access token (30 days) plus a refresh token (1 year) in
// data/pinterest-oauth.json (git-ignored). Every API call goes through
// getAccessToken(), which refreshes the access token by itself when it is
// within two days of expiry. PINTEREST_ACCESS_TOKEN in .env stays as a fallback
// for the days before the first login.
//
// Same rules as pinterestApi.ts: our own account only, read-only scopes, and
// the tokens never leave this machine.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { exec } from "node:child_process";
import path from "node:path";

export const AUTHORIZE_URL = "https://www.pinterest.com/oauth/";
export const TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";
export const DEFAULT_REDIRECT = "http://localhost:8085/callback";
/** Read-only, own account, secret boards included (six boards are hidden). */
export const DEFAULT_SCOPES = ["user_accounts:read", "pins:read", "boards:read", "pins:read_secret", "boards:read_secret"];
export const STORE_PATH = path.join("data", "pinterest-oauth.json");

/** Refresh when the access token has less than this long to live. */
const REFRESH_AHEAD_MS = 2 * 86400 * 1000;

export interface TokenStore {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch */
  expiresAt: number;
  refreshExpiresAt: number;
  scope: string;
  obtainedAt: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
}

export function storeFromTokenResponse(r: TokenResponse, now = Date.now(), previous?: TokenStore): TokenStore {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? previous?.refreshToken ?? "",
    expiresAt: now + r.expires_in * 1000,
    refreshExpiresAt: r.refresh_token_expires_in ? now + r.refresh_token_expires_in * 1000 : previous?.refreshExpiresAt ?? 0,
    scope: r.scope ?? previous?.scope ?? "",
    obtainedAt: now,
  };
}

export function needsRefresh(s: TokenStore, now = Date.now()): boolean {
  return s.expiresAt - now < REFRESH_AHEAD_MS;
}

export function authorizeUrl(o: { clientId: string; redirectUri: string; scopes: string[]; state: string }): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", o.scopes.join(","));
  u.searchParams.set("state", o.state);
  return u.toString();
}

function appCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PINTEREST_APP_ID;
  const clientSecret = process.env.PINTEREST_APP_SECRET;
  if (!clientId || !clientSecret) throw new Error("PINTEREST_APP_ID and PINTEREST_APP_SECRET must be set in .env");
  return { clientId, clientSecret };
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = appCredentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Pinterest OAuth ${res.status} (${body.grant_type}): ${text.slice(0, 300)}`);
  return JSON.parse(text) as TokenResponse;
}

export async function readStore(file = STORE_PATH): Promise<TokenStore | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as TokenStore;
  } catch {
    return undefined;
  }
}

export async function writeStore(s: TokenStore, file = STORE_PATH): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(s, null, 2) + "\n", "utf8");
}

let cached: TokenStore | undefined;
let refreshing: Promise<TokenStore> | undefined;

/**
 * The access token to use right now: the stored one, refreshed first if it is
 * about to expire; otherwise the .env fallback. Concurrent callers share one refresh.
 */
export async function getAccessToken(): Promise<string> {
  cached ??= await readStore();
  if (!cached) {
    const t = process.env.PINTEREST_ACCESS_TOKEN;
    if (!t) throw new Error("No Pinterest token: run `npm run clarity -- auth` once (or set PINTEREST_ACCESS_TOKEN in .env)");
    return t;
  }
  if (needsRefresh(cached)) {
    if (cached.refreshExpiresAt && cached.refreshExpiresAt < Date.now()) {
      throw new Error("The Pinterest refresh token has expired: run `npm run clarity -- auth` again");
    }
    // refresh_on asks Pinterest for a new refresh token too (continuous refresh);
    // the first login only granted a 60-day one. If it is ignored, the old one is kept.
    refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: cached.refreshToken, scope: cached.scope, refresh_on: "true" })
      .then(async (r) => {
        const next = storeFromTokenResponse(r, Date.now(), cached);
        await writeStore(next);
        cached = next;
        return next;
      })
      .finally(() => { refreshing = undefined; });
    await refreshing;
  }
  return cached.accessToken;
}

/** For `clarity auth status`. */
export function describeStore(s: TokenStore | undefined, now = Date.now()): string {
  if (!s) return "No OAuth token stored (data/pinterest-oauth.json). Using PINTEREST_ACCESS_TOKEN from .env if set. Run `clarity auth` to log in.";
  const days = (ms: number) => Math.floor((ms - now) / 86400000);
  return [
    `Access token: expires in ${days(s.expiresAt)} days (${new Date(s.expiresAt).toISOString().slice(0, 10)}); refreshes itself within 2 days of expiry.`,
    `Refresh token: expires in ${days(s.refreshExpiresAt)} days (${new Date(s.refreshExpiresAt).toISOString().slice(0, 10)}); run \`clarity auth\` again before then.`,
    `Scopes: ${s.scope || "(not reported)"}`,
    `Obtained: ${new Date(s.obtainedAt).toISOString()}`,
  ].join("\n");
}

function openBrowser(url: string): void {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

/**
 * `clarity auth`: one browser login, then the code is exchanged and stored.
 * The redirect URI must be registered on the app (developers.pinterest.com →
 * app 1615659 → Redirect URIs).
 */
export async function runAuth(o: { redirectUri?: string; scopes?: string[]; port?: number; timeoutMs?: number } = {}): Promise<TokenStore> {
  const { clientId } = appCredentials();
  const redirectUri = o.redirectUri ?? DEFAULT_REDIRECT;
  const scopes = o.scopes ?? DEFAULT_SCOPES;
  const port = o.port ?? Number(new URL(redirectUri).port || 8085);
  const state = randomBytes(12).toString("hex");
  const url = authorizeUrl({ clientId, redirectUri, scopes, state });

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (u.pathname !== new URL(redirectUri).pathname) { res.writeHead(404); res.end(); return; }
      const err = u.searchParams.get("error");
      const got = u.searchParams.get("code");
      const st = u.searchParams.get("state");
      const ok = !err && !!got && st === state;
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(ok
        ? "<p style='font:18px sans-serif'>Clarity is connected to Pinterest. You can close this tab.</p>"
        : `<p style='font:18px sans-serif'>Login failed: ${err ?? "state mismatch"}. Go back to the terminal.</p>`);
      server.close();
      if (ok) resolve(got!); else reject(new Error(`Pinterest login failed: ${err ?? "state mismatch"}`));
    });
    server.on("error", reject);
    server.listen(port, () => {
      console.log(`Open this page to connect the Clarity Pinterest account (waiting on ${redirectUri}):\n\n  ${url}\n`);
      openBrowser(url);
    });
    setTimeout(() => { server.close(); reject(new Error("Timed out waiting for the Pinterest login")); }, o.timeoutMs ?? 5 * 60 * 1000).unref();
  });

  const store = storeFromTokenResponse(await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }));
  await writeStore(store);
  cached = store;
  console.log(`✓ Connected. Tokens saved to ${STORE_PATH}\n${describeStore(store)}`);
  return store;
}
