import { canonicalJson, sha256Hex } from "./crypto";
export interface Approval {
  actionType: string; target: string; scope: string; payloadSha256: string;
  requesterId: string; approverId: string | null; expiresAt: string;
  revoked: boolean; consumed: boolean;
}
export async function validateApproval(a: Approval | null, action: {
  actionType: string; target: string; scope: string; payload: unknown;
}, actorId: string, now = Date.now()): Promise<boolean> {
  if (!a || a.revoked || a.consumed || !a.approverId) return false;
  if (a.requesterId === a.approverId || actorId !== a.approverId) return false;
  if (Date.parse(a.expiresAt) <= now) return false;
  if (a.actionType !== action.actionType || a.target !== action.target || a.scope !== action.scope) return false;
  return a.payloadSha256 === await sha256Hex(canonicalJson(action.payload));
}
