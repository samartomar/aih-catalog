import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Json = Record<string, unknown>;
type Generator = {
  generateSourceAssessmentRowsV1(input: {
    sourceRoot: string;
    handoffPath: string;
    publicationPath: string;
    provider: string;
    outputRoot: string;
    manifestPath: string;
    definitionPath?: string;
  }): { entries: number; seedPaths: string[]; excluded?: Json[] };
  hashComponentTreeV1(sourceRoot: string, paths: string[]): { treeSha256: string };
  hashSourceTreeV1(sourceRoot: string): { treeSha256: string };
};

type MappingHelper = {
  deriveClosureMappingV1(
    publication: unknown,
    definition: unknown,
  ): { mapping: Json; rows: string[]; excluded: Json[] };
};

async function mappingHelper(): Promise<MappingHelper> {
  // @ts-expect-error The maintenance helper is intentionally plain ESM JavaScript.
  return (await import("../../tools/derive-closure-mapping.mjs")) as MappingHelper;
}

async function generator(): Promise<Generator> {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return (await import("../../tools/generate-source-assessment-rows.mjs")) as Generator;
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Json;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(",")}}`;
};
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const writeJson = (path: string, value: unknown) => writeFileSync(path, canonical(value));
const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Json;
const MIT = "MIT License\n\nCopyright (c) 2026 Fixture\n\nPermission is hereby granted.\n";
const ANALYZERS = ["aih-native", "cisco"];

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

interface Partition {
  id: string;
  content: string;
  paths: string[];
}
interface FixtureFinding {
  analyzer: string;
  ruleId: string;
  path: string;
}
interface Options {
  files: Record<string, string>;
  partition: Partition[];
  mapped: string[];
  findings: FixtureFinding[];
  definition: (source: Json, files: Record<string, string>) => Json;
  nativeOverride?: Record<string, string>;
  tamperReceipt?: boolean;
}

const within = (component: Partition, path: string) =>
  component.paths.some((root) => path === root || path.startsWith(`${root}/`));

/**
 * A whole-repository Scanner publication over a fixture tree: a signed statement over a
 * receipt whose digest is the Scan receipt domain digest, one native annex with per-file
 * hashes bound by that receipt, and a consumer handoff whose mapping covers `mapped`.
 */
async function fixture(options: Options) {
  const api = await generator();
  const root = mkdtempSync(join(tmpdir(), "aih-catalog-closure-rows-"));
  temporaryRoots.push(root);
  const sourceRoot = join(root, "source");
  const publicationRoot = join(root, "publication");
  mkdirSync(join(publicationRoot, "components"), { recursive: true });
  for (const [path, text] of Object.entries(options.files)) {
    mkdirSync(dirname(join(sourceRoot, path)), { recursive: true });
    writeFileSync(join(sourceRoot, path), text);
  }
  const source = {
    id: "fixture",
    owner: "example",
    pinnedCommit: "a".repeat(40),
    repository: "tools",
    treeSha256: api.hashSourceTreeV1(sourceRoot).treeSha256,
  };
  const trees = new Map(
    options.partition.map((component) => [
      component.id,
      api.hashComponentTreeV1(sourceRoot, component.paths).treeSha256,
    ]),
  );
  const native = {
    files: Object.keys(options.files)
      .sort()
      .map((path) => ({
        bytes: Buffer.byteLength(options.files[path] as string),
        path,
        sha256: options.nativeOverride?.[path] ?? sha256(options.files[path] as string),
      })),
    protocol: "BaselineNativeObservationV1",
    sourceTreeSha256: source.treeSha256,
  };
  const nativeBytes = Buffer.from(canonical(native));
  const requestSha256 = "b".repeat(64);
  const authoring: Json = {
    components: options.partition.map((component) => ({
      content: component.content,
      id: component.id,
      observations: ANALYZERS.map((analyzer) => ({
        analyzer,
        annexSha256: analyzer === "aih-native" ? sha256(nativeBytes) : "d".repeat(64),
      })),
      paths: component.paths,
      treeSha256: trees.get(component.id),
    })),
    observations: [],
    profile: "fixture",
    protocol: "BaselineVetReceiptV1",
    requestSha256,
    source,
  };
  const receiptSha256 = sha256(
    canonical({ domain: "aih.baseline-vet-receipt-v1", receipt: authoring }),
  );
  if (options.tamperReceipt) authoring.profile = "tampered";
  const signedAt = "2026-01-01T00:00:00.000Z";
  const expiresAt = "2026-01-01T00:45:00.000Z";
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${sha256(publicKeyBytes)}`;
  const signer = {
    class: "test-ephemeral",
    identity: "github-actions:aih-scan-baseline-publication",
    keyId,
  };
  const payloadType = "application/vnd.in-toto+json";
  const payload = Buffer.from(
    canonical({
      _type: "https://in-toto.io/Statement/v1",
      predicate: {
        claims: { expiresAt, origin: "signer-asserted", provenance: "none", signedAt },
        protocol: "BaselineVetAttestationV1",
        receiptSha256,
        requestSha256,
        signer,
      },
      predicateType: "https://aih.dev/BaselineVetAttestationV1",
      subject: [{ digest: { sha256: receiptSha256 }, name: "baseline-vet-receipt" }],
    }),
  );
  const pae = Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${payload.length} `),
    payload,
  ]);
  const publication = {
    annexes: [{ bytesBase64: nativeBytes.toString("base64"), path: "annex/aih-native.json" }],
    envelope: {
      payload: payload.toString("base64"),
      payloadType,
      signatures: [{ keyid: keyId, sig: sign(null, pae, privateKey).toString("base64") }],
    },
    protocol: "BaselineVetPublicationV1",
    receipt: { ...authoring, receiptSha256 },
    request: {
      components: options.partition.map((component) => ({
        analyzers: ANALYZERS,
        content: component.content,
        id: component.id,
        paths: component.paths,
        treeSha256: trees.get(component.id),
      })),
      profile: "fixture",
      protocol: "BaselineVetRequestV1",
      requestSha256,
      source,
    },
    verification: {
      expected: { now: signedAt, signer },
      root: { ...signer, publicKeySpkiBase64: publicKeyBytes.toString("base64") },
    },
  };
  const publicationPath = join(publicationRoot, "publication.json");
  writeJson(publicationPath, publication);
  const publicationSha256 = sha256(readFileSync(publicationPath));
  const publisherCommit = "e".repeat(40);
  const summaryOf = (rows: FixtureFinding[]) => ({
    count: rows.length,
    byAnalyzer: {},
    byLevel: {},
    byRule: {},
  });
  const emptyCoverage = { count: 0, byAnalyzer: {}, byLevel: {}, byMessage: {}, byReasonCode: {} };
  const mappedComponents = options.partition.filter((component) =>
    options.mapped.includes(component.id),
  );
  let mappedFindings = 0;
  const handoffComponents = mappedComponents.map((component) => {
    const suffix = component.id.split(":")[1] as string;
    const catalogAssetId = `${source.id}/${component.content}:${suffix}`;
    const own = options.findings.filter((finding) => within(component, finding.path));
    mappedFindings += own.length;
    const findings = own.map((finding) => ({
      analyzer: finding.analyzer,
      componentIds: [component.id],
      kind: null,
      level: "warning",
      locations: [{ path: finding.path, startColumn: null, startLine: 1 }],
      message: `${finding.ruleId} fixture`,
      ruleId: finding.ruleId,
      runIndex: 0,
      unmapped: false,
    }));
    const artifact = {
      protocol: "ScannerComponentObservationHandoffV1",
      authority: "none",
      outcome: "observed",
      riskDecision: "consumer_required",
      publisherCommit,
      source,
      requestSha256,
      receiptSha256,
      publicationSha256,
      scannerComponentId: component.id,
      catalogAssetId,
      content: component.content,
      paths: component.paths,
      treeSha256: trees.get(component.id),
      requestedAnalyzers: ANALYZERS,
      analyzerExecution: ANALYZERS.map((analyzer) => ({ analyzer, executionSuccessful: true })),
      findings,
      findingSummary: summaryOf(own),
      locationBoundCoverageNotifications: [],
      locationBoundCoverageSummary: emptyCoverage,
      globalCoverageNotifications: [],
      globalCoverageSummary: emptyCoverage,
      coverageComplete: true,
      coverageGaps: [],
      coverageDisposition: "Complete.",
    };
    const artifactPath = join(publicationRoot, "components", `${suffix}.json`);
    writeJson(artifactPath, artifact);
    const bytes = readFileSync(artifactPath);
    return {
      mapping: {
        scannerComponentId: component.id,
        catalogAssetId,
        paths: component.paths,
        treeSha256: trees.get(component.id),
        analyzers: ANALYZERS,
      },
      summary: {
        scannerComponentId: component.id,
        catalogAssetId,
        content: component.content,
        paths: component.paths,
        treeSha256: trees.get(component.id),
        requestedAnalyzers: ANALYZERS,
        findings: summaryOf(own),
        locationBoundCoverage: emptyCoverage,
        globalCoverage: emptyCoverage,
        observationArtifact: {
          path: artifactPath,
          byteLength: bytes.length,
          sha256: sha256(bytes),
        },
      },
    };
  });
  const handoff = {
    protocol: "ScannerPublicationConsumerHandoffV1",
    authority: "none",
    outcome: "observed_with_gaps",
    riskDecision: "consumer_required",
    api: { package: "@aihq/scan", version: "0.5.0", node: ">=20" },
    publisherCommit,
    source,
    sourceArchive: { provenance: "Exact fixture archive." },
    requestSha256,
    receiptSha256,
    publicationSha256,
    discoverySha256: "f".repeat(64),
    inspectionSha256: "1".repeat(64),
    release: {
      tag: `baseline-v1-${publisherCommit}-${requestSha256}`,
      url: `https://github.com/example/scan/releases/tag/baseline-v1-${publisherCommit}-${requestSha256}`,
      targetCommitish: publisherCommit,
    },
    workflow: { status: "completed", conclusion: "success", headSha: publisherCommit },
    attestation: {
      subject: { name: "publication.json", digest: { sha256: publicationSha256 } },
      sourceRepositoryDigest: publisherCommit,
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
    analyzers: [],
    analyzerGaps: {
      missingAnalyzers: [],
      failedAnalyzers: [],
      errorNotificationCount: 0,
      coverageWarningCount: 0,
      completionEvidenceAbsent: ["cisco"],
      coverageComplete: false,
    },
    findings: {
      mappedToDeclaredClosures: { count: mappedFindings, byAnalyzer: {}, byLevel: {}, byRule: {} },
    },
    coverageNotifications: { global: emptyCoverage },
    mapping: {
      sourceId: source.id,
      requestSha256,
      sourceTreeSha256: source.treeSha256,
      contentClass: "exact compiler/source-file closure for assessment only",
      runtimeCapabilityClaim: [],
      exclusions: options.partition
        .filter((component) => !options.mapped.includes(component.id))
        .map((component) => ({ reason: "fixture", scannerComponentId: component.id })),
      components: handoffComponents.map((item) => item.mapping),
    },
    components: handoffComponents.map((item) => item.summary),
    rawReports: [],
    localInspection: {},
  };
  const handoffPath = join(publicationRoot, "consumer-handoff.json");
  writeJson(handoffPath, handoff);
  const definitionPath = join(root, "definition.json");
  writeJson(definitionPath, options.definition(source, options.files));
  const manifestPath = join(root, "defaults", "default-catalog-seed-manifest-v2.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeJson(manifestPath, {
    format: "aih-supported-candidate-seed-manifest",
    seeds: ["default-catalog-v2.json"],
    version: 1,
  });
  const outputRoot = join(root, "defaults", "workbench", "fixture");
  const run = (definition = true) =>
    api.generateSourceAssessmentRowsV1({
      sourceRoot,
      handoffPath,
      publicationPath,
      provider: "fixture",
      outputRoot,
      manifestPath,
      ...(definition ? { definitionPath } : {}),
    });
  return { run, outputRoot, source, definitionPath, publicationPath };
}

