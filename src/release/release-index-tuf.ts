/** Node cryptographic seam over host-acquired bytes. No acquisition or trust discovery. */
import { Metadata, MetadataKind, type Root } from "@tufjs/models";
import type {
  ReleaseIndexTrust,
  ReleaseIndexTufState,
  ReleaseIndexVerification,
} from "./contracts.js";
import { issueIndexVerification } from "./index-verification.js";
import { sha256Hex } from "./sha256.js";
import { readUpstreamObject } from "./upstream-json.js";

export interface VerifyReleaseIndexTufRequest {
  readonly sourceId: string;
  readonly trust: ReleaseIndexTrust;
  readonly indexBytes: Uint8Array;
  readonly targetPath: string;
  readonly evaluatedAt: string;
  /** Top-level TUF profile; host supplies every consecutive root rotation. */
  readonly metadata: {
    readonly roots: readonly Uint8Array[];
    readonly timestamp: Uint8Array;
    readonly snapshot: Uint8Array;
    readonly targets: Uint8Array;
  };
}
export type VerifyReleaseIndexTufResult =
  | { readonly valid: true; readonly verification: ReleaseIndexVerification }
  | { readonly valid: false; readonly reason: "tuf-invalid" | "expired" };

/**
 * Verify TUF thresholds, dual-signed consecutive roots, expiry, metadata links
 * and the exact target digest. Does not evaluate Scan, discover authorities,
 * fetch, persist, or accept a verification boolean. Metadata uses bounded strict JSON; TUF canonicalizes the signed payload.
 */
export function verifyReleaseIndexTuf(
  request: VerifyReleaseIndexTufRequest,
): VerifyReleaseIndexTufResult {
  let expired = false;
  try {
    const at = Date.parse(request.evaluatedAt);
    if (
      !Number.isFinite(at) ||
      request.trust === "none" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(request.sourceId) ||
      !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/.test(request.targetPath) ||
      !(request.indexBytes instanceof Uint8Array) ||
      request.indexBytes.length > 16 * 1024 * 1024 ||
      !Array.isArray(request.metadata.roots) ||
      request.metadata.roots.length > 32
    )
      throw Error();
    const decode = (bytes: Uint8Array) =>
      readUpstreamObject(bytes) as ReturnType<Metadata<Root>["toJSON"]>;
    let rootBytes = request.trust.tufRoot;
    let root = Metadata.fromJSON(MetadataKind.Root, decode(rootBytes));
    root.verifyDelegate("root", root);
    for (const bytes of request.metadata.roots) {
      const next = Metadata.fromJSON(MetadataKind.Root, decode(bytes));
      if (next.signed.version !== root.signed.version + 1) throw Error();
      root.verifyDelegate("root", next);
      next.verifyDelegate("root", next);
      root = next;
      rootBytes = bytes;
    }
    const { timestamp: tsBytes, snapshot: snBytes, targets: tgBytes } = request.metadata;
    const timestamp = Metadata.fromJSON(MetadataKind.Timestamp, decode(tsBytes));
    root.verifyDelegate("timestamp", timestamp);
    const snapshot = Metadata.fromJSON(MetadataKind.Snapshot, decode(snBytes));
    timestamp.signed.snapshotMeta.verify(Buffer.from(snBytes));
    if (snapshot.signed.version !== timestamp.signed.snapshotMeta.version) throw Error();
    root.verifyDelegate("snapshot", snapshot);
    const targets = Metadata.fromJSON(MetadataKind.Targets, decode(tgBytes));
    const targetsMeta = snapshot.signed.meta["targets.json"];
    if (!targetsMeta || targetsMeta.version !== targets.signed.version) throw Error();
    targetsMeta.verify(Buffer.from(tgBytes));
    root.verifyDelegate("targets", targets);
    // The profile deliberately does not traverse delegated targets.
    const all = { root, timestamp, snapshot, targets };
    for (const md of Object.values(all)) {
      const expires = Date.parse(md.signed.expires);
      if (
        !Number.isFinite(expires) ||
        !Number.isSafeInteger(md.signed.version) ||
        md.signed.version < 1
      )
        throw Error();
      if (expires <= at) expired = true;
    }
    if (expired) throw Error();
    const target = targets.signed.targets[request.targetPath];
    if (
      !target ||
      target.length !== request.indexBytes.length ||
      target.hashes.sha256 !== sha256Hex(request.indexBytes)
    )
      throw Error();
    const rootSha256 = sha256Hex(request.trust.tufRoot);
    const revocations = targets.signed.unrecognizedFields.catalogRootRevocations;
    if (revocations !== undefined && (!Array.isArray(revocations) || revocations.length > 128))
      throw Error();
    const revoked =
      Array.isArray(revocations) &&
      revocations.some(
        (r) =>
          r !== null &&
          typeof r === "object" &&
          !Array.isArray(r) &&
          r.sourceId === request.sourceId &&
          r.rootSha256 === rootSha256,
      );
    const bytes = { root: rootBytes, timestamp: tsBytes, snapshot: snBytes, targets: tgBytes };
    const tufState = Object.fromEntries(
      Object.entries(all).map(([role, md]) => [
        role,
        Object.freeze({
          version: md.signed.version,
          sha256: sha256Hex(bytes[role as keyof typeof bytes]),
        }),
      ]),
    ) as ReleaseIndexTufState;
    return Object.freeze({
      valid: true,
      verification: issueIndexVerification({
        sourceId: request.sourceId,
        rootSha256,
        indexSha256: sha256Hex(request.indexBytes),
        verifiedAt: request.evaluatedAt,
        expires: Math.min(...Object.values(all).map((md) => Date.parse(md.signed.expires))),
        revoked,
        tufState: Object.freeze(tufState),
      }),
    });
  } catch {
    return Object.freeze({ valid: false, reason: expired ? "expired" : "tuf-invalid" });
  }
}
