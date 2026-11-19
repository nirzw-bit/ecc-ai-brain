import { canonicalJson, sha256Hex } from "./crypto";

export interface MemoryEvidenceInput {
  evidenceType: string;
  sourceRef: string;
  excerptSha256?: string;
}
export interface MemoryInput {
  memoryKey: string;
  content: string;
  provenance: unknown;
  status?: "proposed";
  evidence?: MemoryEvidenceInput[];
}
export async function buildMemoryVersion(memoryId: string, input: MemoryInput, version: number, createdAt: string) {
  if (!Number.isInteger(version) || version < 1) throw new Error("invalid_version");
  const provenanceJson = canonicalJson(input.provenance);
  return {
    id: crypto.randomUUID(), memoryId, memoryKey: input.memoryKey, version,
    content: input.content, contentSha256: await sha256Hex(input.content),
    status: "proposed", supersedesVersion: version > 1 ? version - 1 : null,
    provenanceJson, createdAt
  };
}

/**
 * Appends a new immutable version. D1 triggers advance the current-version pointer
 * only after the new version insert succeeds. A concurrent writer loses on the
 * (memory_id, version) unique constraint and must re-read/retry.
 */
export async function appendMemoryVersion(db: D1Database, input: MemoryInput, now = new Date()) {
  if (!input.memoryKey.trim() || input.memoryKey.length > 120) throw new Error("memory_key_invalid");
  if (!input.content || input.content.length > 32000) throw new Error("memory_content_invalid");
  if ((input.evidence?.length ?? 0) > 20) throw new Error("too_many_evidence_items");
  const createdAt = now.toISOString();
  let record = await db.prepare(
    "SELECT id,current_version FROM memory_records WHERE memory_key=?"
  ).bind(input.memoryKey).first<{ id: string; current_version: number }>();
  if (!record) {
    await db.prepare(
      "INSERT OR IGNORE INTO memory_records (id,memory_key,created_at,current_version) VALUES (?,?,?,0)"
    ).bind(crypto.randomUUID(), input.memoryKey, createdAt).run();
    record = await db.prepare(
      "SELECT id,current_version FROM memory_records WHERE memory_key=?"
    ).bind(input.memoryKey).first<{ id: string; current_version: number }>();
  }
  if (!record) throw new Error("memory_record_initialization_failed");
  const nextVersion = record.current_version + 1;
  const version = await buildMemoryVersion(record.id, input, nextVersion, createdAt);
  const statements: D1PreparedStatement[] = [
    db.prepare(
      "INSERT INTO memory_versions (id,memory_id,version,content,content_sha256,status,supersedes_version,provenance_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(version.id, version.memoryId, version.version, version.content, version.contentSha256,
      version.status, version.supersedesVersion, version.provenanceJson, version.createdAt)
  ];
  for (const evidence of input.evidence ?? []) {
    statements.push(db.prepare(
      "INSERT INTO memory_evidence (id,memory_version_id,evidence_type,source_ref,excerpt_sha256,captured_at) VALUES (?,?,?,?,?,?)"
    ).bind(crypto.randomUUID(), version.id, evidence.evidenceType, evidence.sourceRef,
      evidence.excerptSha256 ?? null, createdAt));
  }
  await db.batch(statements);
  return version;
}
