import type { Env } from "./types";

const COOKIE = "ecc_orbit_session";
const STATE_COOKIE = "ecc_orbit_oauth_state";
const SESSION_SECONDS = 900;
type Session = { login: string; subject: string };

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
function reviewerLogins(env: Env): string[] {
  return (env.REVIEWER_GITHUB_LOGINS ?? "").split(",").map(v => v.trim()).filter(Boolean);
}
async function hmac(keyText: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(keyText),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
async function issueSession(env: Env, login: string, subject: string): Promise<string> {
  if (!env.SESSION_HMAC_KEY || env.SESSION_HMAC_KEY.length < 32)
    throw new Error("session_signing_key_not_configured");
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    sub: subject, login, iat: now, exp: now + SESSION_SECONDS, iss: "ecc-orbit"
  })));
  return payload + "." + b64url(await hmac(env.SESSION_HMAC_KEY, payload));
}

async function readSession(request: Request, env: Env): Promise<Session | null> {
  if (!env.SESSION_HMAC_KEY || env.SESSION_HMAC_KEY.length < 32) return null;
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
      sub?: string; login?: string; exp?: number; iss?: string;
    };
    if (data.iss !== "ecc-orbit" || !data.login || !data.sub ||
        !data.exp || data.exp <= Math.floor(Date.now() / 1000)) return null;
    return { login: data.login, subject: data.sub };
  } catch { return null; }
}
async function requireRole(request: Request, env: Env, role: "owner" | "reviewer"): Promise<Session | null> {
  const session = await readSession(request, env);
  if (!session) return null;
  if (role === "owner" && session.login !== env.OWNER_GITHUB_LOGIN) return null;
  if (role === "reviewer" && !reviewerLogins(env).includes(session.login)) return null;
  const active = await env.DB.prepare(
    "SELECT 1 AS ok FROM owner_identity i JOIN owner_roles r ON r.owner_id=i.id " +
    "WHERE i.issuer=? AND i.subject=? AND r.role=? AND r.revoked_at IS NULL LIMIT 1"
  ).bind("https://github.com", session.subject, role).first<{ ok: number }>();
  return active ? session : null;
}
export async function requireOwner(request: Request, env: Env): Promise<Session | null> {
  return requireRole(request, env, "owner");
}
export async function requireReviewer(request: Request, env: Env): Promise<Session | null> {
  return requireRole(request, env, "reviewer");
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
    const user = await userResponse.json() as { login?: string; id?: number };
    const isOwner = user.login === env.OWNER_GITHUB_LOGIN;
    const isReviewer = !!user.login && reviewerLogins(env).includes(user.login);
    if ((!isOwner && !isReviewer) || !user.login || !user.id)
      return new Response("This GitHub identity is not authorized.", { status: 403 });
    const role = isOwner ? "owner" : "reviewer";
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO owner_identity (id,issuer,subject,created_at) VALUES (?,?,?,?)")
        .bind(crypto.randomUUID(), "https://github.com", String(user.id), now),
      env.DB.prepare("INSERT OR IGNORE INTO owner_roles (id,owner_id,role,granted_at) " +
        "SELECT ?,id,?,?,? FROM owner_identity WHERE issuer=? AND subject=? " +
        "AND NOT EXISTS (SELECT 1 FROM owner_roles WHERE owner_id=owner_identity.id AND role=? AND revoked_at IS NULL)")
        .bind(crypto.randomUUID(), role, now, now, "https://github.com", String(user.id), role)
    ]);
    const session = await issueSession(env, user.login, String(user.id));
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
