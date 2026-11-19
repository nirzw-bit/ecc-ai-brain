import type { Env } from "./types";

const COOKIE = "ecc_orbit_session";
const STATE_COOKIE = "ecc_orbit_oauth_state";
const SESSION_SECONDS = 900;

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeB64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}
function setCookie(name: string, value: string, maxAge: number): string {
  return name + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}
async function hmac(keyText: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(keyText),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
async function issueSession(env: Env, login: string): Promise<string> {
  if (!env.SESSION_HMAC_KEY || env.SESSION_HMAC_KEY.length < 32) throw new Error("session_signing_key_not_configured");
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    sub: login, iat: now, exp: now + SESSION_SECONDS, iss: "ecc-orbit"
  })));
  return payload + "." + b64url(await hmac(env.SESSION_HMAC_KEY, payload));
}

export async function requireOwner(request: Request, env: Env): Promise<{ login: string } | null> {
  if (!env.OWNER_GITHUB_LOGIN || !env.SESSION_HMAC_KEY || env.SESSION_HMAC_KEY.length < 32) return null;
  const token = cookie(request, COOKIE);
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const expected = await hmac(env.SESSION_HMAC_KEY, payload);
    const supplied = decodeB64url(signature);
    if (expected.length !== supplied.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ supplied[i];
    if (diff !== 0) return null;
    const data = JSON.parse(new TextDecoder().decode(decodeB64url(payload))) as {
      sub?: string; exp?: number; iss?: string;
    };
    if (data.iss !== "ecc-orbit" || data.sub !== env.OWNER_GITHUB_LOGIN ||
        !data.exp || data.exp <= Math.floor(Date.now() / 1000)) return null;
    return { login: data.sub };
  } catch { return null; }
}

export async function handleAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/auth/github/start" && request.method === "GET") {
    if (!env.GITHUB_OAUTH_CLIENT_ID || !env.OWNER_GITHUB_LOGIN)
      return new Response("Owner OAuth is not configured.", { status: 503 });
    const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const callback = url.origin + "/auth/github/callback";
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
    authorize.searchParams.set("redirect_uri", callback);
    authorize.searchParams.set("scope", "read:user");
    authorize.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: {
      Location: authorize.toString(), "Set-Cookie": setCookie(STATE_COOKIE, state, 600),
      "Cache-Control": "no-store"
    }});
  }
  if (url.pathname === "/auth/github/callback" && request.method === "GET") {
    const state = url.searchParams.get("state");
    const expectedState = cookie(request, STATE_COOKIE);
    const code = url.searchParams.get("code");
    if (!state || !expectedState || state !== expectedState || !code)
      return new Response("OAuth state validation failed.", { status: 400 });
    if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET ||
        !env.OWNER_GITHUB_LOGIN || !env.SESSION_HMAC_KEY)
      return new Response("Owner OAuth is not configured.", { status: 503 });
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: env.GITHUB_OAUTH_CLIENT_SECRET, code })
    });
    if (!tokenResponse.ok) return new Response("OAuth token exchange failed.", { status: 502 });
    const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) return new Response("OAuth authorization failed.", { status: 401 });
    const userResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: "Bearer " + tokenData.access_token,
        Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ECC-OrBIt" }
    });
    if (!userResponse.ok) return new Response("GitHub identity verification failed.", { status: 502 });
    const user = await userResponse.json() as { login?: string };
    if (user.login !== env.OWNER_GITHUB_LOGIN)
      return new Response("This GitHub identity is not authorized.", { status: 403 });
    const session = await issueSession(env, user.login);
    const headers = new Headers({ Location: "/", "Cache-Control": "no-store" });
    headers.append("Set-Cookie", setCookie(COOKIE, session, SESSION_SECONDS));
    headers.append("Set-Cookie", setCookie(STATE_COOKIE, "", 0));
    return new Response(null, { status: 302, headers });
  }
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    return new Response(null, { status: 303, headers: {
      Location: "/", "Set-Cookie": setCookie(COOKIE, "", 0), "Cache-Control": "no-store"
    }});
  }
  return null;
}
