/** Release preparation with host-supplied public Scan/Core operations, never provider engines. */
import type {
  ContentDescriptor,
  ContentInventoryResult,
  ScanBaseline,
} from "./baseline-contracts.js";
import { SCAN_BASELINE_SCHEMA_ID } from "./baseline-contracts.js";
import { validBaseline } from "./baseline-wire.js";
import { copyJson } from "./boundary.js";
import type { CatalogDiagnostic, CatalogRelease } from "./contracts.js";
import { isRecord } from "./document.js";
import { createContentInventory } from "./inventory.js";
import { canonicalJson, deepFreeze } from "./json.js";
import { readRelease } from "./reader.js";
import { sha256Hex } from "./sha256.js";

/** Structural subset of the public Scan read contract; the real reader checks the full report. */
export type BaselineArtifactRead =
  | {
      readonly status: "read";
      readonly scanId: string;
      readonly report: {
        readonly selection: {
          readonly paths: readonly string[];
          readonly excludedPaths: readonly string[];
        };
      };
    }
  | { readonly status: "invalid" | "unsupported-report" };
export type BaselineCoverage =
  | {
      readonly status: "matched";
      readonly observations: readonly { readonly observationId: string }[];
      readonly detectorsWithoutCoverage: readonly string[];
    }
  | { readonly status: "mismatched" | "unavailable" | "invalid" };
export interface BaselineAuthentication {
  readonly status: "authenticated" | "unverifiable" | "skipped";
  readonly scanId?: string;
  readonly producerIdentity?: string;
  readonly keyId?: string;
  readonly reason?: string;
}
export interface BaselineServices<Read extends BaselineArtifactRead, Trust> {
  /** Explicit bounded acquisition. Supplied below: acquireBaselineArtifact for package/HTTPS. */
  readonly acquireArtifact: (artifact: ScanBaseline["artifact"]) => Promise<Uint8Array>;
  readonly readArtifact: (bytes: Uint8Array) => Promise<Read>;
  readonly readContentCoverage: (input: {
    read: Read;
    descriptors: ContentDescriptor[];
  }) => Promise<BaselineCoverage>;
  readonly authenticateEvidence: (input: {
    bytes: Uint8Array;
    expectedScanId: string;
    trust: Trust;
  }) => Promise<BaselineAuthentication>;
}
export interface ItemBaselineCoverage {
  readonly itemId: string;
  /** Capture matching and qualifying observations remain separate for each descriptor. */
  readonly members: readonly {
    readonly descriptor: ContentDescriptor;
    readonly capture: "matched" | "mismatched";
    readonly observationIds: readonly string[];
    readonly detectorsWithoutCoverage: readonly string[];
  }[];
}
export type PrepareBaselineResult =
  | {
      readonly valid: true;
      readonly release: CatalogRelease;
      readonly releaseBytes: Uint8Array;
      readonly inventory: Extract<ContentInventoryResult, { valid: true }>;
      readonly artifactBytes: Uint8Array;
      readonly authentication: BaselineAuthentication;
      readonly itemCoverage: readonly ItemBaselineCoverage[];
      readonly diagnostics: readonly [];
    }
  | { readonly valid: false; readonly diagnostics: readonly CatalogDiagnostic[] };
const refuse = (reason: string, unsupported = false): PrepareBaselineResult => ({
  valid: false,
  diagnostics: [
    {
      code: unsupported ? "SCHEMA_UNSUPPORTED" : "INPUT_INVALID",
      reason,
      message:
        "Release preparation requires exact, readable, authenticated matching baseline evidence.",
      blocking: true,
    },
  ],
});
const normalize = (paths: readonly string[]) => [...new Set(paths)].sort();

