import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// T4 over a publication set (D49): the publications of one request set over one source, each
// verified as a single publication is, rendered once over the union into one provider root.

type Json = Record<string, unknown>;
type Generator = {
  generateSourceAssessmentRowsV1(input: {
    sourceRoot: string;
    handoffPath: string | string[];
    publicationPath: string | string[];
    provider: string;
    outputRoot: string;
    manifestPath: string;
    definitionPath?: string;
  }): { entries: number; seedPaths: string[]; excluded?: Json[] };
  hashComponentTreeV1(sourceRoot: string, paths: string[]): { treeSha256: string };
  hashSourceTreeV1(sourceRoot: string): { treeSha256: string };
};
type MappingHelper = {
  deriveClosureMappingV1(publication: unknown, definition: unknown): { mapping: Json };
  deriveClosureMappingSetV1(
    publications: unknown[],
    definition: unknown,
  ): { mappings: Json[]; rows: string[]; excluded: Json[] };
};

const TOOL = resolve(
  import.meta.dirname,
  "..",
  "..",
  "tools",
  "generate-source-assessment-rows.mjs",
);
async function generator(): Promise<Generator> {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return (await import("../../tools/generate-source-assessment-rows.mjs")) as Generator;
}
async function mappingHelper(): Promise<MappingHelper> {
  // @ts-expect-error The maintenance helper is intentionally plain ESM JavaScript.
  return (await import("../../tools/derive-closure-mapping.mjs")) as MappingHelper;
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
/** One request of the set: its own partition slice, analyzer annexes and source overrides. */
interface Member {
  name: string;
  partition: Partition[];
  cisco?: string;
  source?: Json;
}

const FILES = {
  LICENSE: MIT,
  "README.md": "# Fixture\n",
  "skills/demo/SKILL.md": "# Demo\n",
  "skills/demo/ref.md": "Reference.\n",
  "skills/other/SKILL.md": "# Other\n",
  "server/index.js": "export {};\n",
};
const ROOT: Partition = {
  id: "runtime:root-01",
  content: "general",
  paths: ["LICENSE", "README.md"],
};
const DEMO: Partition = { id: "skill:skills-demo-02", content: "skill", paths: ["skills/demo"] };
const OTHER: Partition = { id: "skill:skills-other-03", content: "skill", paths: ["skills/other"] };
const SERVER: Partition = { id: "runtime:server-04", content: "general", paths: ["server"] };
const FINDINGS: FixtureFinding[] = [
  { analyzer: "cisco", ruleId: "SKILL_RULE", path: "skills/demo/SKILL.md" },
  { analyzer: "aih-native", ruleId: "SERVER_RULE", path: "server/index.js" },
];

const within = (component: Partition, path: string) =>
  component.paths.some((root) => path === root || path.startsWith(`${root}/`));

/**
 * One Scanner request set over a fixture tree (D49): every member is a whole-repository
 * publication with its own request, receipt and signature, and the one execution's annex bytes.
 */
async function publicationSet(members: Member[]) {
  const api = await generator();
  const root = mkdtempSync(join(tmpdir(), "aih-catalog-publication-set-"));
  temporaryRoots.push(root);
  const sourceRoot = join(root, "source");
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(sourceRoot, path)), { recursive: true });
    writeFileSync(join(sourceRoot, path), text);
  }
  const baseSource = {
    id: "fixture",
    owner: "example",
    pinnedCommit: "a".repeat(40),
    repository: "tools",
    treeSha256: api.hashSourceTreeV1(sourceRoot).treeSha256,
  };
  const nativeBytes = Buffer.from(
    canonical({
      files: Object.keys(FILES)
        .sort()
        .map((path) => ({
          bytes: Buffer.byteLength(FILES[path as keyof typeof FILES]),
          path,
          sha256: sha256(FILES[path as keyof typeof FILES]),
        })),
      protocol: "BaselineNativeObservationV1",
      sourceTreeSha256: baseSource.treeSha256,
    }),
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${sha256(publicKeyBytes)}`;
  const signer = {
    class: "test-ephemeral",
    identity: "github-actions:aih-scan-baseline-publication",
    keyId,
  };
  const publisherCommit = "e".repeat(40);
  const built = members.map((member, index) => {
    const source = { ...baseSource, ...member.source };
    const directory = join(root, "publications", member.name);
    mkdirSync(join(directory, "components"), { recursive: true });
    const trees = new Map(
      member.partition.map((component) => [
        component.id,
        api.hashComponentTreeV1(sourceRoot, component.paths).treeSha256,
      ]),
    );
    const ciscoBytes = Buffer.from(member.cisco ?? '{"runs":[]}');
    const requestSha256 = sha256(`request-${index}`);
    const authoring: Json = {
      components: member.partition.map((component) => ({
        content: component.content,
        id: component.id,
        observations: ANALYZERS.map((analyzer) => ({
          analyzer,
          annexSha256: sha256(analyzer === "aih-native" ? nativeBytes : ciscoBytes),
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
    const signedAt = `2026-01-01T00:0${index}:00.000Z`;
    const expiresAt = `2026-01-01T00:4${index}:00.000Z`;
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
      annexes: [
        { bytesBase64: nativeBytes.toString("base64"), path: "annex/aih-native.json" },
        { bytesBase64: ciscoBytes.toString("base64"), path: "annex/cisco.json" },
      ],
      envelope: {
        payload: payload.toString("base64"),
        payloadType,
        signatures: [{ keyid: keyId, sig: sign(null, pae, privateKey).toString("base64") }],
      },
      protocol: "BaselineVetPublicationV1",
      receipt: { ...authoring, receiptSha256 },
      request: {
        components: member.partition.map((component) => ({
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
    const publicationPath = join(directory, "publication.json");
    writeJson(publicationPath, publication);
    const publicationSha256 = sha256(readFileSync(publicationPath));
    const summaryOf = (count: number) => ({ count, byAnalyzer: {}, byLevel: {}, byRule: {} });
    const emptyCoverage = {
      count: 0,
      byAnalyzer: {},
      byLevel: {},
      byMessage: {},
      byReasonCode: {},
    };
    let mappedFindings = 0;
    const handoffComponents = member.partition.map((component) => {
      const suffix = component.id.split(":")[1] as string;
      const catalogAssetId = `${source.id}/${component.content}:${suffix}`;
      const own = FINDINGS.filter((finding) => within(component, finding.path));
      mappedFindings += own.length;
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
        findings: own.map((finding) => ({
          analyzer: finding.analyzer,
          componentIds: [component.id],
          kind: null,
          level: "warning",
          locations: [{ path: finding.path, startColumn: null, startLine: 1 }],
          message: `${finding.ruleId} fixture`,
          ruleId: finding.ruleId,
          runIndex: 0,
          unmapped: false,
        })),
        findingSummary: summaryOf(own.length),
        locationBoundCoverageNotifications: [],
        locationBoundCoverageSummary: emptyCoverage,
        globalCoverageNotifications: [],
        globalCoverageSummary: emptyCoverage,
        coverageComplete: true,
        coverageGaps: [],
        coverageDisposition: "Complete.",
      };
      const artifactPath = join(directory, "components", `${suffix}.json`);
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
          findings: summaryOf(own.length),
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
    const tag = `baseline-v1-${publisherCommit}-${requestSha256}`;
    const handoff = {
      protocol: "ScannerPublicationConsumerHandoffV1",
      authority: "none",
      outcome: "observed",
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
        tag,
        url: `https://github.com/example/scan/releases/tag/${tag}`,
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
        completionEvidenceAbsent: [],
        coverageComplete: true,
      },
      findings: {
        mappedToDeclaredClosures: summaryOf(mappedFindings),
        unmapped: summaryOf(0),
      },
      coverageNotifications: { global: emptyCoverage },
      mapping: {
        sourceId: source.id,
        requestSha256,
        sourceTreeSha256: source.treeSha256,
        contentClass: "exact compiler/source-file closure for assessment only",
        runtimeCapabilityClaim: [],
        exclusions: [],
        components: handoffComponents.map((item) => item.mapping),
      },
      components: handoffComponents.map((item) => item.summary),
      rawReports: [],
      localInspection: {},
    };
    const handoffPath = join(directory, "consumer-handoff.json");
    writeJson(handoffPath, handoff);
    return { handoffPath, publicationPath, publicationSha256 };
  });
  const definitionPath = join(root, "definition.json");
  writeJson(definitionPath, componentCollection(baseSource));
  const manifestPath = join(root, "defaults", "default-catalog-seed-manifest-v2.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeJson(manifestPath, {
    format: "aih-supported-candidate-seed-manifest",
    seeds: ["default-catalog-v2.json"],
    version: 1,
  });
  const outputRoot = join(root, "defaults", "workbench", "fixture");
  const input = (definition = true) => ({
    sourceRoot,
    handoffPath: built.map((item) => item.handoffPath),
    publicationPath: built.map((item) => item.publicationPath),
    provider: "fixture",
    outputRoot,
    manifestPath,
    ...(definition ? { definitionPath } : {}),
  });
  const run = (definition = true) => api.generateSourceAssessmentRowsV1(input(definition));
  return { built, definitionPath, input, manifestPath, outputRoot, run };
}

