import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Generator = {
  generateSourceAssessmentRowsV1(input: {
    sourceRoot: string;
    handoffPath: string;
    publicationPath: string;
    provider: string;
    outputRoot: string;
    manifestPath: string;
  }): { entries: number; seedPaths: string[] };
  hashComponentTreeV1(
    sourceRoot: string,
    paths: string[],
  ): { treeSha256: string; files: { path: string; bytes: number; sha256: string }[] };
  hashSourceTreeV1(sourceRoot: string): { treeSha256: string };
};

async function generator(): Promise<Generator> {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return (await import("../../tools/generate-source-assessment-rows.mjs")) as Generator;
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(",")}}`;
};
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const writeJson = (path: string, value: unknown) => writeFileSync(path, canonical(value));
const pae = (payloadType: string, payload: Buffer) =>
  Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${payload.length} `),
    payload,
  ]);

const temporaryRoots: string[] = [];
const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function fixture() {
  const api = await generator();
  const root = mkdtempSync(join(tmpdir(), "aih-catalog-source-generator-"));
  temporaryRoots.push(root);
  const sourceRoot = join(root, "source");
  const skillRoot = join(sourceRoot, "skills", "demo");
  const publicationRoot = join(root, "publication");
  mkdirSync(skillRoot, { recursive: true });
  mkdirSync(join(publicationRoot, "components"), { recursive: true });
  writeFileSync(join(skillRoot, "LICENSE.txt"), "MIT License\n\nPermission is hereby granted.\n");
  writeFileSync(join(skillRoot, "SKILL.md"), "# Demo\n\nReview this source.\n");

  const sourceHash = api.hashSourceTreeV1(sourceRoot);
  const componentHash = api.hashComponentTreeV1(sourceRoot, ["skills/demo"]);
  const source = {
    id: "fixture-skills",
    owner: "example",
    pinnedCommit: "a".repeat(40),
    repository: "skills",
    treeSha256: sourceHash.treeSha256,
  };
  const requestSha256 = "b".repeat(64);
  const receiptSha256 = "c".repeat(64);
  const signedAt = "2026-01-01T00:00:00.000Z";
  const expiresAt = "2026-01-01T00:45:00.000Z";
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${sha256(publicKeyBytes)}`;
  const payloadType = "application/vnd.in-toto+json";
  const payloadValue = {
    _type: "https://in-toto.io/Statement/v1",
    predicate: {
      claims: { expiresAt, origin: "signer-asserted", provenance: "none", signedAt },
      protocol: "BaselineVetAttestationV1",
      receiptSha256,
      requestSha256,
      signer: {
        class: "test-ephemeral",
        identity: "github-actions:aih-scan-baseline-publication",
        keyId,
      },
    },
    predicateType: "https://aih.dev/BaselineVetAttestationV1",
    subject: [{ digest: { sha256: receiptSha256 }, name: "baseline-vet-receipt" }],
  };
  const payload = Buffer.from(canonical(payloadValue));
  const publication = {
    annexes: [],
    envelope: {
      payload: payload.toString("base64"),
      payloadType,
      signatures: [
        {
          keyid: keyId,
          sig: sign(null, pae(payloadType, payload), privateKey).toString("base64"),
        },
      ],
    },
    protocol: "BaselineVetPublicationV1",
    receipt: {
      components: [],
      observations: [],
      profile: "fixture",
      protocol: "BaselineVetReceiptV1",
      receiptSha256,
      requestSha256,
      source,
    },
    request: {
      components: [],
      profile: "fixture",
      protocol: "BaselineVetRequestV1",
      requestSha256,
      source,
    },
    verification: {
      expected: {
        now: signedAt,
        signer: {
          class: "test-ephemeral",
          identity: "github-actions:aih-scan-baseline-publication",
          keyId,
        },
      },
      root: {
        class: "test-ephemeral",
        identity: "github-actions:aih-scan-baseline-publication",
        keyId,
        publicKeySpkiBase64: publicKeyBytes.toString("base64"),
      },
    },
  };
  const publicationPath = join(publicationRoot, "publication.json");
  writeJson(publicationPath, publication);
  const publicationBytes = readFileSync(publicationPath);
  const publicationSha256 = sha256(publicationBytes);
  const scannerComponentId = "skill:skills-demo-0123456789ab";
  const catalogAssetId = "fixture-skills/skill:demo";
  const analyzerExecution = ["aih-native", "skillspector", "semgrep", "cisco"].map((analyzer) => ({
    analyzer,
    analyzerVersion: "fixture",
    annex: { path: `annex/${analyzer}.json`, sha256: "d".repeat(64) },
    executionSuccessful: true,
    fileCount: 2,
    sourceTreeSha256: source.treeSha256,
    resultCount: analyzer === "cisco" ? 1 : 0,
    notificationCount: analyzer === "skillspector" ? 1 : 0,
  }));
  const findings = [
    {
      analyzer: "cisco",
      runIndex: 0,
      ruleId: "FIXTURE_RULE",
      level: "warning",
      kind: null,
      message: "Fixture finding remains unresolved.",
      locations: [{ path: "skills/demo/SKILL.md", startLine: 1, startColumn: 1 }],
      componentIds: [scannerComponentId],
      unmapped: false,
    },
  ];
  const coverage = [
    {
      analyzer: "skillspector",
      runIndex: 0,
      kind: "toolExecutionNotifications",
      level: "warning",
      message: "Fixture analyzer limitation.",
      descriptor: null,
      properties: { kind: "inspection_limitation" },
      locations: [],
      componentIds: [],
      unmapped: true,
    },
  ];
  const findingSummary = {
    count: 1,
    byAnalyzer: { cisco: 1 },
    byLevel: { warning: 1 },
    byRule: { FIXTURE_RULE: 1 },
  };
  const emptyCoverageSummary = {
    count: 0,
    byAnalyzer: {},
    byLevel: {},
    byMessage: {},
    byReasonCode: {},
  };
  const globalCoverageSummary = {
    count: 1,
    byAnalyzer: { skillspector: 1 },
    byLevel: { warning: 1 },
    byMessage: { "Fixture analyzer limitation.": 1 },
    byReasonCode: { null: 1 },
  };
  const componentArtifact = {
    protocol: "ScannerComponentObservationHandoffV1",
    authority: "none",
    outcome: "observed",
    riskDecision: "consumer_required",
    publisherCommit: "e".repeat(40),
    source,
    requestSha256,
    receiptSha256,
    publicationSha256,
    scannerComponentId,
    catalogAssetId,
    content: "skill",
    paths: ["skills/demo"],
    treeSha256: componentHash.treeSha256,
    requestedAnalyzers: ["aih-native", "skillspector", "semgrep", "cisco"],
    analyzerExecution,
    findings,
    findingSummary,
    locationBoundCoverageNotifications: [],
    locationBoundCoverageSummary: emptyCoverageSummary,
    globalCoverageNotifications: coverage,
    globalCoverageSummary,
    coverageComplete: false,
    coverageDisposition: "The limitation remains unresolved.",
  };
  const componentPath = join(publicationRoot, "components", "skill-skills-demo-0123456789ab.json");
  writeJson(componentPath, componentArtifact);
  const componentBytes = readFileSync(componentPath);
  const component = {
    scannerComponentId,
    catalogAssetId,
    content: "skill",
    paths: ["skills/demo"],
    treeSha256: componentHash.treeSha256,
    requestedAnalyzers: ["aih-native", "skillspector", "semgrep", "cisco"],
    findings: findingSummary,
    locationBoundCoverage: emptyCoverageSummary,
    globalCoverage: globalCoverageSummary,
    observationArtifact: {
      path: componentPath,
      byteLength: componentBytes.length,
      sha256: sha256(componentBytes),
    },
  };
  const handoff = {
    protocol: "ScannerPublicationConsumerHandoffV1",
    authority: "none",
    outcome: "observed_with_gaps",
    riskDecision: "consumer_required",
    api: { package: "@aihq/scan", version: "0.4.0", node: ">=20" },
    publisherCommit: componentArtifact.publisherCommit,
    source,
    sourceArchive: { provenance: "Exact fixture archive." },
    requestSha256,
    receiptSha256,
    publicationSha256,
    discoverySha256: "f".repeat(64),
    inspectionSha256: "1".repeat(64),
    release: {
      tag: `baseline-v1-${componentArtifact.publisherCommit}-${requestSha256}`,
      url: `https://github.com/example/scan/releases/tag/baseline-v1-${componentArtifact.publisherCommit}-${requestSha256}`,
      targetCommitish: componentArtifact.publisherCommit,
    },
    workflow: {
      status: "completed",
      conclusion: "success",
      headSha: componentArtifact.publisherCommit,
    },
    attestation: {
      subject: { name: "publication.json", digest: { sha256: publicationSha256 } },
      sourceRepositoryDigest: componentArtifact.publisherCommit,
      sourceRepositoryRef: "refs/heads/main",
      runnerEnvironment: "github-hosted",
      verifiedTimestampCount: 1,
    },
    envelope: {
      authority: "none",
      envelopeValid: true,
      annexesComplete: true,
      sameRunArtifactAndReleaseBytesMatch: true,
      cliInspectionMatchesReleasedInspection: true,
    },
    analyzers: analyzerExecution,
    analyzerGaps: {
      missingAnalyzers: [],
      failedAnalyzers: [],
      errorNotificationCount: 0,
      coverageWarningCount: 1,
      coverageComplete: false,
    },
    findings: { mappedToDeclaredClosures: findingSummary },
    coverageNotifications: { global: globalCoverageSummary },
    mapping: {
      sourceId: source.id,
      requestSha256,
      sourceTreeSha256: source.treeSha256,
      contentClass: "exact compiler/source-file closure for assessment only",
      runtimeCapabilityClaim: [],
      exclusions: [],
      components: [
        {
          scannerComponentId,
          catalogAssetId,
          paths: ["skills/demo"],
          treeSha256: componentHash.treeSha256,
          analyzers: ["aih-native", "skillspector", "semgrep", "cisco"],
        },
      ],
    },
    components: [component],
    rawReports: [],
    localInspection: {},
  };
  const handoffPath = join(publicationRoot, "consumer-handoff.json");
  writeJson(handoffPath, handoff);
  const manifestPath = join(root, "defaults", "default-catalog-seed-manifest-v2.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeJson(manifestPath, {
    format: "aih-supported-candidate-seed-manifest",
    seeds: ["default-catalog-v2.json"],
    version: 1,
  });
  return {
    api,
    root,
    sourceRoot,
    skillRoot,
    publicationPath,
    handoffPath,
    handoff,
    manifestPath,
    outputRoot: join(root, "defaults", "workbench", "fixture"),
  };
}