const FILES = {
  LICENSE: MIT,
  "README.md": "# Fixture\n",
  "skills/demo/SKILL.md": "# Demo\n",
  "skills/demo/ref.md": "Reference.\n",
  "server/index.js": "export {};\n",
  "hooks/start.js": "export {};\n",
};
const PARTITION: Partition[] = [
  { id: "runtime:root-000000000001", content: "general", paths: ["LICENSE", "README.md"] },
  { id: "skill:skills-demo-000000000002", content: "skill", paths: ["skills/demo"] },
  { id: "runtime:server-000000000003", content: "general", paths: ["server"] },
  { id: "runtime:hooks-000000000004", content: "general", paths: ["hooks"] },
];
const FINDINGS: FixtureFinding[] = [
  { analyzer: "cisco", ruleId: "SKILL_RULE", path: "skills/demo/SKILL.md" },
  { analyzer: "cisco", ruleId: "README_RULE", path: "README.md" },
  { analyzer: "aih-native", ruleId: "SERVER_RULE", path: "server/index.js" },
];

/** The Catalog's pinned component collection declaration for the fixture tree. */
function componentCollection(source: Json, files: Record<string, string>): Json {
  return {
    version: "pinned-component-collection/v1",
    source: {
      id: source.id,
      repository: `https://github.com/${source.owner}/${source.repository}`,
      commit: source.pinnedCommit,
      version: "1.0.0",
      licenseFileRef: "LICENSE",
    },
    files: Object.entries(files).map(([path, text]) => ({
      path,
      bytesBase64: Buffer.from(text).toString("base64"),
      sha256: `sha256:${sha256(text)}`,
      size: Buffer.byteLength(text),
    })),
    components: [
      {
        id: "skill:demo",
        kind: "skill",
        label: "Demo",
        fileRefs: ["skills/demo/SKILL.md", "skills/demo/ref.md"],
        description: "Demo skill.",
        primaryPath: "skills/demo/SKILL.md",
      },
      {
        id: "mcp:demo",
        kind: "mcp",
        label: "Demo server",
        fileRefs: ["server/index.js", "skills/demo/SKILL.md"],
        description: "Demo server.",
        primaryPath: "server/index.js",
      },
      {
        id: "hook:start",
        kind: "hook",
        label: "Start",
        fileRefs: ["hooks/start.js"],
        description: "Start hook.",
        primaryPath: "hooks/start.js",
      },
    ],
    profile: {},
    template: {},
  };
}

