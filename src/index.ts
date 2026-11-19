import type { Env } from "./types";
import { handleAuth, requireOwner, requireReviewer } from "./auth";
import { dispatchDueTasks } from "./scheduler";
import { appendMemoryVersion } from "./memory";
import { requestApproval, approveRequest, consumeApproval } from "./approval-service";

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
main{width:min(100%,42rem);border:1px solid #344252;border-radius:1rem;padding:clamp(1.2rem,5vw,2rem);background:#18212b}
h1{margin:.2rem 0 .6rem;font-size:clamp(1.7rem,6vw,2.2rem)}p{line-height:1.55;color:#bdc9d6}
button{width:100%;padding:.9rem 1rem;border:0;border-radius:.65rem;background:#d7e7f7;color:#101820;font-weight:700;font-size:1rem}
input,textarea{width:100%;margin:.35rem 0 1rem;padding:.8rem;border:1px solid #526477;border-radius:.5rem;background:#0f1720;color:#fff;font:inherit}
label{display:block;font-weight:600;margin-top:.8rem}textarea{min-height:8rem;resize:vertical}
small{display:block;margin-top:1rem;color:#9cabb9}#status,#result{margin-top:1rem;overflow-wrap:anywhere}
#memory{border-top:1px solid #344252;margin-top:1.5rem;padding-top:1rem}
</style></head><body><main><h1>ECC OrBIt</h1>
<p>Private owner console. Memory entries are append-only and versioned. Corrections create a new version; existing evidence is retained.</p>
<a href="/auth/github/start" id="login"><button type="button">Continue with GitHub</button></a>
<p id="status" role="status">Checking session…</p>
<section id="memory" hidden>
<h2>Capture a memory</h2>
<form id="memoryForm">
<label for="key">Memory key</label><input id="key" maxlength="120" required placeholder="ecc.project.decision">
<label for="body">Memory content</label><textarea id="body" maxlength="32000" required placeholder="Record a fact, decision or lesson…"></textarea>
<label for="source">Evidence / source reference</label><input id="source" maxlength="500" placeholder="Chat, file name, URL or observation">
<button type="submit">Append memory version</button>
</form><p id="result" role="status"></p>
</section>
<form id="logout" action="/auth/logout" method="post" hidden><button type="submit">Sign out</button></form>
<small>Development environment · owner-only · no production connection</small>
</main><script>
(async()=>{const s=document.getElementById("status"),f=document.getElementById("logout"),m=document.getElementById("memory"),l=document.getElementById("login");
try{const r=await fetch("/api/me",{credentials:"same-origin",cache:"no-store"});
if(r.ok){const d=await r.json();s.textContent="Authenticated as "+d.login;m.hidden=false;f.hidden=false;l.hidden=true;}
else{s.textContent="Not signed in. Privileged functions remain locked.";}
}catch(_){s.textContent="Session status unavailable.";}
})();
document.getElementById("memoryForm").addEventListener("submit",async e=>{
e.preventDefault();const out=document.getElementById("result");out.textContent="Saving…";
try{const r=await fetch("/api/memory",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({
memoryKey:document.getElementById("key").value,content:document.getElementById("body").value,
provenance:{capture:"owner-console"},evidence:document.getElementById("source").value?[{evidenceType:"source_reference",sourceRef:document.getElementById("source").value}]:[]
})});
const d=await r.json();out.textContent=r.ok?"Saved version "+d.version+" · SHA-256 "+d.contentSha256:d.error||"Save failed";
}catch(_){out.textContent="Save failed. No success was reported.";}
});
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
    const approvalRoute = url.pathname.match(/^\/api\/approvals\/([a-f0-9-]+)\/(approve|consume)$/i);
    if (approvalRoute && request.method === "POST") {
      const reviewer = await requireReviewer(request, env);
      if (!reviewer) return json({ error: "unauthorized_reviewer" }, 401);
      try {
        if (approvalRoute[2] === "approve") {
          const result = await approveRequest(env.DB, approvalRoute[1], reviewer.subject);
          return json(result);
        }
        if (!request.headers.get("content-type")?.includes("application/json"))
          return json({ error: "application_json_required" }, 415);
        const raw = await request.text();
        if (raw.length > 16_000) return json({ error: "request_too_large" }, 413);
        const body = JSON.parse(raw) as {
          actionType?: string; target?: string; scope?: string; payload?: unknown;
        };
        if (typeof body.actionType !== "string" || typeof body.target !== "string" ||
            typeof body.scope !== "string" || body.payload === undefined)
          return json({ error: "invalid_approval_payload" }, 400);
        const result = await consumeApproval(env.DB, approvalRoute[1], reviewer.subject, {
          actionType: body.actionType, target: body.target, scope: body.scope, payload: body.payload
        });
        return json({ ...result, execution: "mock_only_no_external_action" });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "approval_transition_failed" }, 400);
      }
    }
    if (url.pathname.startsWith("/api/")) {
      const owner = await requireOwner(request, env);
      if (!owner) return json({ error: "unauthorized" }, 401);
      if (url.pathname === "/api/me" && request.method === "GET")
        return json({ authenticated: true, login: owner.login });
      if (url.pathname === "/api/tasks" && request.method === "POST") {
        if (!request.headers.get("content-type")?.includes("application/json"))
          return json({ error: "application_json_required" }, 415);
        try {
          const raw = await request.text();
          if (raw.length > 8_000) return json({ error: "request_too_large" }, 413);
          const body = JSON.parse(raw) as {
            taskType?: string; taskKey?: string; dueAt?: string; payload?: Record<string, unknown>;
          };
          if (!["heartbeat", "backup"].includes(body.taskType ?? "") ||
              typeof body.taskKey !== "string" || !body.taskKey.trim() || body.taskKey.length > 120 ||
              typeof body.dueAt !== "string" || !Number.isFinite(Date.parse(body.dueAt)) ||
              Date.parse(body.dueAt) < Date.now() - 60_000)
            return json({ error: "invalid_task_payload" }, 400);
          const payload = body.payload ?? {};
          const id = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO operational_tasks (id,task_key,task_type,payload_json,due_at,status,max_attempts,created_at) " +
            "VALUES (?,?,?,?,?,'pending',3,?)"
          ).bind(id, body.taskKey, body.taskType, JSON.stringify(payload), new Date(body.dueAt).toISOString(),
            new Date().toISOString()).run();
          return json({ ok: true, taskId: id, status: "pending" }, 201);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "task_creation_failed" }, 400);
        }
      }
      if (url.pathname === "/api/approvals" && request.method === "POST") {
        if (!request.headers.get("content-type")?.includes("application/json"))
          return json({ error: "application_json_required" }, 415);
        try {
          const raw = await request.text();
          if (raw.length > 16_000) return json({ error: "request_too_large" }, 413);
          const body = JSON.parse(raw) as {
            actionType?: string; target?: string; scope?: string; payload?: unknown; expiresAt?: string;
          };
          if (typeof body.actionType !== "string" || typeof body.target !== "string" ||
              typeof body.scope !== "string" || body.payload === undefined ||
              typeof body.expiresAt !== "string")
            return json({ error: "invalid_approval_payload" }, 400);
          const approval = await requestApproval(env.DB, owner.subject, {
            actionType: body.actionType, target: body.target, scope: body.scope, payload: body.payload
          }, body.expiresAt);
          return json(approval, 201);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "approval_request_failed" }, 400);
        }
      }
      if (url.pathname === "/api/approvals" && request.method === "GET") {
        const approvals = await env.DB.prepare(
          "SELECT id,action_type,target,scope,payload_sha256,requester_id,approver_id,expires_at,status,created_at " +
          "FROM approval_requests ORDER BY created_at DESC LIMIT 50"
        ).all();
        return json({ approvals: approvals.results });
      }
      if (url.pathname === "/api/memory" && request.method === "POST") {
        if (!request.headers.get("content-type")?.includes("application/json"))
          return json({ error: "application_json_required" }, 415);
        try {
          const raw = await request.text();
          if (raw.length > 64_000) return json({ error: "request_too_large" }, 413);
          const body = JSON.parse(raw) as {
            memoryKey?: string; content?: string; provenance?: unknown;
            evidence?: { evidenceType: string; sourceRef: string; excerptSha256?: string }[];
          };
          if (typeof body.memoryKey !== "string" || body.memoryKey.length > 120 ||
              typeof body.content !== "string" || !body.content.length || body.content.length > 32000 ||
              body.provenance === undefined || (body.evidence !== undefined && !Array.isArray(body.evidence)) ||
              (body.evidence ?? []).length > 20)
            return json({ error: "invalid_memory_payload" }, 400);
          for (const evidence of body.evidence ?? []) {
            if (!evidence || typeof evidence.evidenceType !== "string" || evidence.evidenceType.length > 80 ||
                typeof evidence.sourceRef !== "string" || !evidence.sourceRef.length || evidence.sourceRef.length > 500 ||
                (evidence.excerptSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(evidence.excerptSha256)))
              return json({ error: "invalid_evidence_payload" }, 400);
          }
          const version = await appendMemoryVersion(env.DB, {
            memoryKey: body.memoryKey, content: body.content, provenance: body.provenance,
            status: "proposed", evidence: body.evidence
          });
          return json({ ok: true, version: version.version, memoryId: version.memoryId,
            contentSha256: version.contentSha256, status: "proposed" }, 201);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "memory_write_failed" }, 400);
        }
      }
      if (url.pathname === "/api/memory" && request.method === "GET") {
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "memory_key_required" }, 400);
        const record = await env.DB.prepare(
          "SELECT id,memory_key,current_version,created_at FROM memory_records WHERE memory_key=?"
        ).bind(key).first();
        if (!record) return json({ error: "not_found" }, 404);
        const versions = await env.DB.prepare(
          "SELECT id,version,content,content_sha256,status,supersedes_version,provenance_json,created_at " +
          "FROM memory_versions WHERE memory_id=? ORDER BY version DESC LIMIT 50"
        ).bind(record.id).all();
        return json({ record, versions: versions.results });
      }
      return json({ error: "not_found" }, 404);
    }
    return json({ error: "not_found" }, 404);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatchDueTasks(env));
  }
};
