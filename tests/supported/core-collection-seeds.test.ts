import { createHash } from "node:crypto";
import {
  cpSync,
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
import * as reader from "../../src/production/workbench/packaged-evidence-v1.js";
import {
  packagedCoverageProjectionDigestV1,
  packagedReportComponentDigestV1,
} from "../../src/production/workbench/packaged-evidence-v1.js";

type Json = Record<string, unknown>;
type Reader = typeof reader;
type Renderer = {
  renderCoreCollectionSeedsV1(input: {
    catalogRoot: string;
    recordPath: string;
    draftPath: string;
    outputRoot: string;
    reader: Reader;
  }): {
    release: string;
    rendered: string[];
    unseeded: string[];
    unsupported: Json[];
  };
  renderCoreCollectionNewReleaseV1(input: ReleaseInput): ReleaseResult;
  renderCoreCollectionInitialReleaseV1(input: ReleaseInput): ReleaseResult;
};
type ReleaseInput = {
  catalogRoot: string;
  recordPath: string;
  draftPath: string;
  release: string;
  packagePath: string;
  reader: Reader;
};
type ReleaseResult = {
  mode: string;
  previousRelease: string | null;
  release: string;
  seedRoot: string;
  rendered: string[];
  added: string[];
  retired: string[];
  removed: string[];
  unsupported: Json[];
  written: string[];
};
type Generators = {
  index: {
    generateCatalogIndex(root: string): unknown;
    serializeCatalogIndex(value: unknown): string;
  };
  collections: {
    generateCatalogCollections(root: string): unknown;
    serializeCatalogCollections(value: unknown): string;
  };
  runtime: {
    generateCatalogRuntimeDescriptors(root: string): unknown;
    serializeCatalogRuntimeDescriptors(value: unknown): string;
  };
  categories: {
    generateCatalogCategories(root: string): unknown;
    serializeCatalogCategories(value: unknown): string;
  };
};

async function renderer(): Promise<Renderer> {
  // @ts-expect-error The maintenance renderer is intentionally plain ESM JavaScript.
  return (await import("../../tools/render-core-collection-seeds.mjs")) as Renderer;
}

async function generators(): Promise<Generators> {
  return {
    // @ts-expect-error The maintenance generators are intentionally plain ESM JavaScript.
    index: await import("../../tools/generate-catalog-index.mjs"),
    // @ts-expect-error The maintenance generators are intentionally plain ESM JavaScript.
    collections: await import("../../tools/generate-catalog-collections.mjs"),
    // @ts-expect-error The maintenance generators are intentionally plain ESM JavaScript.
    runtime: await import("../../tools/generate-catalog-runtime-descriptors.mjs"),
    // @ts-expect-error The maintenance generators are intentionally plain ESM JavaScript.
    categories: await import("../../tools/generate-catalog-categories.mjs"),
  };
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
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const digest = (domain: string, value: unknown) =>
  `sha256:${sha(`${domain}\0${canonical(value)}`)}`;
const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Json;
const repository = resolve(import.meta.dirname, "..", "..");

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

const RELEASE = "0.6.2";
const NEXT = "0.7.0";
const revisionOf = (release: string) => `package:@aihq/core@${release}`;
const seedRootOf = (release: string) => `workbench/aih-core-${release}/`;
const SEED_ROOT = seedRootOf(RELEASE);
const OLD_SOURCE = `sha256:${"2".repeat(64)}`;
const NEW_SOURCE = `sha256:${"3".repeat(64)}`;
const PACK_LICENSE = `sha256:${"c".repeat(64)}`;
const ROOT_LICENSE = `sha256:${"e".repeat(64)}`;
const PUBLISHER = "f6189c0211fe27369fb15672f00da76c2072361c";

interface Subject {
  entryId: string;
  id: string;
  kind: string;
  assetId: string;
  componentId: string;
  material: Json;
  scope: Json;
  findings: Json[];
  evidenceProblems: Json[];
  previousRight: string;
}

const SUBJECTS: Subject[] = [
  {
    entryId: "agent.aih.governance-quality.core-0-6-2",
    id: "governance-quality",
    kind: "agent",
    assetId: "aih/package:skill-pack/governance-quality",
    componentId: `asset:${"a".repeat(64)}`,
    material: {
      files: [
        { digest: `sha256:${"b".repeat(64)}`, path: "aih-packs.json" },
        { digest: PACK_LICENSE, path: "packs/governance-quality/doctor/LICENSE" },
      ],
      kind: "source-files",
      treeDigest: `sha256:${"d".repeat(64)}`,
    },
    scope: { description: "Exact first-party pack files.", kind: "source-files" },
    findings: [],
    evidenceProblems: [{ code: "trust.detector-unavailable", detail: "skillspector: unavailable" }],
    previousRight: `Apache-2.0 notice packs/governance-quality/doctor/LICENSE sha256:${"c".repeat(64)} from frozen @aihq/core 0.6.0 applies to this Core-owned material; copied at Catalog-defaults path workbench/aih-core-0.6.2/source-reports/x-LICENSE.txt. This attribution record grants no trademark, external-service, or organization-admission rights.`,
  },
  {
    entryId: "mcp.aih.github.core-0-6-2",
    id: "github",
    kind: "mcp",
    assetId: "aih/github",
    componentId: `asset:${"f".repeat(64)}`,
    material: {
      declarationDigest: `sha256:${"4".repeat(64)}`,
      kind: "configuration-only",
      sourceInputDigest: NEW_SOURCE,
    },
    scope: { description: "Exact built-in declaration.", kind: "configuration-only" },
    findings: [
      {
        code: "trust.external-egress",
        detail: "REVIEW: declarations/claude/project/github.json:1",
        fingerprint: `trust-raw:${"5".repeat(64)}`,
        fingerprints: [`trust-raw:${"5".repeat(64)}`],
      },
      { code: "trust.hidden-unicode", detail: "declarations/claude/project/github.json:2" },
    ],
    evidenceProblems: [],
    previousRight: `Apache-2.0 notice LICENSE ${ROOT_LICENSE} from frozen @aihq/core 0.6.0 applies to this Core-owned material; copied at Catalog-defaults path workbench/aih-core-0.6.2/source-reports/core-LICENSE.txt. This attribution record grants no trademark, external-service, or organization-admission rights.`,
  },
];

/** A Core asset the new release declares and the previous release has no seed for. */
const SERENA: Subject = {
  entryId: "mcp.aih.serena.core-0-7-0",
  id: "serena",
  kind: "mcp",
  assetId: "aih/serena",
  componentId: `asset:${"6".repeat(64)}`,
  material: {
    declarationDigest: `sha256:${"7".repeat(64)}`,
    kind: "configuration-only",
    sourceInputDigest: NEW_SOURCE,
  },
  scope: { description: "Exact built-in declaration.", kind: "configuration-only" },
  findings: [],
  evidenceProblems: [],
  previousRight: "",
};

const catalogIdentity = {
  owner: "samartomar",
  pinnedCommit: "6".repeat(40),
  repository: "ai-harness",
  sourceTreeSha256: "7".repeat(64),
};
const publication = {
  authority: "none",
  publicationLocator: `https://github.com/samartomar/aih-scan/releases/download/baseline-v1-${PUBLISHER}-${"f".repeat(64)}/publication.json`,
  publicationSha256: "9".repeat(64),
  publishedAt: "2026-09-25T04:50:00.000Z",
  receiptSha256: "b".repeat(64),
  ref: "refs/heads/main",
  repository: "samartomar/aih-scan",
  requestSha256: "f".repeat(64),
  sourceCommit: PUBLISHER,
  workflow: "samartomar/aih-scan/.github/workflows/baseline-publication.yml",
};

const asset = (subject: Subject, release: string) => ({
  assetId: subject.assetId,
  contentDigest: `sha256:${sha(`${subject.assetId}@${release}`)}`,
  sourceId: "source:aih-core",
  sourceRevisionId: revisionOf(release),
});
const componentPath = (subject: Subject) => `declared/${subject.id}.json`;
const reportComponent = (subject: Subject) => ({
  analyzers: [{ name: "cisco", version: "1.0.0" }],
  evidenceProblems: subject.evidenceProblems,
  findings: subject.findings,
  id: subject.componentId,
  paths: [componentPath(subject)],
  treeSha256: sha(`${subject.componentId}:new`),
  verdict: subject.findings.length === 0 ? "no-findings" : "has-findings",
});
const observation = (subject: Subject, scan: "old" | "new") =>
  scan === "new"
    ? {
        componentId: subject.componentId,
        componentTreeSha256: sha(`${subject.componentId}:new`),
        publicationSha256: publication.publicationSha256,
        receiptSha256: publication.receiptSha256,
        reportComponentDigest: packagedReportComponentDigestV1(reportComponent(subject)),
        reportSignedAt: "2026-09-25T04:42:17.000Z",
        reportVerificationExpiresAt: "2026-09-25T05:27:17.000Z",
        requestSha256: publication.requestSha256,
      }
    : {
        componentId: subject.componentId,
        componentTreeSha256: "1".repeat(64),
        publicationSha256: "8".repeat(64),
        receiptSha256: "a".repeat(64),
        reportComponentDigest: `sha256:${"c".repeat(64)}`,
        reportSignedAt: "2026-09-09T09:46:59.000Z",
        reportVerificationExpiresAt: "2026-09-09T10:31:59.000Z",
        requestSha256: "e".repeat(64),
      };
const profile = (subject: Subject, scan: "old" | "new", material: Json, release: string) =>
  canonical({
    asset: asset(subject, release),
    compiler: { id: "built-in", inputFormat: "built-in/v1", version: "1" },
    format: "aih-first-party-qualification-profile",
    material,
    scanner: {
      catalog:
        scan === "old" ? { ...catalogIdentity, pinnedCommit: "5".repeat(40) } : catalogIdentity,
      component: { componentId: subject.componentId, paths: [componentPath(subject)] },
      observation: observation(subject, scan),
    },
    scope: subject.scope,
    subject: { id: subject.id, kind: subject.kind },
    version: 1,
  });

/** A sealed `packaged-scanner-collection-evidence/v2` record of the Core collection. */
function sealedRecord(
  subjects: Subject[],
  revisionId: string,
  catalogId = "aih",
  coverageDigestOf?: string,
) {
  const coverage = {
    authority: "none",
    components: subjects.map((subject) => ({
      componentId: subject.componentId,
      componentTreeSha256: sha(`${subject.componentId}:new`),
      files: [{ digest: `sha256:${sha(subject.id)}`, path: componentPath(subject) }],
      paths: [componentPath(subject)],
      subject:
        subject.assetId === coverageDigestOf
          ? { ...asset(subject, "other"), sourceRevisionId: revisionId }
          : asset(subject, revisionId.slice("package:@aihq/core@".length)),
    })),
    scope: "declared-source-files",
    unmappedDerivedAssets: [],
    version: "workbench-scanner-coverage/v1",
  };
  const body = {
    authority: "display-only",
    catalog: {
      ...catalogIdentity,
      coverageDigest: `sha256:${"0".repeat(64)}`,
      coverageProjectionDigest: packagedCoverageProjectionDigestV1(coverage),
      id: catalogId,
      source: {
        contentDigest: NEW_SOURCE,
        id: "source:aih-core",
        inputFormat: "built-in/v1",
        revisionId,
        upstreamOrigin: { kind: "aih", locator: "@aihq/core" },
      },
    },
    coverage,
    observations: subjects.map((subject) => observation(subject, "new")),
    publications: [publication],
    report: {
      components: subjects.map(reportComponent),
      id: catalogId,
      owner: catalogIdentity.owner,
      pinnedSha: catalogIdentity.pinnedCommit,
      repo: catalogIdentity.repository,
      sourceTreeSha256: catalogIdentity.sourceTreeSha256,
    },
    verification: { method: "gh-attestation-verify", preparedAt: "2026-09-25T06:27:56.221Z" },
    version: "packaged-scanner-collection-evidence/v2",
  };
  return canonical(body);
}

interface Options {
  release?: string;
  previousRelease?: string;
  recordRevision?: string;
  recordVersion?: string;
  changeMaterial?: (material: Json) => void;
  tamperRecord?: boolean;
  coverageDigestOf?: string;
  catalogRoot?: string;
  newSubjects?: Subject[];
  inputs?: Json;
  /** No Core seeds at all: the Catalog before the collection's initial release. */
  noPreviousSeeds?: boolean;
}

/**
 * A Catalog root with the current Core collection's seeds at the previous Scanner scan, a
 * sealed T2 record at the new scan, and the matching first-party qualification draft (plus
 * one profile the current release has no seed for).
 */
function fixture(options: Options = {}) {
  const root = mkdtempSync(join(tmpdir(), "aih-core-collection-seeds-"));
  temporaryRoots.push(root);
  const catalogRoot = options.catalogRoot ?? join(root, "catalog");
  const previousRelease = options.previousRelease ?? RELEASE;
  const release = options.release ?? previousRelease;
  const write = (path: string, text: string | Buffer) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  write(
    join(catalogRoot, "defaults", "catalog-collection-inputs-v1.json"),
    options.inputs === undefined
      ? canonical({
          collectedSourceTypes: ["aih"],
          collections: [
            {
              current: { origin: { kind: "catalog-authored" }, release: previousRelease },
              id: "aih-core",
              owner: { package: "@aihq/core" },
              seedRoot: SEED_ROOT,
              sourceType: "aih",
            },
          ],
          format: "aih-catalog-collection-inputs",
          version: 1,
        })
      : `${JSON.stringify(options.inputs, null, 2)}\n`,
  );
  const drafted = [...SUBJECTS, ...(options.newSubjects ?? [])];
  const revision = options.recordRevision ?? revisionOf(release);
  let bytes = sealedRecord(drafted, revision, "aih", options.coverageDigestOf);
  if (options.recordVersion !== undefined)
    bytes = bytes.replace("packaged-scanner-collection-evidence/v2", options.recordVersion);
  const recordPath = join(root, "collection-aih.json");
  write(
    recordPath,
    JSON.stringify({
      bytes: options.tamperRecord ? bytes.replace("display-only", "display-ONLY") : bytes,
      sha256: `sha256:${sha(bytes)}`,
    }),
  );
  const seedDirectory = join(catalogRoot, "defaults", ...SEED_ROOT.split("/"));
  const profiles: Json[] = [];
  const bindings: Json[] = [];
  for (const subject of drafted) {
    const newMaterial = structuredClone(subject.material);
    options.changeMaterial?.(newMaterial);
    if (SUBJECTS.includes(subject) && !options.noPreviousSeeds) {
      // The previous seed: the same subject and material at the previous scan.
      const oldMaterial =
        release === previousRelease
          ? subject.material
          : {
              ...subject.material,
              ...(subject.material.sourceInputDigest ? { sourceInputDigest: OLD_SOURCE } : {}),
            };
      const oldProfile = profile(subject, "old", oldMaterial, previousRelease);
      const directory = join(seedDirectory, subject.entryId);
      const source = {
        release: previousRelease,
        revision: `sha256:${sha(oldProfile)}`,
        type: "aih",
      };
      const sourceDigest = digest("aih-governance-decision-source/v2", source);
      const subjectDigest = digest("aih-governance-decision-subject/v2", {
        id: subject.id,
        kind: subject.kind,
        sourceDigest,
      });
      write(join(directory, "artifacts", "profile.json"), oldProfile);
      for (const name of ["closure.json", "recipe.json"])
        write(join(directory, "artifacts", name), canonical({ previous: name }));
      write(join(directory, "artifacts", "prose.md"), "Previous prose.\n");
      const evidence = (kind: string, id: string, summary: string) =>
        canonical({
          attestor: "operator:catalog-successor-preparation",
          format: "aih-supported-evidence/v2",
          id,
          kind,
          subjectDigest,
          summary,
        });
      write(
        join(directory, "evidence", "report.json"),
        evidence("report", "scanner-report", "Previous."),
      );
      write(
        join(directory, "evidence", "right-core-apache-2.0.json"),
        evidence("right", "core-apache-2.0", subject.previousRight),
      );
      write(
        join(directory, "evidence", "profile-scope-limit.json"),
        evidence("gap", "profile-scope-limit", "Previous."),
      );
      write(
        join(directory, "seed.json"),
        canonical({
          artifacts: {
            closure: "artifacts/closure.json",
            profile: "artifacts/profile.json",
            prose: "artifacts/prose.md",
            recipe: "artifacts/recipe.json",
          },
          capabilities: {
            commands: [],
            egress: subject.kind === "mcp" ? ["https://api.github.com"] : [],
            hooks: [],
            mcpTools: [],
            permissions: [],
          },
          entryId: subject.entryId,
          platforms: [{ architecture: "amd64", os: "linux" }],
          qualification: {
            findings: [],
            gaps: ["evidence/profile-scope-limit.json"],
            report: "evidence/report.json",
            rights: ["evidence/right-core-apache-2.0.json"],
          },
          subject: { id: subject.id, kind: subject.kind, source },
        }),
      );
    }
    // The draft: the subject at the new scan.
    const newProfile = profile(subject, "new", newMaterial, release);
    profiles.push({
      assetId: subject.assetId,
      bytesBase64: Buffer.from(newProfile).toString("base64"),
      sha256: `sha256:${sha(newProfile)}`,
    });
    const newSource = { release, revision: `sha256:${sha(newProfile)}`, type: "aih" };
    const newSourceDigest = digest("aih-governance-decision-source/v2", newSource);
    bindings.push({
      asset: asset(subject, release),
      compiler: { id: "built-in", inputFormat: "built-in/v1", version: "1" },
      format: "aih-compiler-qualification-binding",
      material: newMaterial,
      sourceContentDigest: NEW_SOURCE,
      subject: {
        id: subject.id,
        kind: subject.kind,
        source: newSource,
        sourceDigest: newSourceDigest,
        subjectDigest: digest("aih-governance-decision-subject/v2", {
          id: subject.id,
          kind: subject.kind,
          sourceDigest: newSourceDigest,
        }),
      },
      version: 1,
    });
  }
  if (options.newSubjects === undefined) {
    const unseeded = canonical({ asset: { assetId: "aih/serena" }, material: {} });
    profiles.push({
      assetId: "aih/serena",
      bytesBase64: Buffer.from(unseeded).toString("base64"),
      sha256: `sha256:${sha(unseeded)}`,
    });
  }
  if (!options.noPreviousSeeds)
    write(join(seedDirectory, "source-reports", "scanner-report.json"), "previous");
  const draftPath = join(root, "collection-aih.qualification-draft.json");
  write(
    draftPath,
    JSON.stringify({
      authority: "none",
      bindings,
      format: "aih-first-party-catalog-qualification-draft",
      profiles,
      purpose: "candidate-input-only",
      unsupported: [
        { assetId: "aih/usage-metering", reason: "unsupported-governance-subject-kind" },
      ],
      version: 1,
    }),
  );
  const packagePath = join(root, "core-package.json");
  write(packagePath, `${JSON.stringify({ name: "@aihq/core", version: release }, null, 2)}\n`);
  const outputRoot = join(root, "rendered");
  return {
    catalogRoot,
    recordPath,
    draftPath,
    outputRoot,
    packagePath,
    release,
    reader,
    bytes,
    bindings,
    profiles,
  };
}

/** Rewrites one draft profile, and re-binds it, to name another subject's Scanner component. */
function retarget(item: { draftPath: string }, from: Subject, to: Subject) {
  const draft = read(item.draftPath) as { profiles: Json[]; bindings: Json[] };
  const index = draft.profiles.findIndex((entry) => entry.assetId === from.assetId);
  const value = JSON.parse(
    Buffer.from(String(draft.profiles[index]?.bytesBase64), "base64").toString("utf8"),
  ) as { scanner: Json };
  value.scanner.component = { componentId: to.componentId, paths: [componentPath(to)] };
  value.scanner.observation = observation(to, "new");
  const bytes = canonical(value);
  draft.profiles[index] = {
    assetId: from.assetId,
    bytesBase64: Buffer.from(bytes).toString("base64"),
    sha256: `sha256:${sha(bytes)}`,
  };
  const binding = draft.bindings.find(
    (entry) => (entry.asset as Json).assetId === from.assetId,
  ) as { subject: Json };
  const source = { ...(binding.subject.source as Json), revision: `sha256:${sha(bytes)}` };
  const sourceDigest = digest("aih-governance-decision-source/v2", source);
  binding.subject = {
    ...binding.subject,
    source,
    sourceDigest,
    subjectDigest: digest("aih-governance-decision-subject/v2", {
      id: from.id,
      kind: from.kind,
      sourceDigest,
    }),
  };
  writeFileSync(item.draftPath, JSON.stringify(draft));
}

const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(directory, entry.name)).map((path) => `${entry.name}/${path}`)
      : [entry.name],
  );
