import { sha256Hex } from "./crypto";
import type { Env } from "./types";

export const BACKUP_TABLES = [
  "owner_identity","owner_roles","memory_records","memory_versions","memory_evidence",
  "memory_evaluations","project_records","operational_tasks","operational_runs",
  "operational_gates","approval_requests","approval_events","external_probes",
  "backup_manifests","system_events","quota_observations"
] as const;

export async function createBackup(env: Env, now = new Date()): Promise<{
  objectKey: string; sha256: string; byteLength: number; counts: Record<string, number>;
}> {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    const result = await env.DB.prepare("SELECT * FROM " + table + " ORDER BY rowid").all();
    data[table] = result.results as unknown[];
    counts[table] = result.results.length;
  }
  const envelope = {
    format: "ecc-orbit-backup-v1",
    schemaVersion: "0002",
    createdAt: now.toISOString(),
    tables: data,
    counts
  };
  const body = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(body);
  if (bytes.byteLength > 2_000_000) throw new Error("backup_soft_size_limit_exceeded");
  const sha256 = await sha256Hex(bytes.buffer);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const objectKey = "ecc-orbit/v1/" + stamp + "-" + sha256.slice(0, 16) + ".json";
  await env.BACKUPS.put(objectKey, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256, schemaVersion: "0002" }
  });
  const stored = await env.BACKUPS.get(objectKey);
  if (!stored) throw new Error("backup_readback_missing");
  const readback = await stored.arrayBuffer();
  const verifiedHash = await sha256Hex(readback);
  if (verifiedHash !== sha256 || readback.byteLength !== bytes.byteLength)
    throw new Error("backup_readback_checksum_mismatch");
  await env.DB.prepare(
    "INSERT INTO backup_manifests (id,object_key,schema_version,sha256,byte_length,counts_json,created_at,verified_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), objectKey, "0002", sha256, bytes.byteLength,
    JSON.stringify(counts), now.toISOString(), new Date().toISOString()).run();
  return { objectKey, sha256, byteLength: bytes.byteLength, counts };
}
