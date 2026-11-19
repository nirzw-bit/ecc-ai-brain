import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../src/crypto";
import { validateApproval } from "../src/approvals";

describe("canonical JSON and approval safety", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 1 } })).toBe('{"a":{"x":1,"y":2},"z":1}');
  });
  it("computes a SHA-256 digest", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("rejects missing approval", async () => {
    expect(await validateApproval(null, { actionType: "deploy", target: "dev", scope: "dev", payload: {} }, "owner")).toBe(false);
  });
  it("rejects self-approval", async () => {
    const payload = {};
    const hash = await sha256Hex(canonicalJson(payload));
    expect(await validateApproval({ actionType:"deploy", target:"dev", scope:"dev", payloadSha256:hash,
      requesterId:"owner", approverId:"owner", expiresAt:"2099-01-01T00:00:00Z", revoked:false, consumed:false },
      { actionType:"deploy", target:"dev", scope:"dev", payload }, "owner")).toBe(false);
  });
});
