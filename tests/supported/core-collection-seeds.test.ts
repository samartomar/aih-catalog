import { createHash } from "node:crypto";
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
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Json = Record<string, unknown>;
type Renderer = {
  renderCoreCollectionSeedsV1(input: {
    catalogRoot: string;
    recordPath: string;
    draftPath: string;
    outputRoot: string;
  }): {
    release: string;
    rendered: string[];
    unseeded: string[];
    unsupported: Json[];
  };
};

async function renderer(): Promise<Renderer> {
  // @ts-expect-error The maintenance renderer is intentionally plain ESM JavaScript.
  return (await import("../../tools/render-core-collection-seeds.mjs")) as Renderer;
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

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

const RELEASE = "0.6.2";
const REVISION = `package:@aihq/core@${RELEASE}`;
const SEED_ROOT = "workbench/aih-core-0.6.2/";
const NEW_SOURCE = `sha256:${"3".repeat(64)}`;
const PACK_LICENSE = `sha256:${"c".repeat(64)}`;
const ROOT_LICENSE = `sha256:${"e".repeat(64)}`;

interface Subject {
  entryId: string;
  id: string;
  kind: string;
  assetId: string;
  componentId: string;
  material: Json;
  scope: Json;
  findings: Json[];
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
    ],
    previousRight: `Apache-2.0 notice LICENSE ${ROOT_LICENSE} from frozen @aihq/core 0.6.0 applies to this Core-owned material; copied at Catalog-defaults path workbench/aih-core-0.6.2/source-reports/core-LICENSE.txt. This attribution record grants no trademark, external-service, or organization-admission rights.`,
  },
];

interface Options {
  release?: string;
  recordRevision?: string;
  changeMaterial?: (material: Json) => void;
  tamperRecord?: boolean;
}

/**
 * A Catalog root with the current Core collection's seeds at the previous Scanner scan, a
 * sealed T2 record at the new scan, and the matching first-party qualification draft (plus
 * one profile the current release has no seed for).
 */
