import { canonicalJson, sha256Hex } from "./crypto";
import type { Env } from "./types";

export const BACKUP_TABLES = [
  "owner_identity","owner_roles","memory_records","memory_versions","memory_evidence",
  "memory_evaluations","project_records","operational_tasks","operational_runs",
  "operational_gates","approval_requests","approval_events","external_probes",
  "backup_manifests","system_events","quota_observations"
] as const;

export async function createBackup(env: Env, now = new Date()): Promise<{
  objectKey: string; sha256: string; byteLength: number;
  counts: Record<string, number>; tableHashes: Record<string, string>;
}> {
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const tableHashes: Record<string, string> = {};
  for (const table of BACKUP_TABLES) {
    const result = await env.DB.prepare("SELECT * FROM " + table + " ORDER BY rowid LIMIT 251").all();
    if (result.results.length > 250) throw new Error("backup_row_soft_limit_exceeded:" + table);
    data[table] = result.results as unknown[];
    counts[table] = result.results.length;
    tableHashes[table] = await sha256Hex(canonicalJson(data[table]));
  }
  const envelope = {
    format: "ecc-orbit-backup-v1", schemaVersion: "0005",
    createdAt: now.toISOString(), tables: data, counts, tableHashes
  };
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  if (bytes.byteLength > 512_000) throw new Error("backup_soft_size_limit_exceeded");
  const sha256 = await sha256Hex(bytes);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const objectKey = "ecc-orbit/v1/" + stamp + "-" + sha256.slice(0, 16) + ".json";
  await env.BACKUPS.put(objectKey, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256, schemaVersion: "0005" }
  });
  const stored = await env.BACKUPS.get(objectKey);
  if (!stored) throw new Error("backup_readback_missing");
  const readback = await stored.arrayBuffer();
  const verifiedHash = await sha256Hex(readback);
  if (verifiedHash !== sha256 || readback.byteLength !== bytes.byteLength)
    throw new Error("backup_readback_checksum_mismatch");
  await env.DB.prepare(
    "INSERT INTO backup_manifests (id,object_key,schema_version,sha256,byte_length,counts_json,created_at,verified_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), objectKey, "0005", sha256, bytes.byteLength,
    JSON.stringify({ counts, tableHashes }), now.toISOString(), new Date().toISOString()).run();
  return { objectKey, sha256, byteLength: bytes.byteLength, counts, tableHashes };
}

