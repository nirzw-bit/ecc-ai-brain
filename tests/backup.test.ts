import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_TABLES, createBackup } from "../src/backup";
import type { Env } from "../src/types";

function makeEnv(options: { rows?: Record<string, unknown[]>; corruptReadback?: boolean } = {}) {
  const stored = new Map<string, Uint8Array>();
  const put = vi.fn(async (key: string, body: Uint8Array) => { stored.set(key, new Uint8Array(body)); });
  const get = vi.fn(async (key: string) => {
    const value = stored.get(key);
    if (!value) return null;
    const copy = new Uint8Array(value);
    if (options.corruptReadback) copy[0] = copy[0] ^ 1;
    return { arrayBuffer: async () => copy.buffer };
  });
  const run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
  const prepare = vi.fn((sql: string) => ({
    all: async () => {
      const table = sql.match(/FROM ([a-z_]+)/i)?.[1] ?? "";
      return { results: options.rows?.[table] ?? [] };
    },
    bind: (..._values: unknown[]) => ({ run })
  }));
  const env = {
    DB: { prepare } as unknown as D1Database,
    BACKUPS: { put, get } as unknown as R2Bucket
  } as Env;
  return { env, put, get, run, stored };
}

describe("R2 backup helper (mocked bindings)", () => {
  it("exports all approved tables, reads the object back and records its manifest", async () => {
    const { env, put, get, run, stored } = makeEnv();
    const result = await createBackup(env, new Date("2026-11-19T00:00:00.000Z"));
    expect(Object.keys(result.counts)).toHaveLength(16);
    expect(Object.keys(result.tableHashes)).toHaveLength(16);
    expect(Object.keys(result.counts).sort()).toEqual([...BACKUP_TABLES].sort());
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.byteLength).toBeGreaterThan(0);
    expect(put).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(stored.has(result.objectKey)).toBe(true);
  });

  it("fails closed when R2 read-back checksum differs", async () => {
    const { env, put } = makeEnv({ corruptReadback: true });
    await expect(createBackup(env)).rejects.toThrow("backup_readback_checksum_mismatch");
    expect(put).toHaveBeenCalledOnce();
  });

  it("refuses a table exceeding the bounded export row limit", async () => {
    const rows = Array.from({ length: 251 }, (_, i) => ({ id: String(i) }));
    const { env, put } = makeEnv({ rows: { owner_identity: rows } });
    await expect(createBackup(env)).rejects.toThrow("backup_row_soft_limit_exceeded:owner_identity");
    expect(put).not.toHaveBeenCalled();
  });
});
