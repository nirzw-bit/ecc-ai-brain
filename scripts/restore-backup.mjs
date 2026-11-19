#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TABLES = [
  "owner_identity","owner_roles","memory_records","memory_versions","memory_evidence",
  "memory_evaluations","project_records","operational_tasks","operational_runs",
  "operational_gates","approval_requests","approval_events","external_probes",
  "backup_manifests","system_events","quota_observations"
];
const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, i, list) => {
  if (value.startsWith("--")) all.push([value.slice(2), list[i + 1]]);
  return all;
}, []));
const key = args.key;
const suppliedSha = args.sha256?.toLowerCase();
const bucket = "ecc-orbit-backups-dev";
const database = "ecc-orbit-restore-test";
const sourceDatabase = "ecc-orbit-dev";
if (!/^ecc-orbit\\/v1\\/[a-zA-Z0-9._-]+\\.json$/.test(key ?? "") ||
    (suppliedSha !== undefined && !/^[a-f0-9]{64}$/.test(suppliedSha))) {
  console.error("Usage: node scripts/restore-backup.mjs --key ecc-orbit/v1/<file>.json [--sha256 <optional-64-hex-check>]");
  process.exit(2);
}
const run = (argv) => execFileSync("npx", ["wrangler", ...argv], {
  encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 32 * 1024 * 1024
});
const parseJsonOutput = (output) => {
  const trimmed = output.trim();
  const value = JSON.parse(trimmed);
  return Array.isArray(value) ? value : [value];
};
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sqlValue = (value) => {
  if (value === null) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return "CAST(X'" + Buffer.from(value, "utf8").toString("hex") + "' AS TEXT)";
  throw new Error("unsupported SQLite value in backup");
};
const temp = mkdtempSync(join(tmpdir(), "ecc-orbit-restore-"));
try {
  const backupPath = join(temp, "backup.json");
  const sqlPath = join(temp, "restore.sql");
  const manifestOutput = parseJsonOutput(run(["d1","execute",sourceDatabase,"--remote","--json","--command",
    "SELECT sha256 FROM backup_manifests WHERE object_key=" + "'" + key.replace(/'/g, "''") + "' LIMIT 1"]));
  const manifestRows = manifestOutput.flatMap(x => x.results ?? []);
  if (manifestRows.length !== 1 || !/^[a-f0-9]{64}$/i.test(String(manifestRows[0].sha256)))
    throw new Error("source D1 backup manifest missing or invalid");
  const manifestSha = String(manifestRows[0].sha256).toLowerCase();
  if (suppliedSha && suppliedSha !== manifestSha)
    throw new Error("optional supplied SHA-256 does not match source D1 manifest");
  run(["r2", "object", "get", bucket + "/" + key, "--file", backupPath, "--remote"]);
  const raw = readFileSync(backupPath);
  const actualSha = hash(raw);
  if (actualSha !== manifestSha) throw new Error("archive SHA-256 does not match source manifest");
  const archive = JSON.parse(raw.toString("utf8"));
  if (archive.format !== "ecc-orbit-backup-v1" || archive.schemaVersion !== "0005")
    throw new Error("unsupported backup format/schema version");
  for (const table of TABLES) {
    const rows = archive.tables?.[table];
    if (!Array.isArray(rows) || rows.length !== archive.counts?.[table])
      throw new Error("record count mismatch in archive: " + table);
    if (hash(canonical(rows)) !== archive.tableHashes?.[table])
      throw new Error("table checksum mismatch in archive: " + table);
  }

  const countSql = TABLES.map(t => "SELECT '" + t + "' AS table_name, COUNT(*) AS n FROM " + t).join(" UNION ALL ");
  const countResults = parseJsonOutput(run(["d1","execute",database,"--remote","--json","--command",countSql]));
  const countRows = countResults.flatMap(x => x.results ?? []);
  if (countRows.some(row => Number(row.n) !== 0))
    throw new Error("restore target is not empty; refusing to overwrite existing test data");

  const statements = [];
  for (const table of TABLES) {
    let rows = archive.tables[table];
    if (table === "memory_versions") rows = [...rows].sort((a,b) => a.version - b.version);
    for (const sourceRow of rows) {
      const row = { ...sourceRow };
      // Version triggers advance this pointer as each immutable version is inserted.
      if (table === "memory_records") row.current_version = 0;
      const columns = Object.keys(row);
      if (!columns.length || columns.some(c => !/^[a-z_][a-z0-9_]*$/i.test(c)))
        throw new Error("invalid column name in " + table);
      const values = columns.map(c => sqlValue(row[c]));
      statements.push("INSERT INTO " + table + " (" + columns.join(",") + ") VALUES (" + values.join(",") + ");");
    }
  }
  writeFileSync(sqlPath, statements.join("\n"), { encoding: "utf8", mode: 0o600 });
  run(["d1","execute",database,"--remote","--yes","--file",sqlPath]);

  for (const table of TABLES) {
    const result = parseJsonOutput(run(["d1","execute",database,"--remote","--json","--command",
      "SELECT * FROM " + table + " ORDER BY rowid"]));
    const rows = result.flatMap(x => x.results ?? []);
    if (rows.length !== archive.counts[table] || hash(canonical(rows)) !== archive.tableHashes[table])
      throw new Error("restored count/hash mismatch: " + table);
  }
  console.log(JSON.stringify({
    ok: true, objectKey: key, sha256: actualSha, schemaVersion: archive.schemaVersion,
    restoredTables: TABLES.length, recordCounts: archive.counts,
    verification: "all table counts and canonical SHA-256 hashes matched"
  }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