describe("source assessment row generator", () => {
  it("binds exact protected observations into review-only rows and updates the seed manifest", async () => {
    const item = await fixture();
    const result = item.api.generateSourceAssessmentRowsV1({
      sourceRoot: item.sourceRoot,
      handoffPath: item.handoffPath,
      publicationPath: item.publicationPath,
      provider: "fixture",
      outputRoot: item.outputRoot,
      manifestPath: item.manifestPath,
    });
    expect(result).toEqual({
      entries: 1,
      seedPaths: ["workbench/fixture/skill.fixture.demo/seed.json"],
    });
    const seed = JSON.parse(
      readFileSync(join(item.outputRoot, "skill.fixture.demo", "seed.json"), "utf8"),
    );
    expect(seed).toMatchObject({
      entryId: "skill.fixture.demo",
      capabilities: { commands: [], egress: [], hooks: [], mcpTools: [], permissions: [] },
      qualification: {
        gaps: [
          "evidence/coverage-gap.json",
          "evidence/publication-1.json",
          "evidence/scope-gap.json",
        ],
      },
    });
    expect(JSON.parse(readFileSync(item.manifestPath, "utf8")).seeds).toEqual([
      "default-catalog-v2.json",
      "workbench/fixture/skill.fixture.demo/seed.json",
    ]);
  });

  it("fails closed on unexpected handoff fields, mismatched publications, and partial mapping", async () => {
    for (const mutate of [
      (handoff: Record<string, unknown>) => Object.assign(handoff, { unexpected: true }),
      (handoff: Record<string, unknown>) =>
        Object.assign(handoff, { publicationSha256: "0".repeat(64) }),
      (handoff: Record<string, unknown>) =>
        Object.assign(handoff.mapping as Record<string, unknown>, { components: [] }),
    ]) {
      const item = await fixture();
      const changed = structuredClone(item.handoff) as Record<string, unknown>;
      mutate(changed);
      writeJson(item.handoffPath, changed);
      expect(() =>
        item.api.generateSourceAssessmentRowsV1({
          sourceRoot: item.sourceRoot,
          handoffPath: item.handoffPath,
          publicationPath: item.publicationPath,
          provider: "fixture",
          outputRoot: item.outputRoot,
          manifestPath: item.manifestPath,
        }),
      ).toThrow();
    }
  });

  it("rejects transformed source bytes, symbolic links in closures, and existing output", async () => {
    const transformed = await fixture();
    writeFileSync(join(transformed.skillRoot, "SKILL.md"), "# Demo\r\n\r\nReview this source.\r\n");
    expect(() =>
      transformed.api.generateSourceAssessmentRowsV1({
        sourceRoot: transformed.sourceRoot,
        handoffPath: transformed.handoffPath,
        publicationPath: transformed.publicationPath,
        provider: "fixture",
        outputRoot: transformed.outputRoot,
        manifestPath: transformed.manifestPath,
      }),
    ).toThrow(/source.*digest/i);

    const symbolic = await fixture();
    symlinkSync(join(symbolic.skillRoot, "SKILL.md"), join(symbolic.skillRoot, "alias.md"));
    expect(() => symbolic.api.hashComponentTreeV1(symbolic.sourceRoot, ["skills/demo"])).toThrow(
      /symbolic link/,
    );

    const existing = await fixture();
    mkdirSync(existing.outputRoot, { recursive: true });
    expect(() =>
      existing.api.generateSourceAssessmentRowsV1({
        sourceRoot: existing.sourceRoot,
        handoffPath: existing.handoffPath,
        publicationPath: existing.publicationPath,
        provider: "fixture",
        outputRoot: existing.outputRoot,
        manifestPath: existing.manifestPath,
      }),
    ).toThrow(/output.*exists/i);
  });

  it("rejects a symbolic ancestor of a declared source closure", async () => {
    const item = await fixture();
    const externalSkills = join(item.root, "external-skills");
    renameSync(join(item.sourceRoot, "skills"), externalSkills);
    symlinkSync(externalSkills, join(item.sourceRoot, "skills"), directoryLinkType);

    expect(() => item.api.hashComponentTreeV1(item.sourceRoot, ["skills/demo"])).toThrow(
      /symbolic.*ancestor/i,
    );
  });

  it("rejects an output-parent junction before changing output or the manifest", async () => {
    const item = await fixture();
    const manifestBefore = readFileSync(item.manifestPath);
    const externalWorkbench = join(item.root, "external-workbench");
    mkdirSync(externalWorkbench);
    symlinkSync(
      externalWorkbench,
      join(item.root, "defaults", "workbench"),
      directoryLinkType,
    );

    expect(() =>
      item.api.generateSourceAssessmentRowsV1({
        sourceRoot: item.sourceRoot,
        handoffPath: item.handoffPath,
        publicationPath: item.publicationPath,
        provider: "fixture",
        outputRoot: item.outputRoot,
        manifestPath: item.manifestPath,
      }),
    ).toThrow(/output.*ancestor/i);
    expect(existsSync(join(externalWorkbench, "fixture"))).toBe(false);
    expect(readFileSync(item.manifestPath)).toEqual(manifestBefore);
  });

  it("rejects a manifest-ancestor junction before changing output or the manifest", async () => {
    const item = await fixture();
    const externalDefaults = join(item.root, "external-defaults");
    renameSync(join(item.root, "defaults"), externalDefaults);
    symlinkSync(externalDefaults, join(item.root, "defaults"), directoryLinkType);
    const manifestBefore = readFileSync(item.manifestPath);

    expect(() =>
      item.api.generateSourceAssessmentRowsV1({
        sourceRoot: item.sourceRoot,
        handoffPath: item.handoffPath,
        publicationPath: item.publicationPath,
        provider: "fixture",
        outputRoot: item.outputRoot,
        manifestPath: item.manifestPath,
      }),
    ).toThrow(/manifest.*ancestor/i);
    expect(existsSync(join(externalDefaults, "workbench", "fixture"))).toBe(false);
    expect(readFileSync(item.manifestPath)).toEqual(manifestBefore);
  });
});
