// Compiled inside the installed consumer to check real public declaration compatibility.
import { acquireBaselineArtifact, prepareReleaseBaseline } from "@aihq/catalog/node";
import { readArtifact, readContentCoverage } from "@aihq/scan/read";
import { authenticateEvidence } from "@aihq/core";
declare const contentBytes: Uint8Array;
declare const expectedSha256: string;
declare const baseline: unknown;
declare const trust: Parameters<typeof authenticateEvidence>[0]["trust"];
await prepareReleaseBaseline({ contentBytes, expectedSha256, baseline, trust }, {
  readArtifact, readContentCoverage, authenticateEvidence,
  acquireArtifact: artifact => acquireBaselineArtifact(artifact, { packageRoot: "fixture" }),
});
