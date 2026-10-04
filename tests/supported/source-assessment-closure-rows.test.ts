import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  catalogIndex,
  sha256,
  writeJson,
  writeScannerPublication,
} from "./scanner-publication-fixture.js";

type Json = Record<string, unknown>;
type Generator = {
  generateSourceAssessmentRowsV1(input: {
    sourceRoot: string;
    handoffPath: string;
    publicationPath: string;
    attestationPath: string;
    provider: string;
    outputRoot: string;
    manifestPath: string;
    definitionPath?: string;
    catalogIndexPath?: string;
    authoringCatalogPath?: string;
  }): { entries: number; seedPaths: string[]; excluded?: Json[] };
  hashComponentTreeV1(sourceRoot: string, paths: string[]): { treeSha256: string };
  hashSourceTreeV1(sourceRoot: string): { treeSha256: string };
};

type MappingHelper = {
  deriveClosureMappingV1(
    publication: unknown,
    definition: unknown,
    authoringCatalog?: unknown,
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

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Json;
const MIT = "MIT License\n\nCopyright (c) 2026 Fixture\n\nPermission is hereby granted.\n";
/**
 * The restrictive license four anthropics/skills skills carry (D68), in the words its LICENSE.txt
 * uses; the fragments the Catalog states are the file's own, whitespace-normalized.
 */
const ANTHROPIC_PROPRIETARY = [
  "© 2025 Anthropic, PBC. All rights reserved.",
  "",
  "LICENSE: Use of these materials (including all code, prompts, assets, files,",
  "and other components of this Skill) is governed by your agreement with",
  "Anthropic regarding use of Anthropic's services. If no separate agreement",
  "exists, use is governed by Anthropic's Consumer Terms of Service or",
  'Commercial Terms of Service, as applicable. Your applicable agreement is referred to as the "Agreement."',
  "",
  "ADDITIONAL RESTRICTIONS: Notwithstanding anything in the Agreement to the",
  "contrary, users may not:",
  "",
  "- Extract these materials from the Services or retain copies of these materials",
  "- Create derivative works based on these materials",
  "",
  "Anthropic retains all right, title, and interest in these materials.",
  "",
].join("\n");
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
  authoring?: (source: Json, files: Record<string, string>) => Json;
}

/**
 * A whole-repository Scanner publication over a fixture tree (scanner-publication-fixture.ts):
 * the signed statement over a receipt and request with Scan's domain digests, one native annex
 * with per-file hashes and one cisco SARIF annex bound by that receipt, the outer attestation, and
 * the consumer handoff Scan emits for a mapping that covers `mapped`.
 */
async function fixture(options: Options) {
  const api = await generator();
  const root = mkdtempSync(join(tmpdir(), "aih-catalog-closure-rows-"));
  temporaryRoots.push(root);
  const sourceRoot = join(root, "source");
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
  const written = await writeScannerPublication({
    directory: join(root, "publication"),
    source,
    files: options.files,
    components: options.partition,
    analyzers: ANALYZERS,
    treeOf: (paths) => api.hashComponentTreeV1(sourceRoot, paths).treeSha256,
    observations: options.findings,
    mapped: options.mapped,
    ...(options.nativeOverride ? { nativeOverride: options.nativeOverride } : {}),
    ...(options.tamperReceipt ? { tamperReceipt: true } : {}),
  });
  const definitionPath = join(root, "definition.json");
  writeJson(definitionPath, options.definition(source, options.files));
  const authoringPath = join(root, "authoring-catalog.json");
  if (options.authoring) writeJson(authoringPath, options.authoring(source, options.files));
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
    catalogIndex("fixture", source, [
      { kind: "skill", name: "skills-demo-000000000002", entryPath: "skills/demo/SKILL.md" },
    ]),
  );
  const run = (definition = true) =>
    api.generateSourceAssessmentRowsV1({
      sourceRoot,
      handoffPath: written.handoffPath,
      publicationPath: written.publicationPath,
      attestationPath: written.attestationPath,
      provider: "fixture",
      outputRoot,
      manifestPath,
      ...(definition
        ? { definitionPath, ...(options.authoring ? { authoringCatalogPath: authoringPath } : {}) }
        : { catalogIndexPath }),
    });
  return {
    run,
    outputRoot,
    source,
    definitionPath,
    publicationPath: written.publicationPath,
    authoringPath,
    requestSha256: written.requestSha256,
  };
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
  { analyzer: "cisco", ruleId: "SERVER_RULE", path: "server/index.js" },
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

  it("states a known restrictive license as found, with the file's own words (D68)", async () => {
    const item = await fixture({
      files: {
        "README.md": "# Fixture\n",
        "skills/demo/SKILL.md": "# Demo\n",
        "skills/demo/LICENSE.txt": ANTHROPIC_PROPRIETARY,
      },
      partition: [
        { id: "runtime:root-000000000001", content: "general", paths: ["README.md"] },
        { id: "skill:skills-demo-000000000002", content: "skill", paths: ["skills/demo"] },
      ],
      mapped: ["runtime:root-000000000001", "skill:skills-demo-000000000002"],
      findings: [],
      // The anthropics/skills shape: the curated license reference is the README, and each skill
      // carries its own LICENSE.txt inside its directory.
      definition: (source, files) => ({
        version: "pinned-component-collection/v1",
        source: {
          id: source.id,
          repository: `https://github.com/${source.owner}/${source.repository}`,
          commit: source.pinnedCommit,
          version: "1.0.0",
          licenseFileRef: "README.md",
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
            fileRefs: ["skills/demo/LICENSE.txt", "skills/demo/SKILL.md"],
            description: "Demo skill.",
            primaryPath: "skills/demo/SKILL.md",
          },
        ],
      }),
    });
    const result = item.run();
    expect(result.entries).toBe(1);
    const dir = join(item.outputRoot, "skill.fixture.demo");
    const seed = read(join(dir, "seed.json"));
    // A stated license is not a gap: the row is rendered with the license it carries.
    expect((seed.qualification as Json).gaps).not.toContain("evidence/license-gap.json");
    expect(read(join(dir, "artifacts", "closure.json"))).toMatchObject({
      scope: {
        description:
          "Exact pinned source-file closure and applicable Anthropic-Proprietary notice; review-only assessment, with no execution or organization admission.",
      },
    });
    const right = read(join(dir, "evidence", "source-right.json")).summary as string;
    expect(right).toContain(
      `Applicable Anthropic-Proprietary notice at example/tools@${"a".repeat(40)}:skills/demo/LICENSE.txt, sha256:${sha256(ANTHROPIC_PROPRIETARY)}.`,
    );
    // The label quotes the file's own words (whitespace runs normalized), bound by its digest.
    expect(right).toContain('The file\'s own words: "© 2025 Anthropic, PBC. All rights reserved."');
    expect(right).toContain(
      '"is governed by your agreement with Anthropic regarding use of Anthropic\'s services"',
    );
    expect(right).toContain(
      '"ADDITIONAL RESTRICTIONS: Notwithstanding anything in the Agreement to the contrary, users may not:"',
    );
    expect(right).toContain(
      "No trademark, external-service, or organization-admission rights inferred.",
    );
    // The restrictive license is never relabeled as a license the file does not state.
    expect(right).not.toContain("Apache-2.0");
    expect(right).not.toContain("MIT");
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
      "License not determined: LICENSE is not one of the license texts the Catalog states (Apache-2.0, MIT, Anthropic-Proprietary).",
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
  { analyzer: "cisco", ruleId: "AGENT_RULE", path: "agents/reviewer.md" },
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
/**
 * The Catalog's policy authoring catalog at the pin (tools/emit-compiler-input.mjs): the curated
 * mcp components exactly as the definition lists them, one non-mcp asset, and `externals`.
 */
const authoringCatalog =
  (components: Json[], externals: ((source: Json, files: Record<string, string>) => Json)[]) =>
  (source: Json, files: Record<string, string>): Json => {
    const pin = { repository: `${source.owner}/${source.repository}`, commit: source.pinnedCommit };
    return {
      version: "pinned-baseline/v1",
      framework: {
        id: source.id,
        ...pin,
        assets: [
          {
            id: "agent:reviewer",
            kind: "agent",
            source: { ...pin, path: "agents/reviewer.md" },
            sourcePaths: ["agents/reviewer.md"],
          },
          ...components
            .filter((component) => String(component.id).startsWith("mcp:"))
            .map((component) => ({
              id: component.id,
              kind: "mcp",
              source: { ...pin, path: (component.paths as string[])[0] },
              sourcePaths: component.paths,
            })),
          ...externals.map((external) => external(source, files)),
        ],
      },
    };
  };
/** An external-inventory MCP asset (framework-catalogs-v1.ts externalEccMcpAssets). */
const external =
  (
    name: string,
    path = "mcp-configs/servers.json",
    change: (asset: Json) => Json = (asset) => asset,
  ) =>
  (source: Json, files: Record<string, string>): Json =>
    change({
      id: `mcp:${name}`,
      kind: "mcp",
      source: {
        repository: `${source.owner}/${source.repository}`,
        commit: source.pinnedCommit,
        path,
      },
      sourcePaths: [path],
      metadata: {
        title: name,
        summary: `${name} server`,
        usageContext: "ECC declares this as a stdio MCP configuration.",
        allowedTools: [],
        sourcePath: path,
        sourceSha256: sha256(files[path] ?? ""),
      },
    });
const baseline = (
  components: Json[] = BASELINE_COMPONENTS,
  externals: ((source: Json, files: Record<string, string>) => Json)[] = [],
) => ({
  definition: baselineCatalog(components),
  authoring: authoringCatalog(components, externals),
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
    const item = await fixture({ ...baselineBase, ...baseline() });
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
    const item = await fixture({ ...baselineBase, ...baseline() });
    const helper = await mappingHelper();
    const derived = helper.deriveClosureMappingV1(
      read(item.publicationPath),
      read(item.definitionPath),
      read(item.authoringPath),
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
      ...baseline(),
    });
    expect(() => item.run()).toThrow("source-assessment-generator:closure-file-unmapped");
  });

  it("verifies every root of a two-root skill against the native hashes", async () => {
    const item = await fixture({
      ...baselineBase,
      ...baseline(),
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
    const item = await fixture({ ...baselineBase, ...baseline(components) });
    expect(() => item.run()).toThrow(`source-assessment-generator:${message}`);
  });
});

describe("external-inventory mcp rows from the policy authoring catalog (D61)", () => {
  const closure = (dir: string) =>
    (read(join(dir, "artifacts", "closure.json")).files as { path: string }[]).map(
      (file) => file.path,
    );
  const subjectPath = (dir: string) =>
    ((read(join(dir, "seed.json")).subject as Json).source as Json).path;
  const report = (dir: string) => read(join(dir, "evidence", "report.json")).summary as string;
  const EXTERNALS = [external("gamma"), external("delta")];

  it("renders one row per authoring-catalog mcp asset, the external ones on their declaration file", async () => {
    const item = await fixture({ ...baselineBase, ...baseline(BASELINE_COMPONENTS, EXTERNALS) });
    expect(item.run().entries).toBe(7);
    for (const name of ["gamma", "delta"]) {
      const row = join(item.outputRoot, `mcp.fixture.${name}`);
      expect(closure(row)).toEqual(["LICENSE", "mcp-configs/servers.json"]);
      expect(subjectPath(row)).toBe("mcp-configs/servers.json");
      // The finding located in the declaration file is stated on the row, as information.
      expect(report(row)).toContain("Scanner mapped findings: 1;");
      expect(report(row)).toContain(
        "the component artifacts of 2 Scanner components (runtime:mcp-configs-000000000002, runtime:root-000000000001)",
      );
    }
    // The curated rows are unchanged by the external ones.
    expect(closure(join(item.outputRoot, "mcp.fixture.alpha"))).toEqual([
      ".mcp.json",
      "LICENSE",
      "mcp-configs/servers.json",
    ]);
  });

  it("maps the Scanner component that holds an external row's declaration file", async () => {
    const item = await fixture({
      ...baselineBase,
      ...baseline(
        BASELINE_COMPONENTS.filter((component) => component.id !== "skill:demo"),
        EXTERNALS,
      ),
    });
    const helper = await mappingHelper();
    const derived = helper.deriveClosureMappingV1(
      read(item.publicationPath),
      read(item.definitionPath),
      read(item.authoringPath),
    );
    expect(derived.rows).toEqual([
      "agent:planner",
      "agent:reviewer",
      "mcp:alpha",
      "mcp:beta",
      "mcp:delta",
      "mcp:gamma",
    ]);
  });

  it("refuses a baseline catalog with mcp components but no policy authoring catalog", async () => {
    const item = await fixture({ ...baselineBase, definition: baselineCatalog() });
    expect(() => item.run()).toThrow(
      "source-assessment-generator:authoring-catalog-required: a baseline catalog with mcp components renders its mcp rows from the Catalog's policy authoring catalog at the pin",
    );
  });

  it("refuses a declared digest the checkout does not have", async () => {
    const item = await fixture({
      ...baselineBase,
      ...baseline(BASELINE_COMPONENTS, [
        external("gamma", "mcp-configs/servers.json", (asset) => ({
          ...asset,
          metadata: { ...(asset.metadata as Json), sourceSha256: "0".repeat(64) },
        })),
      ]),
    });
    expect(() => item.run()).toThrow("source-assessment-generator:closure-file-declared-digest");
  });

  it.each([
    [
      "an external asset on a file no curated mcp component lists",
      [external("gamma", "README.md")],
      "authoring-catalog-external-undeclared mcp:gamma: README.md is not a declaration file the curated definition lists for an mcp component",
    ],
    [
      "an external asset on a directory",
      [external("gamma", "mcp-configs")],
      "authoring-catalog-external-undeclared mcp:gamma: mcp-configs is not a declaration file the curated definition lists for an mcp component",
    ],
    [
      "an external asset with several source paths",
      [
        external("gamma", "mcp-configs/servers.json", (asset) => ({
          ...asset,
          sourcePaths: [".mcp.json", "mcp-configs/servers.json"],
        })),
      ],
      "authoring-catalog-external-undeclared mcp:gamma: an external asset names exactly its one declaration file",
    ],
    [
      "an external asset without a declared digest",
      [
        external("gamma", "mcp-configs/servers.json", (asset) => {
          const { metadata: _, ...rest } = asset;
          return rest;
        }),
      ],
      "authoring-catalog-external-undeclared mcp:gamma: an external asset names exactly its one declaration file",
    ],
    [
      "an external asset at another pin",
      [
        external("gamma", "mcp-configs/servers.json", (asset) => ({
          ...asset,
          source: { ...(asset.source as Json), commit: "9".repeat(40) },
        })),
      ],
      "authoring-catalog-source",
    ],
  ])("refuses %s", async (_label, externals, message) => {
    const item = await fixture({ ...baselineBase, ...baseline(BASELINE_COMPONENTS, externals) });
    expect(() => item.run()).toThrow(`source-assessment-generator:${message}`);
  });

  it("refuses an authoring catalog at another pin or disagreeing with the curated mcp components", async () => {
    const otherPin = await fixture({
      ...baselineBase,
      definition: baselineCatalog(),
      authoring: (source, files) => {
        const value = authoringCatalog(BASELINE_COMPONENTS, [])(source, files);
        (value.framework as Json).commit = "9".repeat(40);
        return value;
      },
    });
    expect(() => otherPin.run()).toThrow("source-assessment-generator:authoring-catalog-source");
    const otherEntry = await fixture({
      ...baselineBase,
      definition: baselineCatalog(),
      authoring: authoringCatalog(
        BASELINE_COMPONENTS.map((component) =>
          component.id === "mcp:alpha"
            ? { ...component, paths: [...DECLARATIONS].reverse() }
            : component,
        ),
        [],
      ),
    });
    expect(() => otherEntry.run()).toThrow(
      "source-assessment-generator:authoring-catalog-curated-mismatch mcp:alpha",
    );
    const missing = await fixture({
      ...baselineBase,
      definition: baselineCatalog(),
      authoring: authoringCatalog(
        BASELINE_COMPONENTS.filter((component) => component.id !== "mcp:beta"),
        [],
      ),
    });
    expect(() => missing.run()).toThrow(
      "source-assessment-generator:authoring-catalog-curated-missing mcp:beta",
    );
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
      requestSha256: item.requestSha256,
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

  it("maps an outside-request root license as source evidence, not scanned payload", async () => {
    const item = await fixture({
      ...base,
      partition: PARTITION.slice(1),
      mapped: PARTITION.slice(1, 3).map((component) => component.id),
      definition: componentCollection,
    });
    const helper = await mappingHelper();
    const derived = helper.deriveClosureMappingV1(
      read(item.publicationPath),
      read(item.definitionPath),
    );
    expect(derived.mapping.components).toHaveLength(2);
    expect(item.run().entries).toBe(2);
    const closure = read(join(item.outputRoot, "skill.fixture.demo", "artifacts", "closure.json"));
    expect((closure.files as Json[]).map((file) => file.path)).toEqual([
      "skills/demo/SKILL.md",
      "skills/demo/ref.md",
    ]);
    const licenseRecord = read(join(item.outputRoot, "source-license.json"));
    expect(licenseRecord).toMatchObject({
      sourceId: "fixture",
      files: [{ path: "LICENSE", sha256: sha256(MIT) }],
      annex: { path: "annex/aih-native.json" },
    });
    expect(closure.sourceLicense).toMatchObject({
      path: "defaults/workbench/fixture/source-license.json",
      sha256: sha256(readFileSync(join(item.outputRoot, "source-license.json"))),
    });
    expect(
      read(join(item.outputRoot, "mcp.fixture.demo", "artifacts", "closure.json")).sourceLicense,
    ).toEqual(closure.sourceLicense);
    expect(
      read(join(item.outputRoot, "skill.fixture.demo", "evidence", "source-right.json")).summary,
    ).toMatch(/^Applicable MIT notice at example\/tools@a{40}:LICENSE, sha256:/);
  });

  it("refuses an annex license digest that differs from the pinned source", async () => {
    const item = await fixture({
      ...base,
      partition: PARTITION.slice(1),
      mapped: PARTITION.slice(1, 3).map((component) => component.id),
      nativeOverride: { LICENSE: "0".repeat(64) },
      definition: componentCollection,
    });
    expect(() => item.run()).toThrow("source-assessment-generator:source-license-native-digest");
  });

  it("refuses a source license record missing from the authenticated annex", async () => {
    const item = await fixture({
      ...base,
      partition: PARTITION.slice(1),
      mapped: PARTITION.slice(1, 3).map((component) => component.id),
      definition: (source, files) => {
        const definition = componentCollection(source, files);
        (definition.source as Json).licenseFileRef = "COPYING";
        (definition.files as Json[]).push({ path: "COPYING", sha256: `sha256:${sha256(MIT)}` });
        return definition;
      },
    });
    expect(() => item.run()).toThrow("source-assessment-generator:source-license-record-missing");
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
      "License not determined: skills/demo/LICENSE is not one of the license texts the Catalog states (Apache-2.0, MIT, Anthropic-Proprietary).",
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

  it("states a known restrictive license as found, not as a gap (D68)", async () => {
    const item = await fixture(
      skillOnly({
        "skills/demo/SKILL.md": "# Demo\n",
        "skills/demo/LICENSE.txt": ANTHROPIC_PROPRIETARY,
      }),
    );
    expect(item.run(false).entries).toBe(1);
    const dir = join(item.outputRoot, "skill.fixture.skills-demo-000000000002");
    const seed = read(join(dir, "seed.json"));
    expect((seed.qualification as { gaps: string[] }).gaps).not.toContain(
      "evidence/license-gap.json",
    );
    const right = read(join(dir, "evidence", "source-right.json")).summary as string;
    expect(right).toContain(
      `Applicable Anthropic-Proprietary notice at example/tools@${"a".repeat(40)}:skills/demo/LICENSE.txt, sha256:${sha256(ANTHROPIC_PROPRIETARY)}.`,
    );
    expect(right).toContain('The file\'s own words: "© 2025 Anthropic, PBC. All rights reserved."');
    expect(right).toContain(
      '"ADDITIONAL RESTRICTIONS: Notwithstanding anything in the Agreement to the contrary, users may not:"',
    );
    expect(right).not.toContain("Apache-2.0");
  });
});