const base: Omit<Options, "definition"> = {
  files: FILES,
  partition: PARTITION,
  mapped: PARTITION.slice(0, 3).map((component) => component.id),
  findings: FINDINGS,
};

describe("source-assessment closure-row mode", () => {
  it("renders skill and mcp rows from the curated compiler closure plus the root license", async () => {
    const item = await fixture({ ...base, definition: componentCollection });
    const result = item.run();
    expect(result.entries).toBe(2);
    expect(result.excluded).toEqual([
      {
        id: "hook:start",
        kind: "hook",
        reason:
          "hook is not a supported Catalog subject kind (ai-coding/supported-catalog-v2.md:59-60; README.md:39-40)",
      },
    ]);
    const skill = join(item.outputRoot, "skill.fixture.demo");
    const mcp = join(item.outputRoot, "mcp.fixture.demo");
    const closure = (dir: string) =>
      (read(join(dir, "artifacts", "closure.json")).files as { path: string }[]).map(
        (file) => file.path,
      );
    expect(closure(skill)).toEqual(["LICENSE", "skills/demo/SKILL.md", "skills/demo/ref.md"]);
    expect(closure(mcp)).toEqual(["LICENSE", "server/index.js", "skills/demo/SKILL.md"]);
    const mcpSeed = read(join(mcp, "seed.json"));
    expect(mcpSeed.entryId).toBe("mcp.fixture.demo");
    expect(mcpSeed.subject).toEqual({
      id: "demo",
      kind: "mcp",
      source: {
        commit: "a".repeat(40),
        path: "server/index.js",
        repository: "example/tools",
        type: "github",
      },
    });
    // Findings located in the closure: the SKILL.md one for both rows, the server one for mcp.
    const report = (dir: string) => read(join(dir, "evidence", "report.json")).summary as string;
    expect(report(skill)).toContain("Scanner mapped findings: 1;");
    expect(report(mcp)).toContain("Scanner mapped findings: 2;");
    expect(report(mcp)).toContain(
      "each of the 3 closure files matches the pinned checkout and the publication's native per-file hash",
    );
    expect(report(skill)).not.toContain("README_RULE");
    const right = read(join(mcp, "evidence", "source-right.json")).summary as string;
    expect(right).toMatch(/^Applicable MIT notice at example\/tools@a{40}:LICENSE, sha256:/);
  });

  it("refuses a closure file whose native per-file hash differs from the checkout", async () => {
    const item = await fixture({
      ...base,
      definition: componentCollection,
      nativeOverride: { "server/index.js": "0".repeat(64) },
    });
    expect(() => item.run()).toThrow("source-assessment-generator:closure-file-native-digest");
  });

  it("refuses a receipt that does not hash to the signed receipt digest", async () => {
    const item = await fixture({ ...base, definition: componentCollection, tamperReceipt: true });
    expect(() => item.run()).toThrow("source-assessment-generator:publication-receipt-digest");
  });

  it("refuses a closure file outside every mapped Scanner component", async () => {
    const item = await fixture({
      ...base,
      mapped: PARTITION.slice(1, 3).map((component) => component.id),
      definition: componentCollection,
    });
    expect(() => item.run()).toThrow("source-assessment-generator:closure-file-unmapped");
  });

  it("refuses a definition for another pin or with a declared digest the source does not have", async () => {
    const other = await fixture({
      ...base,
      definition: (source, files) => {
        const definition = componentCollection(source, files);
        (definition.source as Json).commit = "9".repeat(40);
        return definition;
      },
    });
    expect(() => other.run()).toThrow("source-assessment-generator:definition-source");
    const declared = await fixture({
      ...base,
      definition: (source, files) => {
        const definition = componentCollection(source, files);
        ((definition.files as Json[])[4] as Json).sha256 = `sha256:${"0".repeat(64)}`;
        return definition;
      },
    });
    expect(() => declared.run()).toThrow(
      "source-assessment-generator:closure-file-declared-digest",
    );
  });

  it("expands a baseline catalog's skill directories and takes the repository-root license", async () => {
    const item = await fixture({
      ...base,
      definition: (source) => ({
        id: source.id,
        owner: source.owner,
        repo: source.repository,
        pinnedSha: source.pinnedCommit,
        components: [
          { id: "runtime:plugin", paths: ["hooks"] },
          { id: "skill:demo", paths: ["skills/demo"], skillContent: true },
        ],
      }),
    });
    const result = item.run();
    expect(result.entries).toBe(1);
    expect(result.excluded).toEqual([
      {
        id: "runtime:plugin",
        kind: "runtime",
        reason:
          "runtime is not a supported Catalog subject kind (ai-coding/supported-catalog-v2.md:59-60; README.md:39-40)",
      },
    ]);
    const closure = read(join(item.outputRoot, "skill.fixture.demo", "artifacts", "closure.json"));
    expect((closure.files as { path: string }[]).map((file) => file.path)).toEqual([
      "LICENSE",
      "skills/demo/SKILL.md",
      "skills/demo/ref.md",
    ]);
  });

  it("renders a row whose license cannot be determined, with a typed gap (G21)", async () => {
    const unrecognized = await fixture({
      ...base,
      files: { ...FILES, LICENSE: "All rights reserved.\n" },
      definition: componentCollection,
    });
    expect(unrecognized.run().entries).toBe(2);
    const dir = join(unrecognized.outputRoot, "skill.fixture.demo");
    const seed = read(join(dir, "seed.json")) as { qualification: { gaps: string[] } };
    expect(seed.qualification.gaps).toContain("evidence/license-gap.json");
    const gap = read(join(dir, "evidence", "license-gap.json"));
    expect(gap).toMatchObject({ id: "license-not-determined", kind: "gap" });
    expect(gap.summary).toContain(
      "License not determined: LICENSE is not recognized as MIT or Apache-2.0",
    );
    expect(read(join(dir, "evidence", "source-right.json")).summary).toMatch(
      /^No applicable license determined/,
    );
  });
});