function fixture(options: Options = {}) {
  const root = mkdtempSync(join(tmpdir(), "aih-core-collection-seeds-"));
  temporaryRoots.push(root);
  const catalogRoot = join(root, "catalog");
  const write = (path: string, text: string | Buffer) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  write(
    join(catalogRoot, "defaults", "catalog-collection-inputs-v1.json"),
    canonical({
      collectedSourceTypes: ["aih"],
      collections: [
        {
          current: {
            origin: { kind: "catalog-authored" },
            release: options.release ?? RELEASE,
          },
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
  const newCatalog = {
    owner: "samartomar",
    pinnedCommit: "6".repeat(40),
    repository: "ai-harness",
    sourceTreeSha256: "7".repeat(64),
  };
  const observation = (subject: Subject, scan: "old" | "new") => ({
    componentId: subject.componentId,
    componentTreeSha256: (scan === "old" ? "1" : "2").repeat(64),
    publicationSha256: (scan === "old" ? "8" : "9").repeat(64),
    receiptSha256: (scan === "old" ? "a" : "b").repeat(64),
    reportComponentDigest: `sha256:${(scan === "old" ? "c" : "d").repeat(64)}`,
    reportSignedAt: scan === "old" ? "2026-09-09T09:46:59.000Z" : "2026-09-25T04:42:17.000Z",
    reportVerificationExpiresAt:
      scan === "old" ? "2026-09-09T10:31:59.000Z" : "2026-09-25T05:27:17.000Z",
    requestSha256: (scan === "old" ? "e" : "f").repeat(64),
  });
  const asset = (subject: Subject) => ({
    assetId: subject.assetId,
    contentDigest: `sha256:${sha(subject.assetId)}`,
    sourceId: "source:aih-core",
    sourceRevisionId: REVISION,
  });
  const profile = (subject: Subject, scan: "old" | "new", material: Json) =>
    canonical({
      asset: asset(subject),
      compiler: { id: "built-in", inputFormat: "built-in/v1", version: "1" },
      format: "aih-first-party-qualification-profile",
      material,
      scanner: {
        catalog: scan === "old" ? { ...newCatalog, pinnedCommit: "5".repeat(40) } : newCatalog,
        component: { componentId: subject.componentId, paths: ["declared"] },
        observation: observation(subject, scan),
      },
      scope: subject.scope,
      subject: { id: subject.id, kind: subject.kind },
      version: 1,
    });
  const seedDirectory = join(catalogRoot, "defaults", ...SEED_ROOT.split("/"));
  const body = {
    authority: "display-only",
    catalog: {
      ...newCatalog,
      id: "aih",
      source: {
        contentDigest: NEW_SOURCE,
        id: "source:aih-core",
        revisionId: options.recordRevision ?? REVISION,
      },
    },
    coverage: {
      authority: "none",
      components: SUBJECTS.map((subject) => ({
        componentId: subject.componentId,
        subject: asset(subject),
      })),
    },
    observations: SUBJECTS.map((subject) => observation(subject, "new")),
    publications: [{ publicationSha256: "9".repeat(64) }],
    report: {
      components: SUBJECTS.map((subject) => ({
        findings: subject.findings,
        id: subject.componentId,
        verdict: subject.findings.length === 0 ? "pass" : "blocked",
      })),
    },
    verification: { method: "gh-attestation-verify", preparedAt: "2026-09-25T06:27:56.221Z" },
    version: "packaged-scanner-collection-evidence/v1",
  };
  const bytes = canonical(body);
  const recordPath = join(root, "collection-aih.json");
  write(
    recordPath,
    JSON.stringify({
      bytes: options.tamperRecord ? bytes.replace("display-only", "display-ONLY") : bytes,
      sha256: `sha256:${sha(bytes)}`,
    }),
  );
  const profiles: Json[] = [];
  const bindings: Json[] = [];
  for (const subject of SUBJECTS) {
    const newMaterial = structuredClone(subject.material);
    options.changeMaterial?.(newMaterial);
    // The previous seed: the same subject and material at the previous scan.
    const oldProfile = profile(subject, "old", subject.material);
    const directory = join(seedDirectory, subject.entryId);
    const source = { release: RELEASE, revision: `sha256:${sha(oldProfile)}`, type: "aih" };
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
        capabilities: { commands: [], egress: [], hooks: [], mcpTools: [], permissions: [] },
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
    // The draft: the same subject at the new scan.
    const newProfile = profile(subject, "new", newMaterial);
    profiles.push({
      assetId: subject.assetId,
      bytesBase64: Buffer.from(newProfile).toString("base64"),
      sha256: `sha256:${sha(newProfile)}`,
    });
    const newSource = { release: RELEASE, revision: `sha256:${sha(newProfile)}`, type: "aih" };
    const newSourceDigest = digest("aih-governance-decision-source/v2", newSource);
    bindings.push({
      asset: asset(subject),
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
  const unseeded = canonical({ asset: { assetId: "aih/serena" }, material: {} });
  profiles.push({
    assetId: "aih/serena",
    bytesBase64: Buffer.from(unseeded).toString("base64"),
    sha256: `sha256:${sha(unseeded)}`,
  });
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
  const outputRoot = join(root, "rendered");
  return { catalogRoot, recordPath, draftPath, outputRoot, bytes, bindings, profiles };
}

const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(directory, entry.name)).map((path) => `${entry.name}/${path}`)
      : [entry.name],
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
    expect(seed.qualification.gaps).toEqual(["evidence/profile-scope-limit.json"]);
    expect(read(join(governance, "evidence", "right-core-apache-2.0.json")).summary).toMatch(
      /^Apache-2\.0 notice packs\/governance-quality\/doctor\/LICENSE sha256:c{64} is part of this closure/,
    );

    const github = join(out, "mcp.aih.github.core-0-6-2");
    const githubSeed = read(join(github, "seed.json")) as {
      qualification: { gaps: string[]; rights: string[]; findings: string[] };
    };
    expect(githubSeed.qualification.findings).toEqual(["evidence/finding-1.json"]);
    expect(read(join(github, "evidence", "finding-1.json")).summary).toContain(
      "Scanner finding trust.external-egress",
    );
    expect(read(join(github, "evidence", "report.json")).summary).toContain("findings 1;");
    // The root LICENSE the previous row cited is not in a configuration-only closure (G21).
    expect(githubSeed.qualification.gaps).toEqual([
      "evidence/license-gap.json",
      "evidence/profile-scope-limit.json",
    ]);
    expect(read(join(github, "evidence", "license-gap.json")).summary).toContain(
      `License not determined: the previous row's Apache-2.0 notice LICENSE sha256:${"e".repeat(64)} is not in this closure.`,
    );
    // Generated prose surfaces facts; it never labels a component (the raw report keeps its own).
    for (const path of walk(out).filter((path) => !path.startsWith("source-reports/")))
      expect(readFileSync(join(out, path), "utf8"), path).not.toMatch(
        /blocked|failing|not authorized/i,
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
    const inputs = fixture({ release: "0.6.3" });
    expect(() => api.renderCoreCollectionSeedsV1(inputs)).toThrow(
      "core-collection-renderer:release",
    );
  });

  it("refuses a record whose bytes do not match its seal, and an existing output", async () => {
    const api = await renderer();
    const tampered = fixture({ tamperRecord: true });
    expect(() => api.renderCoreCollectionSeedsV1(tampered)).toThrow(
      "core-collection-renderer:record-digest",
    );
    const existing = fixture();
    mkdirSync(existing.outputRoot);
    expect(() => api.renderCoreCollectionSeedsV1(existing)).toThrow(
      "core-collection-renderer:output-exists",
    );
  });
});
