import type { BaselineSourceEvidenceV1 } from "../catalog/baseline-lock-v1.js";
import type {
  PolicyAuthoringAssetV1,
  PolicyAuthoringFrameworkV1,
} from "../catalog/framework-catalogs-v1.js";
import { canonicalStrictJsonBytesV1, sha256HexV1 } from "../strict-json-v1.js";
import type { CompiledDeclarationV1 } from "./compiler-formats-v1.js";
import type { CompilerAssetDeclarationV1, EvidenceSummaryV1 } from "./contracts-v1.js";

/**
 * Compiles a source-locked upstream inventory without fetching, installing or
 * executing it. Ported from Core 80120883
 * src/org-policy/workbench/compilers/pinned-baseline.ts.
 */
function digest(bytes: Uint8Array | string): string {
  return `sha256:${sha256HexV1(bytes)}`;
}

function assetContentDigest(asset: PolicyAuthoringAssetV1): string {
  // A vetted component is represented by the immutable tree the scan covered.
  const pinnedIdentity = asset.vet?.treeSha256 ?? asset.metadata?.sourceSha256;
  if (pinnedIdentity === undefined)
    throw new TypeError(`pinned asset ${asset.id} has no declared content identity`);
  return `sha256:${pinnedIdentity}`;
}

type EvidenceComponentV1 = BaselineSourceEvidenceV1["components"][number];

function evidenceCoveredPaths(
  asset: PolicyAuthoringAssetV1,
  componentsById: ReadonlyMap<string, EvidenceComponentV1>,
): string[] {
  if (asset.vet === undefined) return [];
  const component = componentsById.get(asset.id);
  if (component === undefined || component.treeSha256 !== asset.vet.treeSha256)
    throw new TypeError(`pinned asset ${asset.id} has no matching evidence component`);
  return [...component.paths].sort();
}

export interface CompiledPinnedBaselineV1 {
  source: {
    id: string;
    revisionId: string;
    contentDigest: string;
    frameworkId: string;
    repository: string;
  };
  declarations: CompiledDeclarationV1[];
  relations: {
    fromAssetId: string;
    toAssetId: string;
    kind: "requires" | "member";
    membership?: "required" | "optional";
  }[];
  groups: Record<string, { id: string; label: string; assetIds: string[] }>;
  evidence: Record<string, EvidenceSummaryV1>;
  detailBytes: Record<string, string>;
}