/**
 * A framework baseline catalog (pinned-baseline/v1) over a tree with the three curated shapes a
 * framework carries besides a one-directory skill (D59): an agent file, MCP components that
 * share explicit declaration files, and a skill with two source roots.
 */
const BASELINE_FILES = {
  LICENSE: MIT,
  "README.md": "# Fixture\n",
  ".mcp.json": '{"mcpServers":{}}\n',
  "mcp-configs/servers.json": '{"mcpServers":{"alpha":{},"beta":{}}}\n',
  "agents/reviewer.md": "# Reviewer\n",
  "agents/planner.md": "# Planner\n",
  "skills/demo/SKILL.md": "# Demo\n",
  "skills/demo/ref.md": "Reference.\n",
  ".agents/skills/demo/SKILL.md": "# Demo copy\n",
  ".agents/skills/demo/openai.yaml": "name: demo\n",
  "hooks/start.js": "export {};\n",
};
const BASELINE_PARTITION: Partition[] = [
  {
    id: "runtime:root-000000000001",
    content: "general",
    paths: [".mcp.json", "LICENSE", "README.md"],
  },
  { id: "runtime:mcp-configs-000000000002", content: "general", paths: ["mcp-configs"] },
  { id: "runtime:agents-000000000003", content: "general", paths: ["agents"] },
  { id: "skill:skills-demo-000000000004", content: "skill", paths: ["skills/demo"] },
  { id: "skill:agents-skills-demo-000000000005", content: "skill", paths: [".agents/skills/demo"] },
  { id: "runtime:hooks-000000000006", content: "general", paths: ["hooks"] },
];
const BASELINE_FINDINGS: FixtureFinding[] = [
  { analyzer: "cisco", ruleId: "SHARED_RULE", path: "mcp-configs/servers.json" },
  { analyzer: "aih-native", ruleId: "AGENT_RULE", path: "agents/reviewer.md" },
  { analyzer: "cisco", ruleId: "COPY_RULE", path: ".agents/skills/demo/SKILL.md" },
];
const DECLARATIONS = [".mcp.json", "mcp-configs/servers.json"];
const BASELINE_COMPONENTS: Json[] = [
  { id: "runtime:plugin", paths: ["hooks"] },
  { id: "agent:reviewer", paths: ["agents/reviewer.md"] },
  { id: "agent:planner", paths: ["agents/planner.md"] },
  { id: "mcp:alpha", paths: DECLARATIONS },
  { id: "mcp:beta", paths: DECLARATIONS },
  { id: "skill:demo", paths: [".agents/skills/demo", "skills/demo"], skillContent: true },
];
const baselineCatalog =
  (components: Json[] = BASELINE_COMPONENTS) =>
  (source: Json): Json => ({
    id: source.id,
    owner: source.owner,
    repo: source.repository,
    pinnedSha: source.pinnedCommit,
    components,
  });
