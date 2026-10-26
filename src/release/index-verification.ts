/** Opaque, process-local evidence. Serialized claims cannot enter this registry. */
import type { ReleaseIndexTufState, ReleaseIndexVerification } from "./contracts.js";

export interface IndexVerificationRecord {
  readonly sourceId: string;
  readonly rootSha256: string;
  readonly indexSha256: string;
  readonly verifiedAt: string;
  readonly expires: number;
  readonly revoked: boolean;
  readonly tufState: ReleaseIndexTufState;
}
const records = new WeakMap<object, IndexVerificationRecord>();
export function issueIndexVerification(record: IndexVerificationRecord): ReleaseIndexVerification {
  const proof = Object.freeze({}) as ReleaseIndexVerification;
  records.set(proof, Object.freeze(record));
  return proof;
}
export function indexVerification(proof: unknown): IndexVerificationRecord | undefined {
  return proof !== null && typeof proof === "object" ? records.get(proof) : undefined;
}