/** Enforced for every candidate, including content frozen from an older release format. */
export async function prepareReleaseBaseline<Read extends BaselineArtifactRead, Trust>(
  input: {
    readonly contentBytes: Uint8Array;
    readonly expectedSha256: string;
    readonly baseline: unknown;
    readonly trust: Trust;
  },
  services: BaselineServices<Read, Trust>,
): Promise<PrepareBaselineResult> {
  if (!input || input.baseline === undefined) return refuse("baseline-required");
  let baseline: unknown;
  try {
    baseline = deepFreeze(copyJson(input.baseline));
  } catch {
    return refuse("baseline-invalid");
  }
  if (isRecord(baseline) && baseline.schema !== SCAN_BASELINE_SCHEMA_ID)
    return refuse("unsupported-baseline", true);
  if (!validBaseline(baseline)) return refuse("baseline-invalid");
  const inventory = createContentInventory(input.contentBytes, {
    expectedSha256: input.expectedSha256,
  });
  if (!inventory.valid) return inventory;
  if (
    inventory.sha256 !== baseline.inventory.sha256 ||
    inventory.byteLength !== baseline.inventory.byteLength
  )
    return refuse("baseline-content-mismatch");
  const releaseBytes = new TextEncoder().encode(
    `${canonicalJson({ ...inventory.inventory.release, baseline })}\n`,
  );
  const read = readRelease(releaseBytes, { expectedSha256: sha256Hex(releaseBytes) });
  if (!read.valid) return read;
  let artifactBytes: Uint8Array;
  try {
    const acquired = await services.acquireArtifact(baseline.artifact);
    if (
      !(acquired instanceof Uint8Array) ||
      acquired.length !== baseline.artifact.byteLength ||
      sha256Hex(acquired) !== baseline.artifact.sha256
    )
      return refuse("baseline-artifact-mismatch");
    artifactBytes = acquired.slice();
  } catch {
    return refuse("baseline-unavailable");
  }
  try {
    const assessment = await services.readArtifact(artifactBytes.slice());
    if (assessment.status !== "read") return refuse("baseline-unreadable");
    if (assessment.scanId !== baseline.scanId) return refuse("baseline-scan-id-mismatch");
    if (
      canonicalJson(normalize(assessment.report.selection.paths)) !==
        canonicalJson(baseline.scope.paths) ||
      canonicalJson(normalize(assessment.report.selection.excludedPaths)) !==
        canonicalJson(baseline.scope.excludedPaths)
    )
      return refuse("baseline-scope-mismatch");
    const captured = await services.readContentCoverage({
      read: assessment,
      descriptors: [{ ...baseline.inventory }],
    });
    if (captured.status !== "matched") return refuse("baseline-inventory-not-captured");
    const authentication = await services.authenticateEvidence({
      bytes: artifactBytes.slice(),
      expectedScanId: baseline.scanId,
      trust: input.trust,
    });
    if (
      authentication.status !== "authenticated" ||
      authentication.scanId !== baseline.scanId ||
      typeof authentication.producerIdentity !== "string" ||
      !authentication.producerIdentity
    )
      return refuse("baseline-unauthenticated");
    const itemCoverage: ItemBaselineCoverage[] = [];
    for (const item of read.release.items) {
      const members: ItemBaselineCoverage["members"][number][] = [];
      for (const member of [item.recipe, ...item.materials]) {
        const descriptor = {
          path: member.path,
          sha256: member.sha256,
          byteLength: member.byteLength,
        };
        const coverage = await services.readContentCoverage({
          read: assessment,
          descriptors: [descriptor],
        });
        if (coverage.status !== "matched" && coverage.status !== "mismatched")
          return refuse("baseline-coverage-unreadable");
        members.push({
          descriptor,
          capture: coverage.status,
          observationIds:
            coverage.status === "matched" ? coverage.observations.map((o) => o.observationId) : [],
          detectorsWithoutCoverage:
            coverage.status === "matched" ? [...coverage.detectorsWithoutCoverage] : [],
        });
      }
      itemCoverage.push({ itemId: item.id, members });
    }
    return {
      valid: true,
      release: read.release,
      releaseBytes,
      inventory,
      artifactBytes,
      authentication: deepFreeze({ ...authentication }),
      itemCoverage: deepFreeze(itemCoverage),
      diagnostics: [],
    };
  } catch {
    return refuse("baseline-evidence-check-failed");
  }
}
