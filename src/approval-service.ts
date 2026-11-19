import { canonicalJson, sha256Hex } from "./crypto";

export interface ApprovalAction {
  actionType: string; target: string; scope: string; payload: unknown;
}
export async function requestApproval(db: D1Database, requesterId: string, action: ApprovalAction,
  expiresAt: string, now = new Date()) {
  if (!await activeRole(db, requesterId, "owner")) throw new Error("active_owner_role_required");
  if (Date.parse(expiresAt) <= now.getTime()) throw new Error("approval_expiry_must_be_future");
  const id = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const payloadSha256 = await sha256Hex(canonicalJson(action.payload));
  await db.prepare(
    "INSERT INTO approval_requests (id,action_type,target,scope,payload_sha256,requester_id,expires_at,nonce,status,created_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, action.actionType, action.target, action.scope, payloadSha256,
    requesterId, expiresAt, nonce, "pending", now.toISOString()).run();
  await db.prepare(
    "INSERT INTO approval_events (id,approval_id,event_type,actor_id,event_json,created_at) VALUES (?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), id, "requested", requesterId,
    JSON.stringify({ actionType: action.actionType, target: action.target, scope: action.scope, payloadSha256 }),
    now.toISOString()).run();
  return { id, nonce, payloadSha256, status: "pending" as const };
}

async function activeRole(db: D1Database, actorId: string, role: "owner" | "reviewer"): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 AS ok FROM owner_roles r JOIN owner_identity i ON i.id=r.owner_id " +
    "WHERE i.issuer='https://github.com' AND i.subject=? AND r.role=? AND r.revoked_at IS NULL LIMIT 1"
  ).bind(actorId, role).first<{ ok: number }>();
  return !!row;
}

export async function approveRequest(db: D1Database, approvalId: string, reviewerId: string, now = new Date()) {
  if (!await activeRole(db, reviewerId, "reviewer")) throw new Error("active_reviewer_role_required");
  const request = await db.prepare(
    "SELECT requester_id,status,expires_at FROM approval_requests WHERE id=?"
  ).bind(approvalId).first<{ requester_id: string; status: string; expires_at: string }>();
  if (!request || request.status !== "pending") throw new Error("approval_not_pending");
  if (request.requester_id === reviewerId) throw new Error("self_approval_forbidden");
  if (Date.parse(request.expires_at) <= now.getTime()) throw new Error("approval_expired");
  const results = await db.batch([
    db.prepare("UPDATE approval_requests SET status='approved',approver_id=? WHERE id=? AND status='pending' AND requester_id!=? AND expires_at>? " +
      "AND EXISTS (SELECT 1 FROM owner_roles r JOIN owner_identity i ON i.id=r.owner_id WHERE i.issuer='https://github.com' AND i.subject=? AND r.role='reviewer' AND r.revoked_at IS NULL)")
      .bind(reviewerId, approvalId, reviewerId, now.toISOString(), reviewerId),
    db.prepare("INSERT INTO approval_events (id,approval_id,event_type,actor_id,event_json,created_at) " +
      "SELECT ?,id,'approved',?,?,? FROM approval_requests WHERE id=? AND status='approved' AND approver_id=?")
      .bind(crypto.randomUUID(), reviewerId, JSON.stringify({}), now.toISOString(), approvalId, reviewerId)
  ]);
  if (!results[0]?.meta?.changes || !results[1]?.meta?.changes) throw new Error("approval_race_or_rejection");
  return { ok: true, approvalId, status: "approved" as const };
}

export async function consumeApproval(db: D1Database, approvalId: string, actorId: string,
  action: ApprovalAction, now = new Date()) {
  if (!await activeRole(db, actorId, "reviewer")) throw new Error("active_reviewer_role_required");
  const row = await db.prepare("SELECT * FROM approval_requests WHERE id=?")
    .bind(approvalId).first<{
      action_type: string; target: string; scope: string; payload_sha256: string;
      requester_id: string; approver_id: string | null; expires_at: string; status: string;
    }>();
  if (!row || row.status !== "approved" || row.approver_id !== actorId) throw new Error("approval_not_executable");
  if (row.requester_id === actorId) throw new Error("self_approval_forbidden");
  if (Date.parse(row.expires_at) <= now.getTime()) throw new Error("approval_expired");
  if (row.action_type !== action.actionType || row.target !== action.target || row.scope !== action.scope)
    throw new Error("approval_action_binding_mismatch");
  if (row.payload_sha256 !== await sha256Hex(canonicalJson(action.payload)))
    throw new Error("approval_payload_hash_mismatch");
  const results = await db.batch([
    db.prepare("UPDATE approval_requests SET status='consumed' WHERE id=? AND status='approved' AND approver_id=? AND expires_at>? " +
      "AND EXISTS (SELECT 1 FROM owner_roles r JOIN owner_identity i ON i.id=r.owner_id WHERE i.issuer='https://github.com' AND i.subject=? AND r.role='reviewer' AND r.revoked_at IS NULL)")
      .bind(approvalId, actorId, now.toISOString(), actorId),
    db.prepare("INSERT INTO approval_events (id,approval_id,event_type,actor_id,event_json,created_at) " +
      "SELECT ?,id,'consumed',?,?,? FROM approval_requests WHERE id=? AND status='consumed' AND approver_id=?")
      .bind(crypto.randomUUID(), actorId, JSON.stringify({ actionType: action.actionType, target: action.target, scope: action.scope }),
        now.toISOString(), approvalId, actorId)
  ]);
  if (!results[0]?.meta?.changes || !results[1]?.meta?.changes) throw new Error("approval_replay_or_race");
  return { ok: true, approvalId, status: "consumed" as const };
}