const baselineBase: Omit<Options, "definition"> = {
  files: BASELINE_FILES,
  partition: BASELINE_PARTITION,
  mapped: BASELINE_PARTITION.slice(0, 5).map((component) => component.id),
  findings: BASELINE_FINDINGS,
};

describe("closure-row mode over a framework baseline catalog (D59)", () => {
  const closure = (dir: string) =>
    (read(join(dir, "artifacts", "closure.json")).files as { path: string }[]).map(
      (file) => file.path,
    );
  const subjectPath = (dir: string) =>
    ((read(join(dir, "seed.json")).subject as Json).source as Json).path;
  const report = (dir: string) => read(join(dir, "evidence", "report.json")).summary as string;
  const prose = (dir: string) => readFileSync(join(dir, "artifacts", "prose.md"), "utf8");

  it("renders agent, shared-declaration mcp and two-root skill rows", async () => {
    const item = await fixture({ ...baselineBase, definition: baselineCatalog() });
    const result = item.run();
    expect(result.entries).toBe(5);
    expect(result.excluded).toEqual([
      {
        id: "runtime:plugin",
        kind: "runtime",
        reason:
          "runtime is not a supported Catalog subject kind (ai-coding/supported-catalog-v2.md:59-60; README.md:39-40)",
      },
    ]);
    const row = (entryId: string) => join(item.outputRoot, entryId);

    // agent: the entry is the agent file; the closure is that file plus the root license.
    const reviewer = row("agent.fixture.reviewer");
    expect(closure(reviewer)).toEqual(["LICENSE", "agents/reviewer.md"]);
    expect(subjectPath(reviewer)).toBe("agents/reviewer.md");
    expect(report(reviewer)).toContain("Scanner mapped findings: 1;");
    expect(report(row("agent.fixture.planner"))).toContain("Scanner mapped findings: 0;");

    // mcp: both explicit declaration files are in each closure; the entry is the first one the
    // curated definition lists (the compiler's preferred source path).
    for (const name of ["alpha", "beta"]) {
      const mcp = row(`mcp.fixture.${name}`);
      expect(closure(mcp)).toEqual([".mcp.json", "LICENSE", "mcp-configs/servers.json"]);
      expect(subjectPath(mcp)).toBe(".mcp.json");
      // A finding located in a shared declaration file is stated on every row holding it.
      expect(report(mcp)).toContain("Scanner mapped findings: 1;");
      expect(report(mcp)).toContain(
        "the component artifacts of 2 Scanner components (runtime:mcp-configs-000000000002, runtime:root-000000000001)",
      );
      expect(prose(mcp)).toContain(
        "Shared declaration files, listed by the curated definition for several components: `.mcp.json`, `mcp-configs/servers.json`.",
      );
    }

    // two-root skill: the union of the roots, entered at the canonical root's SKILL.md.
    const skill = row("skill.fixture.demo");
    expect(closure(skill)).toEqual([
      ".agents/skills/demo/SKILL.md",
      ".agents/skills/demo/openai.yaml",
      "LICENSE",
      "skills/demo/SKILL.md",
      "skills/demo/ref.md",
    ]);
    expect(subjectPath(skill)).toBe("skills/demo/SKILL.md");
    expect(report(skill)).toContain("Scanner mapped findings: 1;");
    expect(report(skill)).toContain("each of the 5 closure files matches the pinned checkout");
    expect(prose(skill)).toContain(
      "Curated source roots: `.agents/skills/demo`, `skills/demo`; the entry is the canonical root's `skills/demo/SKILL.md`.",
    );
    expect(read(join(skill, "evidence", "source-right.json")).summary as string).toMatch(
      /^Applicable MIT notice at example\/tools@a{40}:LICENSE, sha256:/,
    );
  });

  it("maps the Scanner components that hold the new shapes' files", async () => {
    const item = await fixture({ ...baselineBase, definition: baselineCatalog() });
    const helper = await mappingHelper();
    const derived = helper.deriveClosureMappingV1(
      read(item.publicationPath),
      read(item.definitionPath),
    );
    expect(derived.rows).toEqual([
      "agent:planner",
      "agent:reviewer",
      "mcp:alpha",
      "mcp:beta",
      "skill:demo",
    ]);
    expect(
      (derived.mapping.components as Json[]).map((component) => component.scannerComponentId),
    ).toEqual(BASELINE_PARTITION.slice(0, 5).map((component) => component.id));
    expect(derived.mapping.exclusions).toEqual([
      {
        reason: "holds no file of a curated Catalog row closure",
        scannerComponentId: "runtime:hooks-000000000006",
      },
    ]);
  });

  it("keeps a shared declaration file bound to exactly one mapped Scanner component", async () => {
    const item = await fixture({
      ...baselineBase,
      mapped: baselineBase.mapped.filter((id) => id !== "runtime:mcp-configs-000000000002"),
      definition: baselineCatalog(),
    });
    expect(() => item.run()).toThrow("source-assessment-generator:closure-file-unmapped");
  });

  it("verifies every root of a two-root skill against the native hashes", async () => {
    const item = await fixture({
      ...baselineBase,
      definition: baselineCatalog(),
      nativeOverride: { ".agents/skills/demo/openai.yaml": "0".repeat(64) },
    });
    expect(() => item.run()).toThrow("source-assessment-generator:closure-file-native-digest");
  });

  it.each([
    [
      "an agent rooted at a directory",
      [{ id: "agent:team", paths: ["agents"] }],
      "definition-component-unrendered agent:team: an agent names exactly one file",
    ],
    [
      "an agent with two paths",
      [{ id: "agent:reviewer", paths: ["agents/planner.md", "agents/reviewer.md"] }],
      "definition-component-unrendered agent:reviewer: an agent names exactly one file",
    ],
    [
      "an mcp declared by a directory",
      [{ id: "mcp:alpha", paths: ["mcp-configs"] }],
      "definition-component-unrendered mcp:alpha: an mcp names only explicit declaration files; mcp-configs is not one file",
    ],
    [
      "a two-root skill without its canonical root",
      [{ id: "skill:demo", paths: [".agents/skills/demo", "hooks"] }],
      "definition-component-unrendered skill:demo: a skill with several roots needs its canonical root skills/demo",
    ],
    [
      "a two-root skill with a root that holds no file",
      [{ id: "skill:demo", paths: [".agents/skills/missing", "skills/demo"] }],
      "definition-component-unrendered skill:demo: root .agents/skills/missing holds no file",
    ],
    [
      "another supported kind",
      [{ id: "tool:demo", paths: ["README.md"] }],
      "definition-component-unrendered tool:demo: a baseline catalog renders only agent, mcp and skill rows",
    ],
    [
      "a file two components reach without listing it",
      [
        { id: "skill:demo", paths: ["skills/demo"] },
        { id: "skill:again", paths: ["skills/demo"] },
      ],
      "definition-shared-file-implicit skills/demo/SKILL.md",
    ],
  ])("refuses %s, stating the shape", async (_label, components, message) => {
    const item = await fixture({ ...baselineBase, definition: baselineCatalog(components) });
    expect(() => item.run()).toThrow(`source-assessment-generator:${message}`);
  });
});

