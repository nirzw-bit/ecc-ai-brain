import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const MAX_BODY_BYTES = 64 * 1024;
const MAX_KEY = 160;
const MAX_STATEMENT = 8000;
const MAX_SOURCE = 1000;
const MAX_REVISION_NOTE = 2000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-ecc-worker-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function bad(message: string, status = 400) {
  return response({ ok: false, error: message }, status);
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
async function readJson(req: Request): Promise<{ value: Record<string, unknown> | null; error: string | null }> {
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { value: null, error: "Request body too large" };
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { value: null, error: "Request body too large" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: null, error: "JSON object required" };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch {
    return { value: null, error: "Valid JSON required" };
  }
}
function str(value: unknown, max: number, name: string, required = true): string | null {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null)) return null;
    throw new Error(`${name} must be a string`);
  }
  const v = value.trim();
  if ((required && !v) || v.length > max) {
    throw new Error(`${name} is empty or exceeds its allowed length`);
  }
  return v;
}
function confidence(value: unknown): number {
  if (value === undefined || value === null) return 0.8;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("confidence must be a number from 0 to 1");
  }
  return value;
}
function expiry(value: unknown): string {
  const now = Date.now();
  const max = now + 7 * 24 * 60 * 60 * 1000;
  if (value === undefined || value === null || value === "") {
    return new Date(max).toISOString();
  }
  if (typeof value !== "string") throw new Error("expires_at must be an ISO timestamp");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= now || parsed > max) {
    throw new Error("expires_at must be in the future and no more than seven days away");
  }
  return new Date(parsed).toISOString();
}
function roleOf(user: { app_metadata?: Record<string, unknown> }): string {
  const role = user.app_metadata?.ecc_role;
  return typeof role === "string" ? role : "";
}
function allowed(role: string, _route: "memory" | "propose" | "review") {
  // Single-owner deployment: only a trusted app_metadata ecc_role=owner may use protected routes.
  return role === "owner";
}
function authorizationFailure() {
  return bad("Forbidden: trusted ECC role is required for this operation", 403);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "");

  if (req.method === "GET" && path.endsWith("/health")) {
    try {
      const result = await rpc("ecc_memory_get", { p_memory_key: "__health_probe__" });
      if (!result || typeof result !== "object" || !("current" in result) || !Array.isArray((result as Record<string, unknown>).history)) {
        return response({ ok: false, service: "ecc-memory-api", database: "invalid_response" }, 503);
      }
      return response({ ok: true, service: "ecc-memory-api", database: "reachable", payload_valid: true });
    } catch {
      return response({ ok: false, service: "ecc-memory-api", database: "unavailable" }, 503);
    }
  }

  if (req.method === "POST" && (path.endsWith("/backup/export") || path.endsWith("/backup/restore-test"))) {
    const secret = req.headers.get("x-ecc-worker-secret") ?? "";
    if (!secret) return bad("Backup worker authorization required", 401);
    try {
      if (path.endsWith("/backup/export")) {
        const snapshot = await rpc("ecc_backup_export", { p_secret: secret });
        if (!snapshot || typeof snapshot !== "object") return bad("Backup export response invalid", 502);
        return response({ ok: true, snapshot });
      }
      const parsed = await readJson(req);
      if (parsed.error) return bad(parsed.error, parsed.error === "Request body too large" ? 413 : 400);
      const snapshot = parsed.value?.snapshot;
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return bad("Snapshot object required");
      const result = await rpc("ecc_backup_restore_test", { p_secret: secret, p_snapshot: snapshot });
      if (!result || typeof result !== "object" || (result as Record<string, unknown>).passed !== true) {
        return bad("Backup restore validation did not pass", 422);
      }
      return response({ ok: true, recovery: result });
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      return bad(msg.includes("authorization") ? "Backup authorization failed" : "Backup operation failed", msg.includes("authorization") ? 401 : 400);
    }
  }

  if (!["GET", "POST"].includes(req.method)) return bad("Method not allowed", 405);
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return bad("Bearer access token required", 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return bad("Valid signed-in Supabase user required", 401);

  const actor = userData.user.id;
  const role = roleOf(userData.user);
  const isMemoryRoute = path.endsWith("/memory/save") || path.endsWith("/memory/get") || path.endsWith("/memory/revise");
  const isProposeRoute = path.endsWith("/approval/propose");
  const isReviewRoute = path.endsWith("/approval/review") || path.endsWith("/approval/execute");
  const isCognitionRoute = path.endsWith("/cognition/assess") || path.endsWith("/cognition/feedback");
  const isGrowthRoute = path.endsWith("/growth/retrieve") || path.endsWith("/growth/lesson");
  let ownerAllowlisted = false;
  if ((isMemoryRoute || isProposeRoute || isReviewRoute || isCognitionRoute || isGrowthRoute) && role === "owner") {
    try { ownerAllowlisted = (await rpc("ecc_owner_is_authorized", { p_user_id: actor })) === true; }
    catch { return bad("Owner authorization could not be verified", 503); }
  }
  if (isMemoryRoute && (!allowed(role, "memory") || !ownerAllowlisted)) return authorizationFailure();
  if (isProposeRoute && (!allowed(role, "propose") || !ownerAllowlisted)) return authorizationFailure();
  if (isReviewRoute && (!allowed(role, "review") || !ownerAllowlisted)) return authorizationFailure();
  if (isCognitionRoute && (role !== "owner" || !ownerAllowlisted)) return authorizationFailure();
  if (isGrowthRoute && (role !== "owner" || !ownerAllowlisted)) return authorizationFailure();

  try {
    if (req.method === "GET" && path.endsWith("/growth/retrieve")) {
      const rawLimit = url.searchParams.get("limit");
      const limit = rawLimit === null ? 20 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return bad("limit must be an integer from 1 to 100");
      const result = await rpc("ecc_growth_retrieve", { p_limit: limit });
      if (!result || typeof result !== "object" || !Array.isArray((result as Record<string, unknown>).lessons)) {
        return bad("Growth memory response invalid", 502);
      }
      return response({ ok: true, growth_memory: result });
    }
    if (req.method === "POST" && path.endsWith("/growth/lesson")) {
      const parsed = await readJson(req);
      if (parsed.error) return bad(parsed.error, parsed.error === "Request body too large" ? 413 : 400);
      const b = parsed.value!;
      const lesson_key = str(b.lesson_key, 160, "lesson_key")!;
      const claim = str(b.claim, 4000, "claim")!;
      const root_cause = str(b.root_cause, 4000, "root_cause")!;
      const corrective_rule = str(b.corrective_rule, 4000, "corrective_rule")!;
      const source_locator = str(b.source_locator, 2000, "source_locator")!;
      const evidence_type = str(b.evidence_type, 40, "evidence_type")!;
      const capture_method = str(b.capture_method, 500, "capture_method")!;
      const excerpt = str(b.excerpt, 8000, "excerpt", false);
      const content_sha256 = str(b.content_sha256, 64, "content_sha256", false);
      const provenance = b.provenance ?? {};
      if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return bad("provenance must be a JSON object");
      const result = await rpc("ecc_growth_lesson_propose", {
        p_lesson_key: lesson_key, p_claim: claim, p_root_cause: root_cause,
        p_corrective_rule: corrective_rule, p_source_locator: source_locator,
        p_evidence_type: evidence_type, p_capture_method: capture_method,
        p_excerpt: excerpt, p_content_sha256: content_sha256, p_provenance: provenance,
      });
      if (!result || typeof result !== "object" || (result as Record<string, unknown>).status !== "PROPOSED") {
        return bad("Growth lesson response invalid", 502);
      }
      return response({ ok: true, actor, lesson: result }, 201);
    }
    if (req.method === "POST" && path.endsWith("/cognition/feedback")) {
      const parsed = await readJson(req);
      if (parsed.error) return bad(parsed.error, parsed.error === "Request body too large" ? 413 : 400);
      const b = parsed.value!;
      const allowedFields = ["feedback_type", "target_key", "rating", "notes", "source"];
      if (Object.keys(b).some(k => !allowedFields.includes(k))) return bad("Unexpected feedback field");
      const feedback_type = str(b.feedback_type, 40, "feedback_type")!;
      const source = str(b.source, 1000, "source")!;
      const target_key = str(b.target_key, 160, "target_key", false);
      const notes = str(b.notes, 1000, "notes", false);
      let rating: number | null = null;
      if (b.rating !== undefined && b.rating !== null) {
        if (typeof b.rating !== "number" || !Number.isInteger(b.rating) || b.rating < -1 || b.rating > 1) return bad("rating must be -1, 0, or 1");
        rating = b.rating;
      }
      const feedback = await rpc("ecc_cognition_feedback_record", {
        p_feedback_type: feedback_type, p_source: source, p_target_key: target_key,
        p_rating: rating, p_notes: notes, p_actor: actor,
      });
      if (!feedback || typeof feedback !== "object" || !("id" in feedback)) return bad("Cognition feedback response invalid", 502);
      return response({ ok: true, actor, feedback }, 201);
    }
    if (req.method === "POST" && path.endsWith("/cognition/assess")) {
      const parsed = await readJson(req);
      if (parsed.error) return bad(parsed.error, parsed.error === "Request body too large" ? 413 : 400);
      if (Object.keys(parsed.value!).length !== 0) return bad("Cognition assessment accepts an empty JSON object only");
      const assessment = await rpc("ecc_cognition_assess", { p_actor: actor });
      if (assessment && typeof assessment === "object" && (assessment as Record<string, unknown>).rate_limited === true) {
        return response({ ok: false, error: "Cognition assessment rate limit exceeded", retry_after_seconds: (assessment as Record<string, unknown>).retry_after_seconds }, 429);
      }
      if (!assessment || typeof assessment !== "object" || !("metrics" in assessment) || !("assessment_id" in assessment)) {
        return bad("Cognition assessment response invalid", 502);
      }
      return response({ ok: true, actor, assessment }, 201);
    }
    if (req.method === "POST" && path.endsWith("/memory/save")) {
      const parsed = await readJson(req);
      if (parsed.error) return bad(parsed.error, parsed.error === "Request body too large" ? 413 : 400);
      const b = parsed.value!;
      const memory_key = str(b.memory_key, MAX_KEY, "memory_key")!;
      const record_type = str(b.record_type, 40, "record_type")!;
      const statement = str(b.statement, MAX_STATEMENT, "statement")!;
      const source = str(b.source, MAX_SOURCE, "source")!;
      const revision_note = str(b.revision_note ?? "Created through authenticated memory API", MAX_REVISION_NOTE, "revision_note")!;
      const sensitivity = str(b.sensitivity ?? "normal", 20, "sensitivity")!;
      if (!["instruction","preference","identity","project","fact","decision","hypothesis","task","event","constraint"].includes(record_type)) return bad("record_type is not allowed");
      if (!["normal","personal","sensitive"].includes(sensitivity)) return bad("sensitivity is not allowed");
      const memory = await rpc("ecc_memory_save", {
        p_memory_key: memory_key, p_record_type: record_type, p_statement: statement,
        p_source: source, p_confidence: confidence(b.confidence), p_status: "proposed",
        p_sensitivity: sensitivity, p_revision_note: revision_note, p_actor: actor,
      });
      return response({ ok: true, actor, memory }, 201);
    }
    if (req.method === "GET" && path.endsWith("/memory/get")) {
      const key = str(url.searchParams.get("key"), MAX_KEY, "key")!;
      const memory = await rpc("ecc_memory_get", { p_memory_key: key });
      if (!memory || typeof memory !== "object" || !("current" in memory) || !Array.isArray((memory as Record<string, unknown>).history)) {
        return bad("Memory response invalid", 502);
      }
      return response({ ok: true, memory });
    }
    if (req.method === "POST" && path.endsWith("/memory/revise")) {
      const parsed = await readJson(req);
      if (parsed.error) return bad(parsed.error, parsed.error === "Request body too large" ? 413 : 400);
      const b = parsed.value!;
      const memory_key = str(b.memory_key, MAX_KEY, "memory_key")!;
      const statement = str(b.statement, MAX_STATEMENT, "statement")!;
      const source = str(b.source, MAX_SOURCE, "source")!;
      const revision_note = str(b.revision_note ?? "Revised through authenticated memory API", MAX_REVISION_NOTE, "revision_note")!;
      const revision = await rpc("ecc_memory_revise", {
        p_memory_key: memory_key, p_statement: statement, p_source: source,
        p_confidence: confidence(b.confidence), p_revision_note: revision_note, p_actor: actor,
      });
      return response({ ok: true, actor, revision });
    }
    if (req.method === "POST" && path.endsWith("/approval/propose")) {
      const parsed = await readJson(req);
      if (parsed.error) return bad(parsed.error, parsed.error === "Request body too large" ? 413 : 400);
      const b = parsed.value!;
      const action = str(b.action, 80, "action")!;
      const memory_id = str(b.memory_id, 64, "memory_id")!;
      if (action !== "memory.verify") return bad("Only memory.verify is currently allowlisted", 403);
      const expires_at = expiry(b.expires_at);
      // The database assigns the proposer identity as ecc-agent and captures the immutable target snapshot.
      const approval = await rpc("ecc_approval_propose_v2", {
        p_action: action, p_memory_id: memory_id, p_expires_at: expires_at,
      });
      return response({ ok: true, approval }, 201);
    }
    if (req.method === "POST" && path.endsWith("/approval/review")) {
      const parsed = await readJson(req);
      if (parsed.error) return bad(parsed.error, parsed.error === "Request body too large" ? 413 : 400);
      const b = parsed.value!;
      const request_id = str(b.request_id, 64, "request_id")!;
      if (!["approved", "rejected"].includes(String(b.decision))) return bad("decision must be approved or rejected");
      const approval = await rpc("ecc_approval_review_v2", {
        p_request_id: request_id, p_decision: b.decision, p_reviewer_user_id: actor,
      });
      if (approval && typeof approval === "object" && (approval as Record<string, unknown>).status === "expired") return bad("Request has expired", 409);
      return response({ ok: true, approval });
    }
    if (req.method === "POST" && path.endsWith("/approval/execute")) {
      const parsed = await readJson(req);
      if (parsed.error) return bad(parsed.error, parsed.error === "Request body too large" ? 413 : 400);
      const request_id = str(parsed.value!.request_id, 64, "request_id")!;
      const execution = await rpc("ecc_approval_execute_v2", {
        p_request_id: request_id, p_executor_user_id: actor,
      });
      if (execution && typeof execution === "object" && (execution as Record<string, unknown>).status === "expired") return bad("Approval expired; execution blocked", 409);
      return response({ ok: true, execution });
    }
    return bad("Route not found", 404);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    const lower = message.toLowerCase();
    if (lower.includes("rate limit")) return bad("Cognition feedback rate limit exceeded", 429);
    if (/expired|not pending|not found|not allowlisted|self-approval|expiry|target revision changed|payload changed|payload hash mismatch|execution blocked|only the approving|enabled ecc owner/.test(lower)) return bad(message, 409);
    if (/invalid input syntax|uuid/.test(lower)) return bad("Invalid request identifier or field format", 400);
    return bad("Request could not be completed", 400);
  }
});
