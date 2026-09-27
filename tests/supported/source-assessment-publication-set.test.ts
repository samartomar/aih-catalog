import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
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
import {
  canonical,
  catalogIndex,
  sha256,
  type WrittenPublication,
  writeJson,
  writeScannerPublication,
} from "./scanner-publication-fixture.js";

// T4 over a publication set (D49): the publications of one request set over one source, each
// verified as a single publication is, rendered once over the union into one provider root.

type Json = Record<string, unknown>;
type Generator = {
  generateSourceAssessmentRowsV1(input: {
    sourceRoot: string;
    handoffPath: string | string[];
    publicationPath: string | string[];
    attestationPath: string | string[];
    provider: string;
    outputRoot: string;
    manifestPath: string;
    definitionPath?: string;
    catalogIndexPath?: string;
    definitionOverlap?: string;
  }): { entries: number; seedPaths: string[]; excluded?: Json[] };
  assertPublicationSetV1(publications: unknown[], definitionOverlap?: string): void;
  hashComponentTreeV1(sourceRoot: string, paths: string[]): { treeSha256: string };
  hashSourceTreeV1(sourceRoot: string): { treeSha256: string };
};
type MappingHelper = {
  deriveClosureMappingV1(publication: unknown, definition: unknown): { mapping: Json };
  deriveClosureMappingSetV1(
    publications: unknown[],
    definition: unknown,
    authoringCatalog?: unknown,
    definitionOverlap?: string,
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
/** A different execution's cisco observations: annex bytes no other member shares. */
const OTHER_RUN: FixtureFinding[] = [
  { analyzer: "cisco", ruleId: "OTHER_RULE", path: "README.md" },
];
/** One request of the set: its own partition slice, observations and source overrides. */
interface Member {
  name: string;
  partition: Partition[];
  findings?: FixtureFinding[];
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
  { analyzer: "cisco", ruleId: "SERVER_RULE", path: "server/index.js" },
];

/**
 * One Scanner request set over a fixture tree (D49): every member is a whole-repository
 * publication with its own request, receipt, signature and attestation, over the one execution's
 * annex bytes (scanner-publication-fixture.ts); its handoff is the one Scan emits for it.
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
  const signer = generateKeyPairSync("ed25519");
  const built: WrittenPublication[] = [];
  for (const [index, member] of members.entries()) {
    const written = await writeScannerPublication({
      directory: join(root, "publications", member.name),
      source: { ...baseSource, ...member.source },
      files: FILES,
      components: member.partition,
      analyzers: ANALYZERS,
      treeOf: (paths) => api.hashComponentTreeV1(sourceRoot, paths).treeSha256,
      observations: member.findings ?? FINDINGS,
      mapped: member.partition.map((component) => component.id),
      signedAt: `2026-01-01T00:0${index}:00.000Z`,
      expiresAt: `2026-01-01T00:4${index}:00.000Z`,
      signer,
    });
    built.push(written);
  }
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
  // The Catalog's curated inventory of this provider: the selection authority of the direct
  // skill rows (the closure rows take theirs from the curated definition).
  const catalogIndexPath = join(root, "defaults", "catalog-index-v1.json");
  writeJson(
    catalogIndexPath,
    catalogIndex("fixture", baseSource, [
      { kind: "skill", name: "skills-demo-02", entryPath: "skills/demo/SKILL.md" },
      { kind: "skill", name: "skills-other-03", entryPath: "skills/other/SKILL.md" },
    ]),
  );
  const input = (definition = true) => ({
    sourceRoot,
    handoffPath: built.map((item) => item.handoffPath),
    publicationPath: built.map((item) => item.publicationPath),
    attestationPath: built.map((item) => item.attestationPath),
    provider: "fixture",
    outputRoot,
    manifestPath,
    ...(definition ? { definitionPath } : { catalogIndexPath }),
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
const OVERLAP: Member[] = [
  SET[0] as Member,
  {
    name: "two",
    partition: [OTHER, SERVER, { ...DEMO, id: "skill:skills-demo-copy-05" }],
  },
];
const evidenceOf = (outputRoot: string, row: string) => join(outputRoot, row, "evidence");
const summaryOf = (path: string) => read(path).summary as string;
const listFiles = (directory: string): string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();

describe("source-assessment rows over a publication set", () => {
  it("accepts equal-digest overlap only in compiler-catalog mode across mapping and rows", async () => {
    const set = await publicationSet(OVERLAP);
    const publications = set.built.map((item) => read(item.publicationPath));
    const mapping = await mappingHelper();
    expect(() => mapping.deriveClosureMappingSetV1(publications, read(set.definitionPath))).toThrow(
      "publication-set-component-overlap",
    );
    expect(
      mapping.deriveClosureMappingSetV1(
        publications,
        read(set.definitionPath),
        undefined,
        "compiler-catalog",
      ).mappings,
    ).toHaveLength(2);
    expect(() => set.run()).toThrow("publication-set-component-overlap");
    const api = await generator();
    expect(
      api.generateSourceAssessmentRowsV1({
        ...set.input(),
        definitionOverlap: "compiler-catalog",
      }).entries,
    ).toBe(2);
  });

  it("refuses unknown overlap modes at the mapping and row boundaries", async () => {
    const set = await publicationSet(SET);
    const mapping = await mappingHelper();
    expect(() =>
      mapping.deriveClosureMappingSetV1(
        set.built.map((item) => read(item.publicationPath)),
        read(set.definitionPath),
        undefined,
        "unknown",
      ),
    ).toThrow("definition-overlap");
    const api = await generator();
    expect(() =>
      api.generateSourceAssessmentRowsV1({ ...set.input(), definitionOverlap: "unknown" }),
    ).toThrow("definition-overlap");
  });

  it("refuses different native digests for one file in compiler-catalog mode", async () => {
    const set = await publicationSet(OVERLAP);
    const api = await generator();
    const publications = set.built.map((item) => read(item.publicationPath));
    const second = publications[1] as Json;
    const annexes = second.annexes as { path: string; bytesBase64: string }[];
    const native = annexes.find((item) => item.path === "annex/aih-native.json");
    if (native === undefined) throw new Error("native annex absent");
    const payload = JSON.parse(Buffer.from(native.bytesBase64, "base64").toString("utf8")) as {
      files: { path: string; sha256: string }[];
    };
    const file = payload.files.find((item) => item.path === "skills/demo/SKILL.md");
    if (file === undefined) throw new Error("shared file absent");
    file.sha256 = "0".repeat(64);
    native.bytesBase64 = Buffer.from(canonical(payload)).toString("base64");
    const receipt = second.receipt as Json;
    const components = receipt.components as {
      observations: { analyzer: string; annexSha256: string }[];
    }[];
    for (const component of components)
      for (const observation of component.observations)
        if (observation.analyzer === "aih-native")
          observation.annexSha256 = sha256(Buffer.from(native.bytesBase64, "base64"));
    const { receiptSha256: _old, ...authoring } = receipt;
    receipt.receiptSha256 = sha256(
      canonical({ domain: "aih.baseline-vet-receipt-v1", receipt: authoring }),
    );
    expect(() => api.assertPublicationSetV1(publications, "compiler-catalog")).toThrow(
      "publication-set-component-overlap-digest",
    );
  });

  it("passes compiler-catalog mode through both command lines", async () => {
    const set = await publicationSet(OVERLAP);
    const outputs = set.built.map((item) => join(dirname(item.publicationPath), "mapping.json"));
    const mapping = spawnSync(
      process.execPath,
      [
        resolve(dirname(TOOL), "derive-closure-mapping.mjs"),
        "--definition",
        set.definitionPath,
        "--definition-overlap",
        "compiler-catalog",
        ...set.built.flatMap((item, index) => [
          "--publication",
          item.publicationPath,
          "--output",
          outputs[index] as string,
        ]),
      ],
      { encoding: "utf8" },
    );
    expect(mapping.status).toBe(0);
    expect(outputs.every(existsSync)).toBe(true);
    const input = set.input();
    const rows = spawnSync(
      process.execPath,
      [
        TOOL,
        "--source-root",
        input.sourceRoot,
        "--provider",
        input.provider,
        "--output-root",
        input.outputRoot,
        "--manifest",
        input.manifestPath,
        "--definition",
        set.definitionPath,
        "--definition-overlap",
        "compiler-catalog",
        ...set.built.flatMap((item) => [
          "--handoff",
          item.handoffPath,
          "--publication",
          item.publicationPath,
          "--attestation",
          item.attestationPath,
        ]),
      ],
      { encoding: "utf8" },
    );
    expect(rows.status).toBe(0);
    expect(JSON.parse(rows.stdout).entries).toBe(2);
  });
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
      attestationPath: input.attestationPath[0] as string,
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
      [SET[0] as Member, { ...(SET[1] as Member), findings: OTHER_RUN }],
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
        attestationPath: [input.attestationPath[0] as string, input.attestationPath[0] as string],
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
    expect(() =>
      api.generateSourceAssessmentRowsV1({
        ...input,
        attestationPath: [input.attestationPath[0] as string],
      }),
    ).toThrow("source-assessment-generator:publication-set-pairs");
    expect(() =>
      api.generateSourceAssessmentRowsV1({
        ...input,
        attestationPath: [...input.attestationPath].reverse(),
      }),
    ).toThrow("source-assessment-generator:attestation subject-does-not-cover-publication");
  });

  it("takes the set on the command line as repeated --handoff/--publication/--attestation triples", async () => {
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
        "--attestation",
        input.attestationPath[index] as string,
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
  it("keeps one annex-bound license record when no request contains root LICENSE", async () => {
    const set = await publicationSet([
      { name: "one", partition: [DEMO] },
      { name: "two", partition: [SERVER, OTHER] },
    ]);
    const helper = await mappingHelper();
    const derived = helper.deriveClosureMappingSetV1(
      set.built.map((item) => read(item.publicationPath)),
      read(set.definitionPath),
    );
    expect(
      derived.mappings.map((mapping) =>
        (mapping.components as Json[]).map((component) => component.scannerComponentId),
      ),
    ).toEqual([[DEMO.id], [SERVER.id]]);
    expect(set.run().entries).toBe(2);
    const record = read(join(set.outputRoot, "source-license.json"));
    expect(record.files).toEqual([{ path: "LICENSE", sha256: sha256(MIT) }]);
    for (const id of ["mcp.fixture.demo", "skill.fixture.demo"]) {
      const closure = read(join(set.outputRoot, id, "artifacts", "closure.json"));
      expect((closure.files as Json[]).some((file) => file.path === "LICENSE")).toBe(false);
      expect(closure.sourceLicense).toMatchObject({
        path: "defaults/workbench/fixture/source-license.json",
      });
    }
  });

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
    const set = await publicationSet([
      SET[0] as Member,
      { ...(SET[1] as Member), findings: OTHER_RUN },
    ]);
    expect(() =>
      helper.deriveClosureMappingSetV1(
        set.built.map((item) => read(item.publicationPath)),
        read(set.definitionPath),
      ),
    ).toThrow("source-assessment-generator:publication-set-annex-bytes");
  });
});
