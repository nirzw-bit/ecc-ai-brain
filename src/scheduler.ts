import type { Env } from "./types";
import { createBackup } from "./backup";

const MAX_TASKS_PER_TICK = 1;
const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 3;

export async function dispatchDueTasks(env: Env, now = new Date()): Promise<number> {
  let processed = 0;
  for (let i = 0; i < MAX_TASKS_PER_TICK; i++) {
    const nowIso = now.toISOString();
    const due = await env.DB.prepare(
      "SELECT id, task_key, task_type, due_at, attempts, max_attempts FROM operational_tasks " +
      "WHERE ((status='pending' AND due_at<=?) OR (status='leased' AND lease_until<=?)) " +
      "AND attempts<max_attempts ORDER BY due_at LIMIT 1"
    ).bind(nowIso, nowIso).first<{
      id: string; task_key: string; task_type: string; due_at: string;
      attempts: number; max_attempts: number;
    }>();
    if (!due) break;
    const leaseOwner = crypto.randomUUID();
    const leaseUntil = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString();
    const attempt = due.attempts + 1;
    const idempotencyKey = due.task_key + ":" + due.due_at + ":" + attempt;
    const claim = env.DB.prepare(
      "UPDATE operational_tasks SET status='leased', lease_owner=?, lease_until=?, attempts=attempts+1 " +
      "WHERE id=? AND attempts=? AND attempts<max_attempts AND " +
      "((status='pending' AND due_at<=?) OR (status='leased' AND lease_until<=?))"
    ).bind(leaseOwner, leaseUntil, due.id, due.attempts, nowIso, nowIso);
    const run = env.DB.prepare(
      "INSERT OR IGNORE INTO operational_runs (id,task_id,idempotency_key,status,attempt,started_at) " +
      "SELECT ?,id,?,'running',?,? FROM operational_tasks " +
      "WHERE id=? AND status='leased' AND lease_owner=?"
    ).bind(crypto.randomUUID(), idempotencyKey, attempt, nowIso, due.id, leaseOwner);
    const results = await env.DB.batch([claim, run]);
    if (!results[0]?.meta?.changes || !results[1]?.meta?.changes) continue;
    processed++;
    try {
      if (due.task_type === "backup") {
        await createBackup(env, now);
      } else if (due.task_type === "heartbeat") {
        await env.DB.prepare(
          "INSERT INTO system_events (id,event_type,severity,detail_json,created_at) VALUES (?,?,?,?,?)"
        ).bind(crypto.randomUUID(), "scheduled_heartbeat", "info",
          JSON.stringify({ taskKey: due.task_key }), nowIso).run();
      } else {
        throw new Error("unsupported_task_type");
      }
      await env.DB.batch([
        env.DB.prepare("UPDATE operational_runs SET status='succeeded',finished_at=? WHERE idempotency_key=? AND status='running'")
          .bind(new Date().toISOString(), idempotencyKey),
        env.DB.prepare("UPDATE operational_tasks SET status='succeeded',lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?")
          .bind(due.id, leaseOwner)
      ]);
    } catch (error) {
      const failed = attempt >= Math.min(due.max_attempts, MAX_ATTEMPTS);
      const retryAt = new Date(now.getTime() + Math.min(3600, 30 * (2 ** (attempt - 1))) * 1000).toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE operational_runs SET status=?,finished_at=?,result_json=? WHERE idempotency_key=? AND status='running'")
          .bind(failed ? "failed" : "retryable_failure", new Date().toISOString(),
            JSON.stringify({ error: error instanceof Error ? error.message : "unknown" }), idempotencyKey),
        env.DB.prepare("UPDATE operational_tasks SET status=?,due_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?")
          .bind(failed ? "failed" : "pending", retryAt, due.id, leaseOwner)
      ]);
    }
  }
  return processed;
}
