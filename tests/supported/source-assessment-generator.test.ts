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
import {
  attestationBundle,
  catalogIndex,
  rewriteArtifact,
  rewriteHandoff,
  writeJson,
  writeScannerPublication,
} from "./scanner-publication-fixture.js";

type Generator = {
  generateSourceAssessmentRowsV1(input: {
    sourceRoot: string;
    handoffPath: string;
    publicationPath: string;
    attestationPath: string;
    provider: string;
    outputRoot: string;
    manifestPath: string;
    catalogIndexPath?: string;
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

type Json = Record<string, unknown>;
const temporaryRoots: string[] = [];
const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

const SCANNER_ID = "skill:skills-demo-0123456789ab";
const FILES = {
  "skills/demo/LICENSE.txt": "MIT License\n\nPermission is hereby granted.\n",
  "skills/demo/SKILL.md": "# Demo\n\nReview this source.\n",
};

/**
 * One skill publication. By default it carries one cisco finding in SKILL.md and one global
 * skillspector notification, and its SARIF analyzers carry no completion evidence, so it is
 * observed with gaps; `gapFree` requests only the aih-native analyzer and observes nothing else.
 */
async function fixture({ gapFree = false } = {}) {
  const api = await generator();
  const root = mkdtempSync(join(tmpdir(), "aih-catalog-source-generator-"));
  temporaryRoots.push(root);
  const sourceRoot = join(root, "source");
  const skillRoot = join(sourceRoot, "skills", "demo");
  for (const [path, contents] of Object.entries(FILES)) {
    mkdirSync(dirname(join(sourceRoot, path)), { recursive: true });
    writeFileSync(join(sourceRoot, path), contents);
  }
  const source = {
    id: "fixture-skills",
    owner: "example",
    pinnedCommit: "a".repeat(40),
    repository: "skills",
    treeSha256: api.hashSourceTreeV1(sourceRoot).treeSha256,
  };
  const written = await writeScannerPublication({
    directory: join(root, "publication"),
    source,
    files: FILES,
    components: [{ id: SCANNER_ID, content: "skill", paths: ["skills/demo"] }],
    analyzers: gapFree ? ["aih-native"] : ["aih-native", "skillspector", "semgrep", "cisco"],
    treeOf: (paths) => api.hashComponentTreeV1(sourceRoot, paths).treeSha256,
    observations: gapFree
      ? []
      : [
          { analyzer: "cisco", ruleId: "FIXTURE_RULE", path: "skills/demo/SKILL.md" },
          { analyzer: "skillspector", notification: true, message: "Fixture analyzer limitation." },
        ],
    mapped: [SCANNER_ID],
    contentClass: "exact direct plugin skill/source files for assessment only",
    catalogAssetIds: { [SCANNER_ID]: "fixture-skills/skill:demo" },
  });
  const manifestPath = join(root, "defaults", "default-catalog-seed-manifest-v2.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeJson(manifestPath, {
    format: "aih-supported-candidate-seed-manifest",
    seeds: ["default-catalog-v2.json"],
    version: 1,
  });
  const outputRoot = join(root, "defaults", "workbench", "fixture");
  // The Catalog's curated inventory of this provider at this source: the direct skill row's
  // selection authority (defaults/catalog-index-v1.json in the whole Catalog).
  const catalogIndexPath = join(root, "defaults", "catalog-index-v1.json");
  writeJson(
    catalogIndexPath,
    catalogIndex("fixture", source, [
      { kind: "skill", name: "demo", entryPath: "skills/demo/SKILL.md" },
    ]),
  );
  const input = () => ({
    sourceRoot,
    handoffPath: written.handoffPath,
    publicationPath: written.publicationPath,
    attestationPath: written.attestationPath,
    provider: "fixture",
    outputRoot,
    manifestPath,
    catalogIndexPath,
  });
  return {
    api,
    root,
    sourceRoot,
    skillRoot,
    source,
    written,
    manifestPath,
    catalogIndexPath,
    outputRoot,
    input,
  };
}
type Item = Awaited<ReturnType<typeof fixture>>;
const generate = (item: Item) => item.api.generateSourceAssessmentRowsV1(item.input());

async function linkedParentSourceFixture() {
  const item = await fixture();
  const externalBase = join(item.root, "external-source-base");
  mkdirSync(externalBase);
  renameSync(item.sourceRoot, join(externalBase, "source"));
  const linkedParent = join(item.root, "linked-source-parent");
  symlinkSync(externalBase, linkedParent, directoryLinkType);
  return { api: item.api, sourceRoot: join(linkedParent, "source") };
}

// A superpowers-style direct skill handoff: two curated skills of one provider at one source, one
// of them carrying the review's 13 cisco findings.
const ALPHA_ID = "skill:skills-alpha-111111111111";
const BETA_ID = "skill:skills-beta-222222222222";
const TWO_FILES = {
  "skills/alpha/SKILL.md": "# Alpha\n\nReview this source.\n",
  "skills/alpha/notes.md": "Alpha notes.\n",
  "skills/beta/SKILL.md": "# Beta\n\nReview this source.\n",
};
const TWO_OBSERVATIONS = [
  ...Array.from({ length: 13 }, (_, index) => ({
    analyzer: "cisco",
    ruleId: `ALPHA_RULE_${index}`,
    path: "skills/alpha/SKILL.md",
  })),
  { analyzer: "cisco", ruleId: "BETA_RULE", path: "skills/beta/SKILL.md" },
];
const TWO_SUBJECTS = [
  { kind: "skill", name: "alpha", entryPath: "skills/alpha/SKILL.md" },
  { kind: "skill", name: "beta", entryPath: "skills/beta/SKILL.md" },
];

/** Two curated skills, mapped in the direct skill class, with the Catalog's curated inventory. */
async function twoSkillFixture() {
  const api = await generator();
  const root = mkdtempSync(join(tmpdir(), "aih-catalog-source-generator-two-"));
  temporaryRoots.push(root);
  const sourceRoot = join(root, "source");
  for (const [path, contents] of Object.entries(TWO_FILES)) {
    mkdirSync(dirname(join(sourceRoot, path)), { recursive: true });
    writeFileSync(join(sourceRoot, path), contents);
  }
  const source = {
    id: "fixture-skills-two",
    owner: "example",
    repository: "skills",
    pinnedCommit: "a".repeat(40),
    treeSha256: api.hashSourceTreeV1(sourceRoot).treeSha256,
  };
  const written = await writeScannerPublication({
    directory: join(root, "publication"),
    source,
    files: TWO_FILES,
    components: [
      { id: ALPHA_ID, content: "skill", paths: ["skills/alpha"] },
      { id: BETA_ID, content: "skill", paths: ["skills/beta"] },
    ],
    analyzers: ["aih-native", "cisco"],
    treeOf: (paths) => api.hashComponentTreeV1(sourceRoot, paths).treeSha256,
    observations: TWO_OBSERVATIONS,
    mapped: [ALPHA_ID, BETA_ID],
    contentClass: "exact direct plugin skill/source files for assessment only",
    catalogAssetIds: {
      [ALPHA_ID]: "fixture-skills-two/skill:alpha",
      [BETA_ID]: "fixture-skills-two/skill:beta",
    },
  });
  const manifestPath = join(root, "defaults", "default-catalog-seed-manifest-v2.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeJson(manifestPath, {
    format: "aih-supported-candidate-seed-manifest",
    seeds: ["default-catalog-v2.json"],
    version: 1,
  });
  const catalogIndexPath = join(root, "defaults", "catalog-index-v1.json");
  writeJson(catalogIndexPath, catalogIndex("fixture", source, TWO_SUBJECTS));
  const outputRoot = join(root, "defaults", "workbench", "fixture");
  const input = () => ({
    sourceRoot,
    handoffPath: written.handoffPath,
    publicationPath: written.publicationPath,
    attestationPath: written.attestationPath,
    provider: "fixture",
    outputRoot,
    manifestPath,
    catalogIndexPath,
  });
  return { api, root, source, written, manifestPath, catalogIndexPath, outputRoot, input };
}
type TwoSkillItem = Awaited<ReturnType<typeof twoSkillFixture>>;
const generateTwo = (item: TwoSkillItem) => item.api.generateSourceAssessmentRowsV1(item.input());

/**
 * The reviewer's tamper (ds-CF1 item 1, P2): one curated skill leaves the unsigned handoff's own
 * mapping for its exclusions, its component summary and artifact are deleted, and everything the
 * handoff derives from the remaining set is re-derived: the aggregate mapped-finding summary and
 * the artifact pointers of the surviving component.
 */
function dropCuratedSkill(written: TwoSkillItem["written"], scannerComponentId: string) {
  rmSync(written.artifactPaths.get(scannerComponentId) as string);
  rewriteHandoff(written, (handoff) => {
    const mapping = handoff.mapping as Json;
    mapping.components = (mapping.components as Json[]).filter(
      (entry) => entry.scannerComponentId !== scannerComponentId,
    );
    (mapping.exclusions as Json[]).push({
      reason: "holds no direct skill row",
      scannerComponentId,
    });
    handoff.components = (handoff.components as Json[]).filter(
      (entry) => entry.scannerComponentId !== scannerComponentId,
    );
  });
  const surviving = [...written.artifactPaths.keys()].find((id) => id !== scannerComponentId);
  // A no-op artifact rewrite re-derives the aggregate mapped-finding summary of the new set.
  rewriteArtifact(written, surviving as string, () => {});
}

/** Rebinds one mapped component to another id in its mapping, its summary and its artifact. */
function rebindCuratedSkill(
  written: TwoSkillItem["written"],
  scannerComponentId: string,
  catalogAssetId: string,
) {
  rewriteArtifact(written, scannerComponentId, (artifact) => {
    artifact.catalogAssetId = catalogAssetId;
  });
  rewriteHandoff(written, (handoff) => {
    const mapping = handoff.mapping as Json;
    const entry = (mapping.components as Json[]).find(
      (item) => item.scannerComponentId === scannerComponentId,
    ) as Json;
    entry.catalogAssetId = catalogAssetId;
    const summary = (handoff.components as Json[]).find(
      (item) => item.scannerComponentId === scannerComponentId,
    ) as Json;
    summary.catalogAssetId = catalogAssetId;
  });
}

describe("direct skill rows take their selection from the Catalog's curated inventory", () => {
  it("keeps the Scan-produced handoff bytes unchanged while rendering rows", async () => {
    const item = await fixture();
    const handoffBefore = readFileSync(item.written.handoffPath);
    expect(generate(item).entries).toBe(1);
    expect(readFileSync(item.written.handoffPath).equals(handoffBefore)).toBe(true);
  });

  it("renders one row per curated skill when the mapping is the curated selection", async () => {
    const item = await twoSkillFixture();
    expect(generateTwo(item)).toEqual({
      entries: 2,
      seedPaths: [
        "workbench/fixture/skill.fixture.alpha/seed.json",
        "workbench/fixture/skill.fixture.beta/seed.json",
      ],
    });
    expect(JSON.parse(readFileSync(item.manifestPath, "utf8")).seeds).toEqual([
      "default-catalog-v2.json",
      "workbench/fixture/skill.fixture.alpha/seed.json",
      "workbench/fixture/skill.fixture.beta/seed.json",
    ]);
  });

  it("refuses a curated skill dropped from the handoff mapping, with or without the inventory", async () => {
    // The review's scenario, on real bytes: the publication is untouched; the unsigned handoff
    // drops one curated skill with its 13 cisco findings and re-derives everything it derives.
    const item = await twoSkillFixture();
    dropCuratedSkill(item.written, ALPHA_ID);
    const handoff = JSON.parse(readFileSync(item.written.handoffPath, "utf8")) as Json;
    const components = (handoff.components as Json[]).map((entry) => entry.scannerComponentId);
    expect(components).toEqual([BETA_ID]);
    expect((handoff.findings as Json).mappedToDeclaredClosures).toMatchObject({ count: 1 });
    expect((handoff.mapping as Json).components).toHaveLength(1);
    // No Catalog-authored selection is named: the handoff's own mapping is not an authority.
    const { catalogIndexPath: _unused, ...uncurated } = item.input();
    expect(() => item.api.generateSourceAssessmentRowsV1(uncurated)).toThrow(
      /source-assessment-generator:direct-skill-selection-unauthored/,
    );
    expect(existsSync(item.outputRoot)).toBe(false);
    // With the Catalog's curated inventory the dropped subject is named and refused.
    expect(() => generateTwo(item)).toThrow(
      /source-assessment-generator:mapping-selection-unmapped skill\.fixture\.alpha/,
    );
    expect(existsSync(item.outputRoot)).toBe(false);
    expect(JSON.parse(readFileSync(item.manifestPath, "utf8")).seeds).toEqual([
      "default-catalog-v2.json",
    ]);
  });

  it("refuses a curated skill rebound to an id that names no curated subject", async () => {
    // The reviewer's rebinding: one component's catalogAssetId renamed to another id with the
    // same prefix. A free id is an identity for the handoff's own comparisons; the inventory
    // names the id that must have been a curated subject.
    const unknown = await twoSkillFixture();
    rebindCuratedSkill(unknown.written, BETA_ID, "fixture-skills-two/skill:gamma");
    expect(() => generateTwo(unknown)).toThrow(
      /source-assessment-generator:mapping-selection-uncatalogued fixture-skills-two\/skill:gamma/,
    );
    expect(existsSync(unknown.outputRoot)).toBe(false);
    expect(JSON.parse(readFileSync(unknown.manifestPath, "utf8")).seeds).toEqual([
      "default-catalog-v2.json",
    ]);
  });

  it("refuses two curated skills whose subjects are swapped between their components", async () => {
    // A rebinding that keeps every subject covered but states another subject's id over each
    // component's observations: only the curated entry of each subject catches it.
    const swapped = await twoSkillFixture();
    rebindCuratedSkill(swapped.written, ALPHA_ID, "fixture-skills-two/skill:beta");
    rebindCuratedSkill(swapped.written, BETA_ID, "fixture-skills-two/skill:alpha");
    expect(() => generateTwo(swapped)).toThrow(
      /source-assessment-generator:mapping-selection-unbound skill:skills-alpha-111111111111 skills\/beta\/SKILL\.md/,
    );
    expect(existsSync(swapped.outputRoot)).toBe(false);
  });

  it("refuses a rebinding onto another mapped subject before the inventory is consulted", async () => {
    // The mapping's own asset ids must stay distinct; the reproduction refuses that already.
    const duplicate = await twoSkillFixture();
    rebindCuratedSkill(duplicate.written, BETA_ID, "fixture-skills-two/skill:alpha");
    expect(() => generateTwo(duplicate)).toThrow(
      /source-assessment-generator:mapping-catalog-asset-id fixture-skills-two\/skill:alpha/,
    );
    expect(existsSync(duplicate.outputRoot)).toBe(false);
  });

  it("refuses a curated inventory of this provider at another pin", async () => {
    const other = await twoSkillFixture();
    writeJson(
      other.catalogIndexPath,
      catalogIndex("fixture", { ...other.source, pinnedCommit: "b".repeat(40) }, TWO_SUBJECTS),
    );
    expect(() => generateTwo(other)).toThrow(
      /source-assessment-generator:mapping-selection-pin skill\.fixture\.alpha/,
    );
    expect(existsSync(other.outputRoot)).toBe(false);
  });

  it("refuses a direct skill run over a provider that carries another curated kind", async () => {
    // A component provider (skills and an mcp row): the render replaces every row of the
    // provider, so the inventory authority refuses rather than dropping the other kind.
    const mixed = await twoSkillFixture();
    writeJson(
      mixed.catalogIndexPath,
      catalogIndex("fixture", mixed.source, [
        ...TWO_SUBJECTS,
        { kind: "mcp", name: "alpha-server", entryPath: "skills/alpha/SKILL.md" },
      ]),
    );
    expect(() => generateTwo(mixed)).toThrow(
      /source-assessment-generator:mapping-selection-kind mcp\.fixture\.alpha-server/,
    );
    expect(existsSync(mixed.outputRoot)).toBe(false);
  });

  it.each([
    ["not a catalog index", { entries: [], format: "other", version: 1 }],
    ["another index version", { entries: [], format: "aih-catalog-index", version: 2 }],
    [
      "an entry whose seed path contradicts its entry id",
      {
        entries: [
          {
            entryId: "skill.fixture.alpha",
            seed: {
              path: "defaults/workbench/fixture/skill.fixture.beta/seed.json",
              sha256: "0".repeat(64),
            },
            subject: {
              id: "alpha",
              kind: "skill",
              source: {
                commit: "a".repeat(40),
                path: "skills/alpha/SKILL.md",
                repository: "example/skills",
              },
            },
          },
        ],
        format: "aih-catalog-index",
        version: 1,
      },
    ],
    [
      "an entry whose subject source is unreadable",
      {
        entries: [
          {
            entryId: "skill.fixture.alpha",
            seed: {
              path: "defaults/workbench/fixture/skill.fixture.alpha/seed.json",
              sha256: "0".repeat(64),
            },
            subject: { id: "alpha", kind: "skill", source: { commit: "a".repeat(40) } },
          },
        ],
        format: "aih-catalog-index",
        version: 1,
      },
    ],
  ])("refuses %s", async (_label, malformed) => {
    const item = await twoSkillFixture();
    writeJson(item.catalogIndexPath, malformed);
    expect(() => generateTwo(item)).toThrow(/source-assessment-generator:catalog-index-/);
    expect(existsSync(item.outputRoot)).toBe(false);
  });

  it("ignores a curated row that belongs to no provider", async () => {
    // The real index also carries the collection's own row (defaults/default-catalog-v2.json);
    // it is no provider's curated row, so no curated subject of this provider is found at all.
    const item = await twoSkillFixture();
    writeJson(item.catalogIndexPath, {
      entries: [
        {
          entryId: "recipe.default",
          seed: { path: "defaults/default-catalog-v2.json", sha256: "0".repeat(64) },
          subject: { id: "default", kind: "profile" },
        },
      ],
      format: "aih-catalog-index",
      version: 1,
    });
    expect(() => generateTwo(item)).toThrow(
      /source-assessment-generator:mapping-selection-uncatalogued fixture-skills-two\/skill:alpha/,
    );
    expect(existsSync(item.outputRoot)).toBe(false);
  });
});

describe("source assessment row generator", () => {
  it("binds exact protected observations into review-only rows and updates the seed manifest", async () => {
    const item = await fixture();
    expect(generate(item)).toEqual({
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
        findings: ["evidence/findings-1.json"],
        gaps: [
          "evidence/coverage-gap.json",
          "evidence/publication-1.json",
          "evidence/scope-gap.json",
        ],
      },
    });
    const report = JSON.parse(
      readFileSync(join(item.outputRoot, "skill.fixture.demo", "evidence", "report.json"), "utf8"),
    ).summary as string;
    expect(report).toContain("Scanner mapped findings: 1;");
    expect(report).toContain("Unresolved coverage notifications: 0 location-bound and 1 global.");
    expect(JSON.parse(readFileSync(item.manifestPath, "utf8")).seeds).toEqual([
      "default-catalog-v2.json",
      "workbench/fixture/skill.fixture.demo/seed.json",
    ]);
  });

  it("accepts both truthful outcomes: observed without gaps, observed_with_gaps with them", async () => {
    const clean = await fixture({ gapFree: true });
    expect(clean.written.handoff.outcome).toBe("observed");
    expect(generate(clean).entries).toBe(1);
    const gapped = await fixture();
    expect(gapped.written.handoff.outcome).toBe("observed_with_gaps");
    expect(generate(gapped).entries).toBe(1);
  });

  it("rejects an outcome that misstates the gaps", async () => {
    const claimedClean = await fixture();
    rewriteHandoff(claimedClean.written, (handoff) =>
      Object.assign(handoff, { outcome: "observed" }),
    );
    expect(() => generate(claimedClean)).toThrow("source-assessment-generator:handoff-outcome");
    const claimedGaps = await fixture({ gapFree: true });
    rewriteHandoff(claimedGaps.written, (handoff) =>
      Object.assign(handoff, { outcome: "observed_with_gaps" }),
    );
    expect(() => generate(claimedGaps)).toThrow("source-assessment-generator:handoff-outcome");
    const unmapped = await fixture({ gapFree: true });
    rewriteHandoff(unmapped.written, (handoff) => {
      (handoff.findings as Json).unmapped = { count: 1, byAnalyzer: {}, byLevel: {}, byRule: {} };
    });
    expect(() => generate(unmapped)).toThrow("source-assessment-generator:handoff-outcome");
    for (const outcome of ["clean", "observed_without_gaps"]) {
      const other = await fixture();
      rewriteHandoff(other.written, (handoff) => Object.assign(handoff, { outcome }));
      expect(() => generate(other)).toThrow("source-assessment-generator:handoff-authority");
    }
  });

  it("refuses a component artifact whose coverage differs from the publication, even re-bound", async () => {
    // Complete coverage claimed while the SARIF analyzers carry no completion evidence.
    const claimed = await fixture();
    rewriteArtifact(claimed.written, SCANNER_ID, (artifact) => {
      Object.assign(artifact, {
        globalCoverageNotifications: [],
        globalCoverageSummary: {
          count: 0,
          byAnalyzer: {},
          byLevel: {},
          byMessage: {},
          byReasonCode: {},
        },
        coverageGaps: [],
        coverageComplete: true,
      });
    });
    expect(() => generate(claimed)).toThrow(
      /source-assessment-generator:handoff-not-reproduced components\/skill-skills-demo-0123456789ab\.json/,
    );
    for (const coverageGaps of [
      [{ analyzer: "semgrep", reason: "silent" }],
      [{ analyzer: "trivy", reason: "completion-evidence-absent" }],
      [{ analyzer: "semgrep", reason: "completion-evidence-absent", note: "x" }],
    ]) {
      const item = await fixture();
      rewriteArtifact(item.written, SCANNER_ID, (artifact) =>
        Object.assign(artifact, { coverageGaps }),
      );
      expect(() => generate(item)).toThrow(/source-assessment-generator:handoff-not-reproduced/);
    }
    // Publication-level coverage cannot be complete while completion evidence is absent.
    const summary = await fixture({ gapFree: true });
    rewriteHandoff(summary.written, (handoff) => {
      (handoff.analyzerGaps as Json).completionEvidenceAbsent = ["semgrep"];
    });
    expect(() => generate(summary)).toThrow("source-assessment-generator:analyzer-coverage-claim");
    const noList = await fixture();
    rewriteHandoff(noList.written, (handoff) => {
      delete (handoff.analyzerGaps as Json).completionEvidenceAbsent;
    });
    expect(() => generate(noList)).toThrow("source-assessment-generator:analyzer-gaps-fields");
  });

  it("refuses a handoff with a finding removed and its summaries, digest, length and count re-derived", async () => {
    // The review's scenario (astra-STEP8 P2): the publication is unchanged; only the unsigned
    // handoff drops a finding and recomputes everything it derives from it.
    const item = await fixture();
    rewriteArtifact(item.written, SCANNER_ID, (artifact) => {
      artifact.findings = [];
      artifact.findingSummary = { count: 0, byAnalyzer: {}, byLevel: {}, byRule: {} };
    });
    const handoff = JSON.parse(readFileSync(item.written.handoffPath, "utf8")) as Json;
    expect((handoff.findings as Json).mappedToDeclaredClosures).toMatchObject({ count: 0 });
    expect(() => generate(item)).toThrow(
      /source-assessment-generator:handoff-not-reproduced components\/skill-skills-demo-0123456789ab\.json/,
    );
    expect(existsSync(item.outputRoot)).toBe(false);
    // Changing only the aggregate summaries is refused by the same comparison.
    for (const key of ["repository", "unmapped"]) {
      const other = await fixture();
      rewriteHandoff(other.written, (value) => {
        (value.findings as Json)[key] = { count: 2, byAnalyzer: {}, byLevel: {}, byRule: {} };
      });
      expect(() => generate(other)).toThrow(
        /source-assessment-generator:handoff-not-reproduced findings/,
      );
    }
    const notices = await fixture();
    rewriteHandoff(notices.written, (value) => {
      (value.coverageNotifications as Json).global = {
        count: 0,
        byAnalyzer: {},
        byLevel: {},
        byMessage: {},
        byReasonCode: {},
      };
    });
    expect(() => generate(notices)).toThrow(
      /source-assessment-generator:handoff-not-reproduced coverageNotifications/,
    );
  });

  it("refuses annex bytes the signed receipt does not bind", async () => {
    const item = await fixture();
    const publication = JSON.parse(readFileSync(item.written.publicationPath, "utf8")) as Json;
    const annexes = publication.annexes as Json[];
    const cisco = annexes.find((annex) => annex.path === "annex/cisco.json") as Json;
    cisco.bytesBase64 = Buffer.from('{"runs":[]}').toString("base64");
    writeJson(item.written.publicationPath, publication);
    const digest = (await import("node:crypto"))
      .createHash("sha256")
      .update(readFileSync(item.written.publicationPath))
      .digest("hex");
    rewriteHandoff(item.written, (handoff) =>
      Object.assign(handoff, { publicationSha256: digest }),
    );
    expect(() => generate(item)).toThrow(
      "source-assessment-generator:publication-annex-digest annex/cisco.json",
    );
  });

  it("checks attestation custody against the Sigstore bundle, not the handoff", async () => {
    const bent = [
      [
        "another subject",
        { subjects: ["0".repeat(64)] },
        /attestation subject-does-not-cover-publication/,
      ],
      [
        "another source digest",
        { sourceRepositoryDigest: "d".repeat(40) },
        /attestation certificate-identity/,
      ],
      [
        "another signer workflow",
        {
          buildSignerURI:
            "https://github.com/samartomar/aih-scan/.github/workflows/other.yml@refs/heads/main",
        },
        /attestation certificate-identity/,
      ],
      ["a signature under another key", { resignWith: true }, /attestation signature-invalid/],
      [
        "a log entry after the observation window",
        { integratedTime: Date.parse("2026-01-01T00:50:00.000Z") / 1000 },
        /attestation tlog-outside/,
      ],
    ] as const;
    for (const [, identity, refusal] of bent) {
      const item = await fixture();
      writeFileSync(
        item.written.attestationPath,
        attestationBundle(item.written.publicationSha256, item.written.signedAt, identity).bytes,
      );
      expect(() => generate(item)).toThrow(refusal);
    }
    // A handoff that restates its custody differently from the bundle.
    const restated = await fixture();
    rewriteHandoff(restated.written, (handoff) => {
      (handoff.attestation as Json).runInvocationURI =
        "https://github.com/samartomar/aih-scan/actions/runs/1/attempts/1";
    });
    expect(() => generate(restated)).toThrow(
      "source-assessment-generator:handoff-attestation-custody",
    );
    const run = await fixture();
    rewriteHandoff(run.written, (handoff) => {
      (handoff.workflow as Json).runId = 1;
    });
    expect(() => generate(run)).toThrow("source-assessment-generator:workflow-custody");
    const release = await fixture();
    rewriteHandoff(release.written, (handoff) => {
      const value = handoff.release as Json;
      value.url = `https://github.com/example/scan/releases/tag/${value.tag}`;
    });
    expect(() => generate(release)).toThrow("source-assessment-generator:release-identity");
  });

  it("fails closed on unexpected handoff fields, mismatched publications, and partial mapping", async () => {
    for (const mutate of [
      (handoff: Json) => Object.assign(handoff, { unexpected: true }),
      (handoff: Json) => Object.assign(handoff, { publicationSha256: "0".repeat(64) }),
      (handoff: Json) => Object.assign(handoff.mapping as Json, { components: [] }),
    ]) {
      const item = await fixture();
      rewriteHandoff(item.written, mutate);
      expect(() => generate(item)).toThrow();
    }
  });

  it("rejects transformed source bytes, symbolic links in closures, and existing output", async () => {
    const transformed = await fixture();
    writeFileSync(join(transformed.skillRoot, "SKILL.md"), "# Demo\r\n\r\nReview this source.\r\n");
    expect(() => generate(transformed)).toThrow(/source.*digest/i);

    const symbolic = await fixture();
    symlinkSync(join(symbolic.skillRoot, "SKILL.md"), join(symbolic.skillRoot, "alias.md"));
    expect(() => symbolic.api.hashComponentTreeV1(symbolic.sourceRoot, ["skills/demo"])).toThrow(
      /symbolic link/,
    );

    const existing = await fixture();
    mkdirSync(existing.outputRoot, { recursive: true });
    expect(() => generate(existing)).toThrow(/output.*exists/i);
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

  it("rejects a symbolic parent of the supplied source root when hashing the source tree", async () => {
    const item = await linkedParentSourceFixture();

    expect(() => item.api.hashSourceTreeV1(item.sourceRoot)).toThrow(
      /source-root.*symbolic.*ancestor/i,
    );
  });

  it("rejects a symbolic parent of the supplied source root when hashing a component", async () => {
    const item = await linkedParentSourceFixture();

    expect(() => item.api.hashComponentTreeV1(item.sourceRoot, ["skills/demo"])).toThrow(
      /source-root.*symbolic.*ancestor/i,
    );
  });

  it("rejects an output-parent junction before changing output or the manifest", async () => {
    const item = await fixture();
    const manifestBefore = readFileSync(item.manifestPath);
    const externalWorkbench = join(item.root, "external-workbench");
    mkdirSync(externalWorkbench);
    symlinkSync(externalWorkbench, join(item.root, "defaults", "workbench"), directoryLinkType);

    expect(() => generate(item)).toThrow(/output.*ancestor/i);
    expect(existsSync(join(externalWorkbench, "fixture"))).toBe(false);
    expect(readFileSync(item.manifestPath)).toEqual(manifestBefore);
  });

  it("rejects a manifest-ancestor junction before changing output or the manifest", async () => {
    const item = await fixture();
    const externalDefaults = join(item.root, "external-defaults");
    renameSync(join(item.root, "defaults"), externalDefaults);
    symlinkSync(externalDefaults, join(item.root, "defaults"), directoryLinkType);
    const manifestBefore = readFileSync(item.manifestPath);

    expect(() => generate(item)).toThrow(/manifest.*ancestor/i);
    expect(existsSync(join(externalDefaults, "workbench", "fixture"))).toBe(false);
    expect(readFileSync(item.manifestPath)).toEqual(manifestBefore);
  });
});