const snapshot = (directory: string) =>
  Object.fromEntries(
    walk(directory).map((path) => [path, sha(readFileSync(join(directory, path)))]),
  );

describe("Core collection seed renderer", () => {
  it("re-renders every current seed and its source reports from the new record and draft", async () => {
    const api = await renderer();
    const item = fixture();
    const result = api.renderCoreCollectionSeedsV1(item);
    expect(result).toEqual({
      release: RELEASE,
      rendered: ["agent.aih.governance-quality.core-0-6-2", "mcp.aih.github.core-0-6-2"],
      unseeded: ["aih/serena"],
      unsupported: [
        { assetId: "aih/usage-metering", reason: "unsupported-governance-subject-kind" },
      ],
    });
    const out = item.outputRoot;
    // Source reports: the record verbatim, its exact sealed body, and the draft verbatim.
    expect(readFileSync(join(out, "source-reports", "verified-report-wrapper.json"))).toEqual(
      readFileSync(item.recordPath),
    );
    const scannerReport = readFileSync(join(out, "source-reports", "scanner-report.json"));
    expect(scannerReport.toString("utf8")).toBe(item.bytes);
    expect(readFileSync(join(out, "source-reports", "qualification-draft.json"))).toEqual(
      readFileSync(item.draftPath),
    );

    const governance = join(out, "agent.aih.governance-quality.core-0-6-2");
    const profileBytes = readFileSync(join(governance, "artifacts", "profile.json"));
    expect(profileBytes.toString("base64")).toBe(item.profiles[0]?.bytesBase64);
    const seed = read(join(governance, "seed.json")) as {
      subject: { source: { revision: string } };
      qualification: { gaps: string[]; rights: string[]; findings: string[] };
    };
    expect(seed.subject.source).toEqual({
      release: RELEASE,
      revision: `sha256:${sha(profileBytes)}`,
      type: "aih",
    });
    const closure = read(join(governance, "artifacts", "closure.json"));
    const binding = item.bindings[0] as { subject: { subjectDigest: string } };
    expect(closure.bindingDigest).toBe(digest("aih-compiler-qualification-binding/v1", binding));
    expect(closure.subjectDigest).toBe(binding.subject.subjectDigest);
    expect(closure.sourceContentDigest).toBe(NEW_SOURCE);
    expect(closure.files).toEqual(SUBJECTS[0]?.material.files);
    const recipe = read(join(governance, "artifacts", "recipe.json"));
    expect(recipe.scannerReportSha256).toBe(`sha256:${sha(scannerReport)}`);
    // An evidence problem is a label on incomplete evidence: carried as a gap, never cleared.
    expect(seed.qualification.gaps).toEqual([
      "evidence/evidence-problem-1.json",
      "evidence/profile-scope-limit.json",
    ]);
    expect(read(join(governance, "evidence", "evidence-problem-1.json")).summary).toContain(
      "Scanner evidence problem trust.detector-unavailable",
    );
    expect(read(join(governance, "evidence", "report.json")).summary).toContain(
      "Scanner label no-findings; findings 0; evidence problems 1;",
    );
    expect(read(join(governance, "evidence", "right-core-apache-2.0.json")).summary).toMatch(
      /^Apache-2\.0 notice packs\/governance-quality\/doctor\/LICENSE sha256:c{64} is part of this closure/,
    );

    const github = join(out, "mcp.aih.github.core-0-6-2");
    const githubSeed = read(join(github, "seed.json")) as {
      qualification: { gaps: string[]; rights: string[]; findings: string[] };
    };
    expect(githubSeed.qualification.findings).toEqual([
      "evidence/finding-1.json",
      "evidence/finding-2.json",
    ]);
    expect(read(join(github, "evidence", "finding-1.json")).summary).toContain(
      "Scanner finding trust.external-egress",
    );
    // A finding without a fingerprint is still carried.
    expect(read(join(github, "evidence", "finding-2.json")).summary).toContain(
      "Scanner finding trust.hidden-unicode",
    );
    expect(read(join(github, "evidence", "report.json")).summary).toContain(
      "Scanner label has-findings; findings 2; evidence problems 0;",
    );
    // The root LICENSE the previous row cited is not in a configuration-only closure (G21).
    expect(githubSeed.qualification.gaps).toEqual([
      "evidence/license-gap.json",
      "evidence/profile-scope-limit.json",
    ]);
    expect(read(join(github, "evidence", "license-gap.json")).summary).toContain(
      `License not determined: the previous row's Apache-2.0 notice LICENSE sha256:${"e".repeat(64)} is not in this closure.`,
    );
    // Generated prose surfaces facts; it never labels a component with an outcome.
    for (const path of walk(out).filter((path) => !path.startsWith("source-reports/")))
      expect(readFileSync(join(out, path), "utf8"), path).not.toMatch(
        /blocked|failing|not authorized/i,
      );
  });

  it("reads only packaged-scanner-collection-evidence/v2 records, through the Catalog's v2 reader", async () => {
    const api = await renderer();
    const v1 = fixture({ recordVersion: "packaged-scanner-collection-evidence/v1" });
    expect(() => api.renderCoreCollectionSeedsV1(v1)).toThrow("core-collection-renderer:record");
    expect(existsSync(v1.outputRoot)).toBe(false);
    // A reader that accepts another version is refused, not trusted.
    const lenient = fixture();
    const stale = {
      ...reader,
      parsePackagedScannerCollectionEvidenceV1: (value: unknown) =>
        reader
          .parsePackagedScannerCollectionEvidenceV1(value)
          .map((record) => ({ ...record, version: "packaged-scanner-collection-evidence/v1" })),
    } as unknown as Reader;
    expect(() => api.renderCoreCollectionSeedsV1({ ...lenient, reader: stale })).toThrow(
      "core-collection-renderer:record-version",
    );
  });

  it("refuses a component whose material digests differ from its seed's profile", async () => {
    const api = await renderer();
    const item = fixture({
      changeMaterial: (material) => {
        if (material.kind === "configuration-only")
          material.declarationDigest = `sha256:${"0".repeat(64)}`;
      },
    });
    expect(() => api.renderCoreCollectionSeedsV1(item)).toThrow(
      "core-collection-renderer:material-changed aih/github (declarationDigest)",
    );
    expect(existsSync(item.outputRoot)).toBe(false);
  });

  it("refuses a Scanner component the record's coverage does not bind to the profile's asset", async () => {
    const api = await renderer();
    const [quality, github] = SUBJECTS as [Subject, Subject];
    // The record binds github's component to another content digest than the profile's asset.
    const other = fixture({ coverageDigestOf: github.assetId });
    expect(() => api.renderCoreCollectionSeedsV1(other)).toThrow(
      "core-collection-renderer:scanner-coverage aih/github",
    );
    expect(existsSync(other.outputRoot)).toBe(false);
    // A draft profile naming another asset's component is a changed Scanner binding.
    const crafted = fixture();
    retarget(crafted, quality, github);
    expect(() => api.renderCoreCollectionSeedsV1(crafted)).toThrow(
      `core-collection-renderer:material-changed ${quality.assetId} (scanner.component)`,
    );
    expect(existsSync(crafted.outputRoot)).toBe(false);
  });

  it("refuses a seed the draft does not profile, and a binding that does not bind the draft profile", async () => {
    const api = await renderer();
    const absent = fixture();
    const draft = read(absent.draftPath) as { profiles: Json[]; bindings: Json[] };
    writeFileSync(
      absent.draftPath,
      JSON.stringify({
        ...draft,
        profiles: draft.profiles.filter((p) => p.assetId !== "aih/github"),
      }),
    );
    expect(() => api.renderCoreCollectionSeedsV1(absent)).toThrow(
      "core-collection-renderer:material-changed aih/github (absent from the draft)",
    );
    const unbound = fixture();
    const next = read(unbound.draftPath) as { bindings: { subject: { id: string } }[] };
    (next.bindings[1] as { subject: { id: string } }).subject.id = "gitlab";
    writeFileSync(unbound.draftPath, JSON.stringify(next));
    expect(() => api.renderCoreCollectionSeedsV1(unbound)).toThrow(
      "core-collection-renderer:binding aih/github",
    );
    expect(existsSync(unbound.outputRoot)).toBe(false);
  });

  it("refuses a record or seeds for another release than current.release", async () => {
    const api = await renderer();
    const record = fixture({ recordRevision: "package:@aihq/core@0.6.3" });
    expect(() => api.renderCoreCollectionSeedsV1(record)).toThrow(
      "core-collection-renderer:release",
    );
    // The inputs and the record name 0.6.3 while the seeds are 0.6.2.
    const inputs = fixture({ release: "0.6.3" });
    writeFileSync(
      join(inputs.catalogRoot, "defaults", "catalog-collection-inputs-v1.json"),
      canonical({
        collectedSourceTypes: ["aih"],
        collections: [
          {
            current: { origin: { kind: "catalog-authored" }, release: "0.6.3" },
            id: "aih-core",
            owner: { package: "@aihq/core" },
            seedRoot: SEED_ROOT,
            sourceType: "aih",
          },
        ],
        format: "aih-catalog-collection-inputs",
        version: 1,
      }),
    );
    expect(() => api.renderCoreCollectionSeedsV1(inputs)).toThrow(
      "core-collection-renderer:release",
    );
  });

  it("refuses a record whose bytes do not match its seal, and an existing output", async () => {
    const api = await renderer();
    const tampered = fixture({ tamperRecord: true });
    expect(() => api.renderCoreCollectionSeedsV1(tampered)).toThrow(
      "core-collection-renderer:record",
    );
    const existing = fixture();
    mkdirSync(existing.outputRoot);
    expect(() => api.renderCoreCollectionSeedsV1(existing)).toThrow(
      "core-collection-renderer:output-exists",
    );
  });
});