/** The Catalog's pinned component collection declaration for the fixture tree. */
function componentCollection(source: Json): Json {
  return {
    version: "pinned-component-collection/v1",
    source: {
      id: source.id,
      repository: `https://github.com/${source.owner}/${source.repository}`,
      commit: source.pinnedCommit,
      version: "1.0.0",
      licenseFileRef: "LICENSE",
    },
    files: Object.entries(FILES).map(([path, text]) => ({
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
    ],
    profile: {},
    template: {},
  };
}

const SET: Member[] = [
  { name: "one", partition: [ROOT, DEMO] },
  { name: "two", partition: [OTHER, SERVER] },
];
const evidenceOf = (outputRoot: string, row: string) => join(outputRoot, row, "evidence");
const summaryOf = (path: string) => read(path).summary as string;
const listFiles = (directory: string): string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();

describe("source-assessment rows over a publication set", () => {
  it("renders the curated rows once over the union, citing each row's own publications", async () => {
    const set = await publicationSet(SET);
    const result = set.run();
    expect(result.entries).toBe(2);
    const [one, two] = set.built;
    if (one === undefined || two === undefined) throw new Error("no set");
    // skill:demo lies wholly in publication one; mcp:demo spans both.
    const skill = evidenceOf(set.outputRoot, "skill.fixture.demo");
    expect(existsSync(join(skill, "publication-2.json"))).toBe(false);
    expect(summaryOf(join(skill, "publication-1.json"))).toContain(
      `publication SHA256 ${one.publicationSha256}`,
    );
    expect(summaryOf(join(skill, "report.json"))).toContain(
      `Publication sha256:${one.publicationSha256}.`,
    );
    const mcp = evidenceOf(set.outputRoot, "mcp.fixture.demo");
    const cited = [one.publicationSha256, two.publicationSha256].sort();
    expect(summaryOf(join(mcp, "publication-1.json"))).toContain(`publication SHA256 ${cited[0]}`);
    expect(summaryOf(join(mcp, "publication-2.json"))).toContain(`publication SHA256 ${cited[1]}`);
    const report = summaryOf(join(mcp, "report.json"));
    expect(report).toContain("Scanner mapped findings: 2;");
    expect(report).toContain(`Publications sha256:${cited[0]}, sha256:${cited[1]}.`);
    expect(report).toContain("2 protected Scanner publications of one request set");
    const seed = read(join(set.outputRoot, "mcp.fixture.demo", "seed.json")) as {
      qualification: { gaps: string[] };
    };
    expect(seed.qualification.gaps).toEqual([
      "evidence/coverage-gap.json",
      "evidence/publication-1.json",
      "evidence/publication-2.json",
      "evidence/scope-gap.json",
    ]);
    const manifest = read(set.manifestPath) as { seeds: string[] };
    expect(manifest.seeds).toEqual([
      "default-catalog-v2.json",
      "workbench/fixture/mcp.fixture.demo/seed.json",
      "workbench/fixture/skill.fixture.demo/seed.json",
    ]);
  });

  it("renders the direct skill rows of every member in the skill mode", async () => {
    const set = await publicationSet([
      { name: "one", partition: [DEMO] },
      { name: "two", partition: [OTHER] },
    ]);
    const result = set.run(false);
    expect(result.seedPaths).toEqual([
      "workbench/fixture/skill.fixture.skills-demo-02/seed.json",
      "workbench/fixture/skill.fixture.skills-other-03/seed.json",
    ]);
  });

  it("is the single-publication rendering when the set has one member", async () => {
    const set = await publicationSet([{ name: "one", partition: [ROOT, DEMO, OTHER, SERVER] }]);
    const api = await generator();
    const input = set.input();
    const single = api.generateSourceAssessmentRowsV1({
      ...input,
      handoffPath: input.handoffPath[0] as string,
      publicationPath: input.publicationPath[0] as string,
    });
    const report = summaryOf(join(evidenceOf(set.outputRoot, "mcp.fixture.demo"), "report.json"));
    expect(report).toContain("Protected Scanner publication, its receipt and native annex");
    const snapshot = () =>
      Object.fromEntries(
        [...listFiles(set.outputRoot), set.manifestPath].map((path) => [
          path,
          readFileSync(path, "utf8"),
        ]),
      );
    const alone = snapshot();
    rmSync(set.outputRoot, { recursive: true });
    writeJson(set.manifestPath, {
      format: "aih-supported-candidate-seed-manifest",
      seeds: ["default-catalog-v2.json"],
      version: 1,
    });
    expect(set.run()).toEqual(single);
    expect(snapshot()).toEqual(alone);
  });

  it.each([
    [
      "members of another source",
      [SET[0] as Member, { ...(SET[1] as Member), source: { id: "other" } }],
      "publication-set-source",
    ],
    [
      "members at another pin",
      [SET[0] as Member, { ...(SET[1] as Member), source: { pinnedCommit: "c".repeat(40) } }],
      "publication-set-pin",
    ],
    [
      "members whose annex bytes differ",
      [SET[0] as Member, { ...(SET[1] as Member), cisco: '{"runs":[1]}' }],
      "publication-set-annex-bytes",
    ],
    [
      "members that own the same component files",
      [
        SET[0] as Member,
        {
          name: "two",
          partition: [SERVER, { ...DEMO, id: "skill:skills-02b", paths: ["skills"] }],
        },
      ],
      "publication-set-component-overlap",
    ],
  ])("refuses %s", async (_label, members, code) => {
    const set = await publicationSet(members);
    expect(() => set.run()).toThrow(`source-assessment-generator:${code}`);
    expect(existsSync(set.outputRoot)).toBe(false);
  });

  it("refuses the same publication twice and unpaired paths", async () => {
    const set = await publicationSet(SET);
    const api = await generator();
    const input = set.input();
    expect(() =>
      api.generateSourceAssessmentRowsV1({
        ...input,
        handoffPath: [input.handoffPath[0] as string, input.handoffPath[0] as string],
        publicationPath: [input.publicationPath[0] as string, input.publicationPath[0] as string],
      }),
    ).toThrow("source-assessment-generator:publication-set-duplicate");
    expect(() =>
      api.generateSourceAssessmentRowsV1({
        ...input,
        publicationPath: [input.publicationPath[0] as string],
      }),
    ).toThrow("source-assessment-generator:publication-set-pairs");
    expect(() =>
      api.generateSourceAssessmentRowsV1({
        ...input,
        publicationPath: [...input.publicationPath].reverse(),
      }),
    ).toThrow("source-assessment-generator:publication-handoff-directory");
  });

  it("takes the set on the command line as repeated --handoff/--publication pairs", async () => {
    const set = await publicationSet(SET);
    const input = set.input();
    const args = [
      TOOL,
      "--source-root",
      input.sourceRoot,
      ...input.handoffPath.flatMap((path, index) => [
        "--handoff",
        path,
        "--publication",
        input.publicationPath[index] as string,
      ]),
      "--provider",
      "fixture",
      "--output-root",
      input.outputRoot,
      "--manifest",
      input.manifestPath,
      "--definition",
      set.definitionPath,
    ];
    const ran = spawnSync(process.execPath, args, { encoding: "utf8" });
    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(JSON.parse(ran.stdout).entries).toBe(2);
    const unpaired = spawnSync(
      process.execPath,
      [
        ...args.slice(0, -2),
        "--handoff",
        input.handoffPath[0] as string,
        "--definition",
        set.definitionPath,
      ],
      {
        encoding: "utf8",
      },
    );
    expect(unpaired.status).toBe(1);
    expect(unpaired.stderr).toContain("source-assessment-generator:arguments");
  });
});

describe("closure mapping derivation over a publication set", () => {
  it("maps each member's components against the union and refuses a file outside every request", async () => {
    const set = await publicationSet(SET);
    const helper = await mappingHelper();
    const publications = set.built.map((item) => read(item.publicationPath));
    const definition = read(set.definitionPath);
    // One member alone does not hold the whole curated closure.
    expect(() => helper.deriveClosureMappingV1(publications[0], definition)).toThrow(
      "closure-mapping:closure-file-outside-request server/index.js",
    );
    const derived = helper.deriveClosureMappingSetV1(publications, definition);
    expect(derived.rows).toEqual(["mcp:demo", "skill:demo"]);
    expect(
      derived.mappings.map((mapping) => ({
        components: (mapping.components as Json[]).map((component) => component.scannerComponentId),
        exclusions: (mapping.exclusions as Json[]).map((component) => component.scannerComponentId),
      })),
    ).toEqual([
      { components: [ROOT.id, DEMO.id], exclusions: [] },
      { components: [SERVER.id], exclusions: [OTHER.id] },
    ]);
    const partial = await publicationSet([
      { name: "one", partition: [ROOT, DEMO] },
      { name: "two", partition: [OTHER] },
    ]);
    expect(() =>
      helper.deriveClosureMappingSetV1(
        partial.built.map((item) => read(item.publicationPath)),
        read(partial.definitionPath),
      ),
    ).toThrow("closure-mapping:closure-file-outside-request server/index.js");
  });

  it("writes one mapping per --publication/--output pair on the command line", async () => {
    const set = await publicationSet(SET);
    const outputs = set.built.map((item) => join(dirname(item.publicationPath), "mapping.json"));
    const ran = spawnSync(
      process.execPath,
      [
        resolve(dirname(TOOL), "derive-closure-mapping.mjs"),
        ...set.built.flatMap((item, index) => [
          "--publication",
          item.publicationPath,
          "--output",
          outputs[index] as string,
        ]),
        "--definition",
        set.definitionPath,
      ],
      { encoding: "utf8" },
    );
    expect(ran.stderr).toBe("");
    expect(JSON.parse(ran.stdout).members).toEqual([
      { mapped: 2, excludedScannerComponents: 0 },
      { mapped: 1, excludedScannerComponents: 1 },
    ]);
    expect(outputs.map((path) => read(path).requestSha256)).toEqual(
      set.built.map((item) => (read(item.publicationPath).request as Json).requestSha256),
    );
  });

  it("refuses a set that is not one request set over one source", async () => {
    const helper = await mappingHelper();
    const set = await publicationSet([SET[0] as Member, { ...(SET[1] as Member), cisco: "{}" }]);
    expect(() =>
      helper.deriveClosureMappingSetV1(
        set.built.map((item) => read(item.publicationPath)),
        read(set.definitionPath),
      ),
    ).toThrow("source-assessment-generator:publication-set-annex-bytes");
  });
});
