import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../src/crypto";
import { validateApproval, type Approval } from "../src/approvals";
import { buildMemoryVersion } from "../src/memory";

describe("canonical JSON and approval safety", () => {
  it("builds immutable version records with deterministic provenance and content hashes", async () => {
    const v = await buildMemoryVersion("memory-1", {
      memoryKey: "ecc.preference", content: "Evidence-backed",
      provenance: { source: "chat", confidence: 0.9 }, status: "proposed"
    }, 2, "2026-11-19T00:00:00.000Z");
    expect(v.version).toBe(2);
    expect(v.supersedesVersion).toBe(1);
    expect(v.contentSha256).toBe(await sha256Hex("Evidence-backed"));
    expect(v.provenanceJson).toBe('{"confidence":0.9,"source":"chat"}');
  });
  it("rejects invalid memory version numbers", async () => {
    await expect(buildMemoryVersion("m1", {
      memoryKey: "k", content: "x", provenance: {}, status: "proposed"
    }, 0, "2026-11-19T00:00:00.000Z")).rejects.toThrow("invalid_version");
  });
  it("sorts object keys deterministically", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 1 } })).toBe('{"a":{"x":1,"y":2},"z":1}');
  });
  it("computes a SHA-256 digest", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  const action = { actionType: "deploy", target: "dev", scope: "dev", payload: { b: 2, a: 1 } };
  async function approved(overrides: Partial<Approval> = {}): Promise<Approval> {
    return { actionType: action.actionType, target: action.target, scope: action.scope,
      payloadSha256: await sha256Hex(canonicalJson(action.payload)), requesterId: "requester",
      approverId: "reviewer", expiresAt: "2099-01-01T00:00:00Z", status: "approved",
      nonce: "unique-nonce", revoked: false, consumed: false, ...overrides };
  }
  it("accepts a valid distinct owner approval", async () => {
    expect(await validateApproval(await approved(), action, "reviewer")).toBe(true);
  });
  it("rejects missing, pending, rejected, revoked, consumed and expired approvals", async () => {
    expect(await validateApproval(null, action, "reviewer")).toBe(false);
    expect(await validateApproval(await approved({status:"pending"}), action, "reviewer")).toBe(false);
    expect(await validateApproval(await approved({status:"rejected"}), action, "reviewer")).toBe(false);
    expect(await validateApproval(await approved({revoked:true}), action, "reviewer")).toBe(false);
    expect(await validateApproval(await approved({consumed:true}), action, "reviewer")).toBe(false);
    expect(await validateApproval(await approved({expiresAt:"2000-01-01T00:00:00Z"}), action, "reviewer")).toBe(false);
  });
  it("rejects self approval and wrong actor", async () => {
    expect(await validateApproval(await approved({requesterId:"reviewer"}), action, "reviewer")).toBe(false);
    expect(await validateApproval(await approved(), action, "requester")).toBe(false);
  });
  it("rejects action, target, scope and payload mismatch", async () => {
    const a = await approved();
    expect(await validateApproval(a, {...action, target:"prod"}, "reviewer")).toBe(false);
    expect(await validateApproval(a, {...action, scope:"prod"}, "reviewer")).toBe(false);
    expect(await validateApproval(a, {...action, actionType:"delete"}, "reviewer")).toBe(false);
    expect(await validateApproval(a, {...action, payload:{a:9}}, "reviewer")).toBe(false);
  });
});