/** A scratch Catalog root holding a copy of this checkout's package.json and defaults/. */
function wholeCatalog() {
  const scratch = mkdtempSync(join(tmpdir(), "aih-core-collection-release-"));
  temporaryRoots.push(scratch);
  const catalogRoot = join(scratch, "catalog");
  mkdirSync(catalogRoot);
  cpSync(join(repository, "package.json"), join(catalogRoot, "package.json"));
  cpSync(join(repository, "defaults"), join(catalogRoot, "defaults"), { recursive: true });
  return catalogRoot;
}

/** Each generated view of `catalogRoot`, from its own generator, in dependency order. */
const VIEWS = [
  [
    "catalog-index-v1.json",
    (gen: Generators, root: string) =>
      gen.index.serializeCatalogIndex(gen.index.generateCatalogIndex(root)),
  ],
  [
    "catalog-collections-v1.json",
    (gen: Generators, root: string) =>
      gen.collections.serializeCatalogCollections(gen.collections.generateCatalogCollections(root)),
  ],
  [
    "catalog-runtime-descriptors-v1.json",
    (gen: Generators, root: string) =>
      gen.runtime.serializeCatalogRuntimeDescriptors(
        gen.runtime.generateCatalogRuntimeDescriptors(root),
      ),
  ],
  [
    "catalog-categories-v1.json",
    (gen: Generators, root: string) =>
      gen.categories.serializeCatalogCategories(gen.categories.generateCatalogCategories(root)),
  ],
] as const;
function regenerateViews(gen: Generators, catalogRoot: string) {
  for (const [path, generate] of VIEWS)
    writeFileSync(join(catalogRoot, "defaults", path), generate(gen, catalogRoot));
}

