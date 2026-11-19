import { canonicalJson, sha256Hex } from "./crypto";

export interface MemoryInput {
  id: string; memoryKey: string; content: string; provenance: unknown;
  status: "proposed" | "verified"; supersedesVersion?: number;
}
export async function buildMemoryVersion(input: MemoryInput, version: number, createdAt: string) {
  if (!Number.isInteger(version) || version < 1) throw new Error("invalid_version");
  const provenanceJson = canonicalJson(input.provenance);
  return {
    id: crypto.randomUUID(), memoryId: input.id, memoryKey: input.memoryKey, version,
    content: input.content, contentSha256: await sha256Hex(input.content),
    status: input.status, supersedesVersion: input.supersedesVersion ?? null,
    provenanceJson, createdAt
  };
}