describe("closure mapping derivation", () => {
  it("maps every Scanner component that holds a closure file and excludes the rest", async () => {
    const item = await fixture({ ...base, definition: componentCollection });
    const helper = await mappingHelper();
    const derived = helper.deriveClosureMappingV1(
      read(item.publicationPath),
      read(item.definitionPath),
    );
    expect(derived.mapping).toEqual({
      protocol: "ScannerConsumerMappingV1",
      requestSha256: "b".repeat(64),
      contentClass: "exact compiler/source-file closure for assessment only",
      components: [
        {
          catalogAssetId: "fixture/general:root-000000000001",
          scannerComponentId: PARTITION[0]?.id,
        },
        {
          catalogAssetId: "fixture/skill:skills-demo-000000000002",
          scannerComponentId: PARTITION[1]?.id,
        },
        {
          catalogAssetId: "fixture/general:server-000000000003",
          scannerComponentId: PARTITION[2]?.id,
        },
      ],
      exclusions: [
        {
          reason: "holds no file of a curated Catalog row closure",
          scannerComponentId: PARTITION[3]?.id,
        },
      ],
    });
    expect(derived.rows).toEqual(["mcp:demo", "skill:demo"]);
    expect(derived.excluded).toEqual([
      {
        id: "hook:start",
        kind: "hook",
        reason:
          "hook is not a supported Catalog subject kind (ai-coding/supported-catalog-v2.md:59-60; README.md:39-40)",
      },
    ]);
  });

  it("refuses a closure file that no Scanner component holds", async () => {
    const item = await fixture({
      ...base,
      partition: PARTITION.slice(1),
      mapped: PARTITION.slice(1, 3).map((component) => component.id),
      definition: componentCollection,
    });
    const helper = await mappingHelper();
    expect(() =>
      helper.deriveClosureMappingV1(read(item.publicationPath), read(item.definitionPath)),
    ).toThrow("closure-mapping:closure-file-outside-request LICENSE");
  });
});

