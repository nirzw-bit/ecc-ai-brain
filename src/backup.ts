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
    const result = await env.DB.prepare("SELECT * FROM " + table + " ORDER BY rowid LIMIT 1001").all();
    if (result.results.length > 1000) throw new Error("backup_row_soft_limit_exceeded:" + table);
    data[table] = result.results as unknown[];
    counts[table] = result.results.length;
    tableHashes[table] = await sha256Hex(canonicalJson(data[table]));
  }
  const envelope = {
    format: "ecc-orbit-backup-v1", schemaVersion: "0003",
    createdAt: now.toISOString(), tables: data, counts, tableHashes
  };
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  if (bytes.byteLength > 2_000_000) throw new Error("backup_soft_size_limit_exceeded");
  const sha256 = await sha256Hex(bytes);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const objectKey = "ecc-orbit/v1/" + stamp + "-" + sha256.slice(0, 16) + ".json";
  await env.BACKUPS.put(objectKey, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256, schemaVersion: "0003" }
  });
  const stored = await env.BACKUPS.get(objectKey);
  if (!stored) throw new Error("backup_readback_missing");
  const readback = await stored.arrayBuffer();
  const verifiedHash = await sha256Hex(readback);
  if (verifiedHash !== sha256 || readback.byteLength !== bytes.byteLength)
    throw new Error("backup_readback_checksum_mismatch");
  await env.DB.prepare(
    "INSERT INTO backup_manifests (id,object_key,schema_version,sha256,byte_length,counts_json,created_at,verified_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), objectKey, "0003", sha256, bytes.byteLength,
    JSON.stringify({ counts, tableHashes }), now.toISOString(), new Date().toISOString()).run();
  return { objectKey, sha256, byteLength: bytes.byteLength, counts, tableHashes };
}

export async function restoreBackupToTestDatabase(env: Env, objectKey: string, expectedSha256: string) {
  const target = env.RESTORE_TEST_DB;
  if (!target) throw new Error("restore_test_database_not_configured");
  if (!objectKey.startsWith("ecc-orbit/v1/")) throw new Error("invalid_backup_object_key");
  const manifest = await env.DB.prepare(
    "SELECT sha256 FROM backup_manifests WHERE object_key=?"
  ).bind(objectKey).first<{ sha256: string }>();
  if (!manifest || manifest.sha256 !== expectedSha256) throw new Error("backup_manifest_mismatch");
  const object = await env.BACKUPS.get(objectKey);
  if (!object) throw new Error("backup_object_missing");
  const bytes = await object.arrayBuffer();
  if (await sha256Hex(bytes) !== expectedSha256) throw new Error("backup_checksum_mismatch");
  const envelope = JSON.parse(new TextDecoder().decode(bytes)) as {
    format: string; schemaVersion: string; tables: Record<string, Record<string, unknown>[]>;
    counts: Record<string, number>; tableHashes: Record<string, string>;
  };
  if (envelope.format !== "ecc-orbit-backup-v1" || envelope.schemaVersion !== "0003")
    throw new Error("backup_schema_version_unsupported");
  for (const table of BACKUP_TABLES) {
    const rows = envelope.tables[table];
    if (!Array.isArray(rows) || rows.length !== envelope.counts[table])
      throw new Error("backup_record_count_mismatch:" + table);
    if (await sha256Hex(canonicalJson(rows)) !== envelope.tableHashes[table])
      throw new Error("backup_table_checksum_mismatch:" + table);
    const existing = await target.prepare("SELECT COUNT(*) AS n FROM " + table).first<{ n: number }>();
    if ((existing?.n ?? 0) !== 0) throw new Error("restore_target_not_empty:" + table);
  }
  let batch: D1PreparedStatement[] = [];
  for (const table of BACKUP_TABLES) {
    for (const row of envelope.tables[table]) {
      const columns = Object.keys(row);
      if (!columns.length) continue;
      const sql = "INSERT INTO " + table + " (" + columns.join(",") + ") VALUES (" +
        columns.map(() => "?").join(",") + ")";
      const values = columns.map(column => row[column] as string | number | null);
      batch.push(target.prepare(sql).bind(...values));
      if (batch.length === 25) {
        await target.batch(batch);
        batch = [];
      }
    }
  }
  if (batch.length) await target.batch(batch);
  const restored: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    const rows = await target.prepare("SELECT * FROM " + table + " ORDER BY rowid").all();
    restored[table] = rows.results.length;
    if (restored[table] !== envelope.counts[table] ||
        await sha256Hex(canonicalJson(rows.results)) !== envelope.tableHashes[table])
      throw new Error("restore_verification_failed:" + table);
  }
  return { ok: true, objectKey, sha256: expectedSha256, restored };
}