export function compilePinnedBaselineV1(
  framework: PolicyAuthoringFrameworkV1,
  source: BaselineSourceEvidenceV1,
): CompiledPinnedBaselineV1 {
  if (
    source.id !== framework.id ||
    source.pinnedSha !== framework.commit ||
    `${source.owner}/${source.repo}` !== framework.repository
  )
    throw new TypeError(`pinned ${framework.id} source identity mismatch`);
  if (source.sourceTreeSha256 === undefined)
    throw new TypeError(`pinned ${framework.id} source has no declared source-tree identity`);
  const componentsById = new Map<string, EvidenceComponentV1>();
  for (const component of source.components)
    if (!componentsById.has(component.id)) componentsById.set(component.id, component);
  const sourceId = `source:${framework.id}`;
  const detailBytes: Record<string, string> = {};
  const declarations = framework.assets.map((asset): CompiledDeclarationV1 => {
    const id = `${framework.id}/${asset.id}`;
    const detailChunkId = `detail:${id}`;
    detailBytes[detailChunkId] = canonicalStrictJsonBytesV1({
      version: "pinned-baseline-detail/v1",
      asset: {
        id: asset.id,
        kind: asset.kind,
        ...(asset.curationKind === undefined ? {} : { curationKind: asset.curationKind }),
        ...(asset.riders === undefined ? {} : { riders: asset.riders }),
        ...(asset.dependencies === undefined ? {} : { dependencies: asset.dependencies }),
        ...(asset.members === undefined ? {} : { members: asset.members }),
        ...(asset.runtimeIdentity === undefined ? {} : { runtimeIdentity: asset.runtimeIdentity }),
        source: asset.source,
        sourcePaths: asset.sourcePaths,
        ...(asset.metadata === undefined ? {} : { metadata: asset.metadata }),
        ...(asset.vet === undefined ? {} : { vet: asset.vet }),
      },
    }).toString("utf8");
    const declaration: CompilerAssetDeclarationV1 = {
      id,
      sourceId,
      sourceRevisionId: framework.commit,
      contentDigest: assetContentDigest(asset),
      originalPath: asset.source.path,
      derivation: "upstream",
      kind: asset.kind,
      label: asset.metadata?.title ?? asset.id,
      detailChunkId,
      declaredHostCapabilities: [],
      ...(asset.runtimeIdentity === undefined ? {} : { runtimeIdentity: asset.runtimeIdentity }),
    };
    return { declaration, inputFormat: "pinned-baseline/v1" };
  });
  const methodologyId = `${framework.id}/profile:methodology`;
  const methodologyChunkId = `detail:${methodologyId}`;
  const methodologyDigest = digest(
    canonicalStrictJsonBytesV1({
      version: "methodology-profile-declaration/v1",
      framework: framework.id,
      source: { repository: framework.repository, commit: framework.commit },
    }),
  );
  detailBytes[methodologyChunkId] = canonicalStrictJsonBytesV1({
    version: "pinned-baseline-detail/v1",
    profile: {
      id: "methodology",
      framework: framework.id,
      identity: { kind: "declaration", digest: methodologyDigest },
    },
  }).toString("utf8");
  declarations.push({
    declaration: {
      id: methodologyId,
      sourceId,
      sourceRevisionId: framework.commit,
      contentDigest: methodologyDigest,
      originalPath: "profiles/methodology",
      derivation: "core-derived",
      kind: "profile",
      label: `${framework.id} methodology profile`,
      detailChunkId: methodologyChunkId,
      declaredHostCapabilities: [],
      exclusiveSlot: "methodology",
      methodologyKey: framework.id,
    },
    inputFormat: "pinned-baseline/v1",
  });
  const known = new Set(framework.assets.map((asset) => asset.id));
  const relations = framework.assets.flatMap((asset) => {
    const fromAssetId = `${framework.id}/${asset.id}`;
    const required = [...(asset.dependencies ?? []), ...(asset.riders ?? [])].map((id) => ({
      fromAssetId,
      toAssetId: `${framework.id}/${id}`,
      kind: "requires" as const,
    }));
    const members = (asset.members ?? []).map((id) => ({
      fromAssetId,
      toAssetId: `${framework.id}/${id}`,
      kind: "member" as const,
      membership: "optional" as const,
    }));
    for (const relation of [...required, ...members])
      if (!known.has(relation.toAssetId.slice(`${framework.id}/`.length)))
        throw new TypeError(
          `pinned ${framework.id} relation names absent asset ${relation.toAssetId}`,
        );
    return [...required, ...members];
  });
  const groups = Object.fromEntries(
    [...new Set(framework.assets.map((asset) => asset.kind))].sort().map((kind) => {
      const id = `group:${framework.id}/${kind}`;
      return [
        id,
        {
          id,
          label: `${framework.id} ${kind}`,
          assetIds: declarations
            .filter(({ declaration }) => declaration.kind === kind)
            .map(({ declaration }) => declaration.id)
            .sort(),
        },
      ];
    }),
  );
  const evidence = Object.fromEntries(
    framework.assets.flatMap((asset): [string, EvidenceSummaryV1][] => {
      if (asset.vet === undefined) return [];
      const assetId = `${framework.id}/${asset.id}`;
      const coveredPaths = evidenceCoveredPaths(asset, componentsById);
      const evidenceBytes = canonicalStrictJsonBytesV1({
        version: "pinned-baseline-evidence/v1",
        source: { repository: framework.repository, commit: framework.commit },
        asset: { id: asset.id, treeSha256: asset.vet.treeSha256, coveredPaths },
        verdict: asset.vet.verdict,
        analyzers: asset.vet.analyzers,
        findings: asset.vet.findings,
      });
      return [
        [
          `evidence:${assetId}`,
          {
            id: `evidence:${assetId}`,
            projectionVersion: "evidence-summary/v1",
            subjects: [
              {
                assetId,
                sourceId,
                sourceRevisionId: framework.commit,
                contentDigest: assetContentDigest(asset),
              },
            ],
            evidenceDigest: digest(evidenceBytes),
            coveredPaths,
            verification: { state: "unverified" },
            scan: {
              outcome: asset.vet.verdict === "pass" ? "pass" : "failed",
              coverage: "complete",
              analyzers: asset.vet.analyzers.map(({ name, version }) => ({ name, version })),
            },
            qualification: { state: "unknown" },
            findings: asset.vet.findings.map((finding) => `${finding.code}: ${finding.detail}`),
          } as EvidenceSummaryV1,
        ],
      ];
    }),
  );
  return {
    source: {
      id: sourceId,
      revisionId: framework.commit,
      contentDigest: `sha256:${source.sourceTreeSha256}`,
      frameworkId: framework.id,
      repository: framework.repository,
    },
    declarations,
    relations,
    groups,
    evidence,
    detailBytes,
  };
}
