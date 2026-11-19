import type { Env } from "./types";
import { createBackup } from "./backup";

const MAX_TASKS_PER_TICK = 1;
const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 3;

export async function dispatchDueTasks(env: Env, now = new Date()): Promise<number> {
  let processed = 0;
  for (let i = 0; i < MAX_TASKS_PER_TICK; i++) {
    const due = await env.DB.prepare(
      "SELECT id, task_key, task_type, due_at, attempts, max_attempts FROM operational_tasks " +
      "WHERE status='pending' AND due_at<=? AND attempts<max_attempts ORDER BY due_at LIMIT 1"
    ).bind(now.toISOString()).first<{
      id: string; task_key: string; task_type: string; due_at: string;
      attempts: number; max_attempts: number;
    }>();
    if (!due) break;
    const leaseOwner = crypto.randomUUID();
    const leaseUntil = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString();
    const idempotencyKey = due.task_key + ":" + due.due_at;
    const claim = env.DB.prepare(
      "UPDATE operational_tasks SET status='leased', lease_owner=?, lease_until=?, attempts=attempts+1 " +
      "WHERE id=? AND status='pending' AND due_at<=? AND attempts<max_attempts"
    ).bind(leaseOwner, leaseUntil, due.id, now.toISOString());
    const run = env.DB.prepare(
      "INSERT OR IGNORE INTO operational_runs (id,task_id,idempotency_key,status,attempt,started_at) " +
      "SELECT ?,id,?,'running',attempts+1,? FROM operational_tasks " +
      "WHERE id=? AND status='leased' AND lease_owner=?"
    ).bind(crypto.randomUUID(), idempotencyKey, now.toISOString(), due.id, leaseOwner);
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
          JSON.stringify({ taskKey: due.task_key }), now.toISOString()).run();
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
      const attempts = due.attempts + 1;
      const failed = attempts >= Math.min(due.max_attempts, MAX_ATTEMPTS);
      await env.DB.batch([
        env.DB.prepare("UPDATE operational_runs SET status=?,finished_at=?,result_json=? WHERE idempotency_key=? AND status='running'")
          .bind(failed ? "failed" : "retryable_failure", new Date().toISOString(),
            JSON.stringify({ error: error instanceof Error ? error.message : "unknown" }), idempotencyKey),
        env.DB.prepare("UPDATE operational_tasks SET status=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?")
          .bind(failed ? "failed" : "pending", due.id, leaseOwner)
      ]);
    }
  }
  return processed;
}