describe("Core collection seed renderer, new-release mode", () => {
  const nextRelease = (options: Options = {}) =>
    fixture({ release: NEXT, previousRelease: RELEASE, newSubjects: [SERENA], ...options });

  it("refuses the current release, a record of another release, and a package of another version", async () => {
    const api = await renderer();
    const same = fixture();
    const before = snapshot(same.catalogRoot);
    expect(() => api.renderCoreCollectionNewReleaseV1({ ...same, release: RELEASE })).toThrow(
      "core-collection-renderer:new-release-is-current",
    );

    // A release is newer than the current one by semver precedence; downgrades are refused.
    for (const older of ["0.5.0", "0.6.1", "0.6.2-rc.1"]) {
      const downgrade = nextRelease({ release: older });
      expect(() => api.renderCoreCollectionNewReleaseV1(downgrade)).toThrow(
        `core-collection-renderer:new-release-not-newer ${older} ${RELEASE}`,
      );
    }
    // Numeric, not lexical: 0.6.10 is newer than 0.6.2 (it stops later, at the fixture's manifest).
    expect(() =>
      api.renderCoreCollectionNewReleaseV1(nextRelease({ release: "0.6.10" })),
    ).not.toThrow("new-release-not-newer");

    const other = nextRelease({ recordRevision: revisionOf("0.7.1") });
    expect(() => api.renderCoreCollectionNewReleaseV1(other)).toThrow(
      "core-collection-renderer:release",
    );
    const unlabeled = nextRelease({ recordRevision: "package:@aihq/core" });
    expect(() => api.renderCoreCollectionNewReleaseV1(unlabeled)).toThrow(
      "core-collection-renderer:release",
    );

    const version = nextRelease();
    writeFileSync(version.packagePath, JSON.stringify({ name: "@aihq/core", version: "0.7.1" }));
    expect(() => api.renderCoreCollectionNewReleaseV1(version)).toThrow(
      "core-collection-renderer:package-version",
    );
    for (const item of [same, other, unlabeled, version]) {
      expect(existsSync(join(item.catalogRoot, "defaults", "workbench", "aih-core-0.7.0"))).toBe(
        false,
      );
    }
    expect(snapshot(same.catalogRoot)).toEqual(before);
  });

  it("refuses a draft profile naming another asset's Scanner component, with its observation copied", async () => {
    const api = await renderer();
    const [quality, github] = SUBJECTS as [Subject, Subject];
    const crafted = nextRelease();
    retarget(crafted, quality, github);
    const before = snapshot(crafted.catalogRoot);
    expect(() => api.renderCoreCollectionNewReleaseV1(crafted)).toThrow(
      `core-collection-renderer:scanner-coverage ${quality.assetId}`,
    );
    expect(snapshot(crafted.catalogRoot)).toEqual(before);
  });

  it("writes nothing when a binding does not verify or a temporary file is left over", async () => {
    const api = await renderer();
    const unbound = nextRelease();
    const next = read(unbound.draftPath) as { bindings: { subject: { id: string } }[] };
    (next.bindings[2] as { subject: { id: string } }).subject.id = "serena-2";
    writeFileSync(unbound.draftPath, JSON.stringify(next));
    const before = snapshot(unbound.catalogRoot);
    expect(() => api.renderCoreCollectionNewReleaseV1(unbound)).toThrow(
      "core-collection-renderer:binding aih/serena",
    );
    expect(snapshot(unbound.catalogRoot)).toEqual(before);

    // A temporary file a killed run left beside a view is named, not overwritten.
    const leftover = nextRelease();
    writeFileSync(join(leftover.catalogRoot, "defaults", "catalog-index-v1.json.tmp"), "partial");
    const withLeftover = snapshot(leftover.catalogRoot);
    expect(() => api.renderCoreCollectionNewReleaseV1(leftover)).toThrow(
      new TypeError(
        "core-collection-renderer:leftover-temporary defaults/catalog-index-v1.json.tmp",
      ),
    );
    expect(snapshot(leftover.catalogRoot)).toEqual(withLeftover);
  });

  it("names the partial tree an interrupted run left, before and after current.release moved", async () => {
    const api = await renderer();
    // Interrupted after the new tree was written, before the seed manifest was replaced.
    const tree = nextRelease();
    const nextTree = join(tree.catalogRoot, "defaults", "workbench", "aih-core-0.7.0");
    mkdirSync(join(nextTree, "mcp.aih.serena.core-0-7-0"), { recursive: true });
    const before = snapshot(tree.catalogRoot);
    expect(() => api.renderCoreCollectionNewReleaseV1(tree)).toThrow(
      new TypeError(
        "core-collection-renderer:partial-release defaults/workbench/aih-core-0.7.0/ (current.release 0.6.2; seed manifest not updated)",
      ),
    );
    expect(snapshot(tree.catalogRoot)).toEqual(before);

    // Interrupted after the seed manifest was replaced, before the collection inputs were.
    const manifest = nextRelease();
    mkdirSync(join(manifest.catalogRoot, "defaults", "workbench", "aih-core-0.7.0"));
    writeFileSync(
      join(manifest.catalogRoot, "defaults", "default-catalog-seed-manifest-v2.json"),
      canonical({
        format: "aih-supported-candidate-seed-manifest",
        seeds: ["workbench/aih-core-0.7.0/mcp.aih.serena.core-0-7-0/seed.json"],
        version: 1,
      }),
    );
    expect(() => api.renderCoreCollectionNewReleaseV1(manifest)).toThrow(
      new TypeError(
        "core-collection-renderer:partial-release defaults/workbench/aih-core-0.7.0/ (current.release 0.6.2; seed manifest updated)",
      ),
    );

    // Interrupted after current.release moved to 0.7.0, before the previous tree was removed.
    const moved = nextRelease({
      inputs: {
        collectedSourceTypes: ["aih"],
        collections: [
          {
            current: { origin: { kind: "catalog-authored" }, release: NEXT },
            id: "aih-core",
            owner: { package: "@aihq/core" },
            seedRoot: seedRootOf(NEXT),
            sourceType: "aih",
          },
        ],
        format: "aih-catalog-collection-inputs",
        version: 1,
      },
    });
    expect(() => api.renderCoreCollectionNewReleaseV1(moved)).toThrow(
      new TypeError(
        "core-collection-renderer:partial-release defaults/workbench/aih-core-0.6.2/ (current.release 0.7.0; previous tree not removed)",
      ),
    );
  });

  it("renders the new release from the record and draft, removes the previous release through the generators, and moves current.release", async () => {
    const api = await renderer();
    const gen = await generators();
    // A scratch Catalog root: the real defaults plus a synthetic 0.6.2 Core collection and its
    // seeds, so every generator runs over a whole Catalog. (K1 itself has no Core collection;
    // its initial release is the initial-release mode below.)
    const catalogRoot = wholeCatalog();
    const inputs = read(join(repository, "defaults", "catalog-collection-inputs-v1.json")) as {
      collections: Json[];
    };
    inputs.collections = [
      {
        id: "aih-core",
        owner: { package: "@aihq/core" },
        sourceType: "aih",
        current: { release: RELEASE, origin: { kind: "catalog-authored" } },
        seedRoot: SEED_ROOT,
      },
      ...inputs.collections.filter((collection) => collection.id !== "aih-core"),
    ];
    const item = nextRelease({ catalogRoot, inputs });
    const manifestPath = join(catalogRoot, "defaults", "default-catalog-seed-manifest-v2.json");
    const manifest = read(manifestPath) as { seeds: string[] };
    manifest.seeds = [
      ...manifest.seeds.filter((path) => !path.startsWith(SEED_ROOT)),
      ...SUBJECTS.map((subject) => `${SEED_ROOT}${subject.entryId}/seed.json`),
    ].sort();
    writeFileSync(manifestPath, canonical(manifest));
    regenerateViews(gen, catalogRoot);

    // A generator that refuses leaves the Catalog root exactly as it was.
    const rulesPath = join(catalogRoot, "defaults", "catalog-categories-rules-v1.json");
    const rules = readFileSync(rulesPath);
    writeFileSync(rulesPath, "{}");
    const before = snapshot(join(catalogRoot, "defaults"));
    expect(() => api.renderCoreCollectionNewReleaseV1(item)).toThrow("catalog-categories");
    expect(snapshot(join(catalogRoot, "defaults"))).toEqual(before);
    writeFileSync(rulesPath, rules);

    const result = api.renderCoreCollectionNewReleaseV1(item);
    expect(result).toEqual({
      mode: "new-release",
      previousRelease: RELEASE,
      release: NEXT,
      seedRoot: "workbench/aih-core-0.7.0/",
      rendered: [
        "agent.aih.governance-quality.core-0-7-0",
        "mcp.aih.github.core-0-7-0",
        "mcp.aih.serena.core-0-7-0",
      ],
      added: ["aih/serena"],
      retired: [],
      removed: ["agent.aih.governance-quality.core-0-6-2", "mcp.aih.github.core-0-6-2"],
      unsupported: [
        { assetId: "aih/usage-metering", reason: "unsupported-governance-subject-kind" },
      ],
      written: [
        "defaults/catalog-categories-v1.json",
        "defaults/catalog-collection-inputs-v1.json",
        "defaults/catalog-collections-v1.json",
        "defaults/catalog-index-v1.json",
        "defaults/catalog-runtime-descriptors-v1.json",
        "defaults/default-catalog-seed-manifest-v2.json",
      ],
    });
    const defaults = join(catalogRoot, "defaults");
    // The previous release's tree is gone; the new one holds the rendered seeds.
    expect(existsSync(join(defaults, ...SEED_ROOT.split("/")))).toBe(false);
    const next = join(defaults, "workbench", "aih-core-0.7.0");
    expect(readdirSync(next).sort()).toEqual([...result.rendered, "source-reports"]);
    expect(readFileSync(join(next, "source-reports", "scanner-report.json"), "utf8")).toBe(
      item.bytes,
    );
    // Profiles verbatim; the carried subject keeps its capabilities and platforms.
    const github = join(next, "mcp.aih.github.core-0-7-0");
    expect(readFileSync(join(github, "artifacts", "profile.json")).toString("base64")).toBe(
      item.profiles[1]?.bytesBase64,
    );
    const githubSeed = read(join(github, "seed.json")) as {
      capabilities: { egress: string[] };
      entryId: string;
      subject: { source: Json };
    };
    expect(githubSeed.entryId).toBe("mcp.aih.github.core-0-7-0");
    expect(githubSeed.capabilities.egress).toEqual(["https://api.github.com"]);
    expect(githubSeed.subject.source).toEqual({
      release: NEXT,
      revision: item.profiles[1]?.sha256,
      type: "aih",
    });
    // A new asset carries no capability and the Catalog-wide linux/amd64 platform.
    const serena = read(join(next, "mcp.aih.serena.core-0-7-0", "seed.json")) as {
      capabilities: Json;
      platforms: Json[];
      qualification: { gaps: string[] };
    };
    expect(serena.capabilities).toEqual({
      commands: [],
      egress: [],
      hooks: [],
      mcpTools: [],
      permissions: [],
    });
    expect(serena.platforms).toEqual([{ architecture: "amd64", os: "linux" }]);
    expect(
      read(join(next, "mcp.aih.serena.core-0-7-0", "evidence", "license-gap.json")).summary,
    ).toContain("License not determined: no previous release row exists for this asset.");
    // G21 as today: the pack's LICENSE is in its closure.
    expect(
      read(
        join(
          next,
          "agent.aih.governance-quality.core-0-7-0",
          "evidence",
          "right-core-apache-2.0.json",
        ),
      ).summary,
    ).toContain("is part of this closure");
    for (const path of walk(next).filter((path) => !path.startsWith("source-reports/")))
      expect(readFileSync(join(next, path), "utf8"), path).not.toMatch(
        /blocked|failing|not authorized/i,
      );

    // The inputs move to the new release, identified from the stated package.
    const nextInputs = read(join(defaults, "catalog-collection-inputs-v1.json")) as {
      collections: Json[];
    };
    expect(nextInputs.collections.find((collection) => collection.id === "aih-core")).toEqual({
      current: {
        origin: {
          kind: "package-file",
          name: "@aihq/core",
          sha256: sha(readFileSync(item.packagePath)),
          version: NEXT,
        },
        release: NEXT,
      },
      id: "aih-core",
      owner: { package: "@aihq/core" },
      seedRoot: "workbench/aih-core-0.7.0/",
      sourceType: "aih",
    });
    // Every generated view names the new ids and none of the previous ones, and is current.
    const nextManifest = read(manifestPath) as { seeds: string[] };
    expect(nextManifest.seeds.filter((path) => path.includes("aih-core-"))).toEqual(
      result.rendered.map((entryId) => `workbench/aih-core-0.7.0/${entryId}/seed.json`),
    );
    const index = readFileSync(join(defaults, "catalog-index-v1.json"), "utf8");
    expect(index).not.toContain("core-0-6-2");
    expect(index).toContain("mcp.aih.serena.core-0-7-0");
    expect(index).toBe(
      gen.index.serializeCatalogIndex(gen.index.generateCatalogIndex(catalogRoot)),
    );
    expect(readFileSync(join(defaults, "catalog-collections-v1.json"), "utf8")).toBe(
      gen.collections.serializeCatalogCollections(
        gen.collections.generateCatalogCollections(catalogRoot),
      ),
    );
    expect(readFileSync(join(defaults, "catalog-runtime-descriptors-v1.json"), "utf8")).toBe(
      gen.runtime.serializeCatalogRuntimeDescriptors(
        gen.runtime.generateCatalogRuntimeDescriptors(catalogRoot),
      ),
    );
    const categories = readFileSync(join(defaults, "catalog-categories-v1.json"), "utf8");
    expect(categories).not.toContain("core-0-6-2");
    expect(categories).toBe(
      gen.categories.serializeCatalogCategories(
        gen.categories.generateCatalogCategories(catalogRoot),
      ),
    );
  }, 240_000);
});