describe("license facts in the direct skill mode (G21)", () => {
  const APACHE = "Apache License\nVersion 2.0, January 2004\n";
  const skillOnly = (files: Record<string, string>): Options => ({
    files,
    partition: [{ id: "skill:skills-demo-000000000002", content: "skill", paths: ["skills/demo"] }],
    mapped: ["skill:skills-demo-000000000002"],
    findings: [],
    definition: componentCollection,
  });
  it.each([
    [
      { "skills/demo/SKILL.md": "# Demo\n", "skills/demo/LICENSE": "All rights reserved.\n" },
      "License not determined: skills/demo/LICENSE is not recognized as MIT or Apache-2.0.",
    ],
    [
      { "skills/demo/SKILL.md": "# Demo\n" },
      "License not determined: no license file in the closure.",
    ],
    [
      {
        "skills/demo/SKILL.md": "# Demo\n",
        "skills/demo/LICENSE": MIT,
        "skills/demo/LICENSE.txt": APACHE,
      },
      "License not determined: 2 license files in the closure: skills/demo/LICENSE (MIT), skills/demo/LICENSE.txt (Apache-2.0).",
    ],
  ])("renders the row and surfaces the license facts as a gap", async (files, expected) => {
    const item = await fixture(skillOnly(files));
    expect(item.run(false).entries).toBe(1);
    const dir = join(item.outputRoot, "skill.fixture.skills-demo-000000000002");
    expect((read(join(dir, "seed.json")).qualification as { gaps: string[] }).gaps).toContain(
      "evidence/license-gap.json",
    );
    expect(read(join(dir, "evidence", "license-gap.json")).summary).toContain(expected);
  });
});
