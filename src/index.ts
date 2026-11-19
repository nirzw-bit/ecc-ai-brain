import type { Env } from "./types";
import { handleAuth, requireOwner } from "./auth";
import { dispatchDueTasks } from "./scheduler";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer"
  }
});
const page = () => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><title>ECC OrBIt</title>
<style>
:root{font-family:system-ui,sans-serif;color-scheme:dark;background:#10151c;color:#e8eef5}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem}
main{width:min(100%,34rem);border:1px solid #344252;border-radius:1rem;padding:clamp(1.2rem,5vw,2rem);background:#18212b}
h1{margin:.2rem 0 .6rem;font-size:clamp(1.7rem,6vw,2.2rem)}p{line-height:1.55;color:#bdc9d6}
button{width:100%;padding:.9rem 1rem;border:0;border-radius:.65rem;background:#d7e7f7;color:#101820;font-weight:700;font-size:1rem}
small{display:block;margin-top:1rem;color:#9cabb9}#status{margin-top:1rem;overflow-wrap:anywhere}
</style></head><body><main><h1>ECC OrBIt</h1>
<p>Private owner console. Sign in with the authorized GitHub account to verify the development identity.</p>
<a href="/auth/github/start"><button type="button">Continue with GitHub</button></a>
<p id="status" role="status">Checking session…</p>
<form id="logout" action="/auth/logout" method="post" hidden><button type="submit">Sign out</button></form>
<small>Development environment · owner-only · no production connection</small>
</main><script>
(async()=>{const s=document.getElementById("status"),f=document.getElementById("logout");
try{const r=await fetch("/api/me",{credentials:"same-origin",cache:"no-store"});
if(r.ok){const d=await r.json();s.textContent="Authenticated as "+d.login;f.hidden=false;}
else{s.textContent="Not signed in. Privileged functions remain locked.";}
}catch(_){s.textContent="Session status unavailable.";}
})();
</script></body></html>`, { headers: {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer"
}});
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const authResponse = await handleAuth(request, env);
    if (authResponse) return authResponse;
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") return page();
    if (url.pathname === "/health" && request.method === "GET")
      return json({ ok: true, service: "ecc-orbit", mode: "development" });
    if (url.pathname === "/api/me" && request.method === "GET") {
      const owner = await requireOwner(request, env);
      return owner ? json({ authenticated: true, login: owner.login }) : json({ error: "unauthorized" }, 401);
    }
    return json({ error: "not_found" }, 404);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatchDueTasks(env));
  }
};