// D57 part 2 starts from K1: after part 1 the Catalog carries no Core collection, so the first
// Core release is created, not moved to. Every binding check of new-release mode applies.
describe("Core collection seed renderer, initial-release mode", () => {
  const K1_INPUTS = read(join(repository, "defaults", "catalog-collection-inputs-v1.json"));
  const initial = (options: Options = {}) =>
    fixture({
      release: NEXT,
      previousRelease: NEXT,
      newSubjects: [SERENA],
      noPreviousSeeds: true,
      inputs: K1_INPUTS,
      ...options,
    });

  it("refuses a record of another release, a package of another version, an unbound Scanner component and an existing collection, writing nothing", async () => {
    const api = await renderer();
    const [quality, github] = SUBJECTS as [Subject, Subject];
    const cases: [ReturnType<typeof fixture>, string][] = [];
    cases.push([
      initial({ recordRevision: revisionOf("0.7.1") }),
      "core-collection-renderer:release",
    ]);
    const version = initial();
    writeFileSync(version.packagePath, JSON.stringify({ name: "@aihq/core", version: "0.7.1" }));
    cases.push([version, "core-collection-renderer:package-version"]);
    // The record's coverage, not the draft, binds a component to the profile's asset (6168694).
    cases.push([
      initial({ coverageDigestOf: quality.assetId }),
      `core-collection-renderer:scanner-coverage ${quality.assetId}`,
    ]);
    const crafted = initial();
    retarget(crafted, quality, github);
    cases.push([crafted, `core-collection-renderer:scanner-coverage ${quality.assetId}`]);
    const unbound = initial();
    const draft = read(unbound.draftPath) as { bindings: { subject: { id: string } }[] };
    (draft.bindings[2] as { subject: { id: string } }).subject.id = "serena-2";
    writeFileSync(unbound.draftPath, JSON.stringify(draft));
    cases.push([unbound, "core-collection-renderer:binding aih/serena"]);
    // A Catalog that already has a Core collection moves it with --new-release instead.
    cases.push([
      initial({ inputs: undefined }),
      "core-collection-renderer:initial-collection-exists current.release 0.7.0; use --new-release",
    ]);
    for (const [item, message] of cases) {
      const before = snapshot(item.catalogRoot);
      expect(() => api.renderCoreCollectionInitialReleaseV1(item)).toThrow(message);
      expect(snapshot(item.catalogRoot)).toEqual(before);
    }
  });

  it("names a Core seed tree or seed path it finds, since none may exist without the collection", async () => {
    const api = await renderer();
    const tree = initial();
    mkdirSync(join(tree.catalogRoot, "defaults", "workbench", "aih-core-0.7.0", "x"), {
      recursive: true,
    });
    const before = snapshot(tree.catalogRoot);
    expect(() => api.renderCoreCollectionInitialReleaseV1(tree)).toThrow(
      new TypeError(
        "core-collection-renderer:partial-release defaults/workbench/aih-core-0.7.0/ (no current release; seed manifest not updated)",
      ),
    );
    expect(snapshot(tree.catalogRoot)).toEqual(before);

    const listed = initial();
    writeFileSync(
      join(listed.catalogRoot, "defaults", "default-catalog-seed-manifest-v2.json"),
      canonical({
        format: "aih-supported-candidate-seed-manifest",
        seeds: ["workbench/aih-core-0.6.2/mcp.aih.github.core-0-6-2/seed.json"],
        version: 1,
      }),
    );
    expect(() => api.renderCoreCollectionInitialReleaseV1(listed)).toThrow(
      new TypeError(
        "core-collection-renderer:initial-manifest-seeds workbench/aih-core-0.6.2/mcp.aih.github.core-0-6-2/seed.json",
      ),
    );
  });

  it("creates the Core collection at 0.7.0 over a copy of K1's defaults, all-or-nothing through the generators", async () => {
    const api = await renderer();
    const gen = await generators();
    // K1's actual layout: the collection inputs without aih-core, and no Core seed tree.
    const catalogRoot = wholeCatalog();
    const defaults = join(catalogRoot, "defaults");
    expect((K1_INPUTS.collections as Json[]).map((collection) => collection.id)).not.toContain(
      "aih-core",
    );
    expect(
      readdirSync(join(defaults, "workbench")).filter((name) => name.startsWith("aih-core-")),
    ).toEqual([]);
    const item = initial({ catalogRoot });
    const inputsPath = join(defaults, "catalog-collection-inputs-v1.json");
    expect(readFileSync(inputsPath, "utf8")).toBe(
      readFileSync(join(repository, "defaults", "catalog-collection-inputs-v1.json"), "utf8"),
    );
    // The review's scenario: new-release mode cannot start here.
    expect(() => api.renderCoreCollectionNewReleaseV1(item)).toThrow(
      "core-collection-renderer:inputs-collection",
    );

    // A generator that refuses leaves the Catalog root exactly as it was.
    const rulesPath = join(defaults, "catalog-categories-rules-v1.json");
    const rules = readFileSync(rulesPath);
    writeFileSync(rulesPath, "{}");
    const before = snapshot(defaults);
    expect(() => api.renderCoreCollectionInitialReleaseV1(item)).toThrow("catalog-categories");
    expect(snapshot(defaults)).toEqual(before);
    writeFileSync(rulesPath, rules);

    const manifestPath = join(defaults, "default-catalog-seed-manifest-v2.json");
    const previousManifest = read(manifestPath) as { seeds: string[] };
    const result = api.renderCoreCollectionInitialReleaseV1(item);
    expect(result).toEqual({
      mode: "initial-release",
      previousRelease: null,
      release: NEXT,
      seedRoot: "workbench/aih-core-0.7.0/",
      rendered: [
        "agent.aih.governance-quality.core-0-7-0",
        "mcp.aih.github.core-0-7-0",
        "mcp.aih.serena.core-0-7-0",
      ],
      added: ["aih/github", "aih/package:skill-pack/governance-quality", "aih/serena"],
      retired: [],
      removed: [],
      unsupported: [
        { assetId: "aih/usage-metering", reason: "unsupported-governance-subject-kind" },
      ],
      written: [
        "defaults/catalog-categories-v1.json",
        "defaults/catalog-collection-inputs-v1.json",
        "defaults/catalog-collections-v1.json",
        "defaults/catalog-index-v1.json",
        "defaults/catalog-runtime-descriptors-v1.json",
        "defaults/default-catalog-seed-manifest-v2.json",
      ],
    });
    const next = join(defaults, "workbench", "aih-core-0.7.0");
    expect(readdirSync(next).sort()).toEqual([...result.rendered, "source-reports"]);
    expect(readFileSync(join(next, "source-reports", "scanner-report.json"), "utf8")).toBe(
      item.bytes,
    );
    // No previous rows: every subject is new, with no capability, the Catalog-wide platform and
    // a license gap; nothing is carried.
    for (const entryId of result.rendered) {
      const seed = read(join(next, entryId, "seed.json")) as {
        capabilities: Json;
        platforms: Json[];
        subject: { source: Json };
      };
      expect(seed.capabilities).toEqual({
        commands: [],
        egress: [],
        hooks: [],
        mcpTools: [],
        permissions: [],
      });
      expect(seed.platforms).toEqual([{ architecture: "amd64", os: "linux" }]);
      expect(seed.subject.source.release).toBe(NEXT);
      expect(read(join(next, entryId, "evidence", "license-gap.json")).summary).toContain(
        "License not determined: no previous release row exists for this asset.",
      );
    }
    // The collection enters the inputs in id order; the other collections are untouched.
    const nextInputs = read(inputsPath) as { collections: Json[] };
    expect(nextInputs).toEqual({
      ...K1_INPUTS,
      collections: [
        {
          id: "aih-core",
          owner: { package: "@aihq/core" },
          sourceType: "aih",
          current: {
            release: NEXT,
            origin: {
              kind: "package-file",
              name: "@aihq/core",
              sha256: sha(readFileSync(item.packagePath)),
              version: NEXT,
            },
          },
          seedRoot: "workbench/aih-core-0.7.0/",
        },
        ...(K1_INPUTS.collections as Json[]),
      ],
    });
    // The seed manifest gains exactly the new seeds; every view is current.
    const nextManifest = read(manifestPath) as { seeds: string[] };
    expect(nextManifest.seeds).toEqual(
      [
        ...previousManifest.seeds,
        ...result.rendered.map((entryId) => `workbench/aih-core-0.7.0/${entryId}/seed.json`),
      ].sort(),
    );
    for (const [path, generate] of VIEWS)
      expect(readFileSync(join(defaults, path), "utf8"), path).toBe(generate(gen, catalogRoot));
    expect(readFileSync(join(defaults, "catalog-index-v1.json"), "utf8")).toContain(
      "mcp.aih.serena.core-0-7-0",
    );

    // Created once: a second initial run is refused and writes nothing; the next release moves it.
    const after = snapshot(defaults);
    expect(() => api.renderCoreCollectionInitialReleaseV1(item)).toThrow(
      "core-collection-renderer:initial-collection-exists current.release 0.7.0; use --new-release",
    );
    expect(snapshot(defaults)).toEqual(after);
  }, 240_000);
});
