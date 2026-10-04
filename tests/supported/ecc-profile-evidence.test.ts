import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ECC_PROFILE_CURATION_V1,
  ECC_PROFILE_SOURCES_FILE_V1,
  eccProfileEvidenceV1,
} from "../../src/production/catalog/ecc-profile-evidence-v1.js";
import {
  readUpstreamInputsManifestV1,
  readVerifiedUpstreamInputV1,
} from "../../src/production/catalog/upstream-inputs-v1.js";
import { serializeCatalogDefaultV1 } from "../../src/production/catalog-defaults-v1.js";

/** affaan-m/ECC v2.2.1, the Q1 pin (tag v2.2.1 points at it). */
const PIN = "5064474d4d762dc9640234a41617cccb79185cec";
const OTHER = "0123456789abcdef0123456789abcdef01234567";
const root = resolve(import.meta.dirname, "..", "..");

interface ProfileSources {
  version: number;
  repository: string;
  commit: string;
  package: { name: string; version: string };
  licensePath: string;
  manifests: { path: string; text: string }[];
  files: { path: string; sha256: string; bytes: number; mode: string }[];
}

const sources = () =>
  JSON.parse(
    readFileSync(resolve(root, "src", "production", "data", ECC_PROFILE_SOURCES_FILE_V1), "utf8"),
  ) as ProfileSources;

interface Section {
  format: string;
  version: number;
  repository: string;
  sourceCommit: string;
  profile: {
    source: {
      commit: string;
      packageVersion: string;
      releaseAncestorCommit: string;
      componentPath: string;
      sourceHash: string;
      normalizedHash: string;
      manifestPins: Record<string, { rawSha256: string; canonicalSha256: string }>;
      reviewReceipt: {
        id: string;
        evidencePath: string;
        sourceCommit: string;
        evidenceSha256: string;
      };
    };
    selections: { baseline: string[]; activeSkills: string[]; warmReserveSkills: string[] };
    expected: { skills: number; roles: number; workflows: number };
    ownership: { sourcePin: string; sourcePath: string; normalizedHash: string }[];
  } & Record<string, unknown>;
  pinnedSourceEvidence: {
    evidenceVersion: number;
    source: {
      commit: string;
      manifestHashes: Record<string, string>;
      manifestPayloadHashes: Record<string, string>;
    } & Record<string, unknown>;
    reviewReceipt: unknown;
    profilesManifest: { profiles: Record<string, { modules: string[] }> };
    componentsManifest: { components: { id: string; modules: string[] }[] };
    modulesManifest: {
      modules: { id: string; kind: string; paths: string[]; dependencies: string[] }[];
    };
    availableSkillPaths: string[];
    agentPaths: string[];
    workflowPaths: string[];
  };
  projectedSource: {
    id: string;
    evidencePath: string;
    evidenceSha256: string;
    fileCount: number;
    totalBytes: number;
    aggregateSha256: string;
  };
  documents: { path: string; sha256: string; text: string }[];
}

const section = (input: unknown = sources(), pinnedSha = PIN) =>
  eccProfileEvidenceV1(input, { pinnedSha }) as unknown as Section;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The plugin's canonical JSON: keys in code-unit order, no whitespace. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function pick(value: unknown, keys: readonly string[]): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
  );
}

/**
 * The plugin's reduction of a raw upstream manifest onto its modelled evidence
 * fields (Core `sep-plugins` `packages/framework-ecc/src/profile/index.ts:595-646`,
 * `reduceUpstreamManifest`), which it hashes against `canonicalSha256`
 * (`index.ts:414-426`).
 */
function reduceUpstreamManifest(path: string, raw: unknown): unknown {
  switch (path) {
    case "manifests/install-profiles.json": {
      const manifest = pick(raw, ["version", "profiles"]);
      if (!isRecord(manifest) || !isRecord(manifest.profiles)) return manifest;
      return {
        ...manifest,
        profiles: Object.fromEntries(
          Object.entries(manifest.profiles).map(([id, entry]) => [id, pick(entry, ["modules"])]),
        ),
      };
    }
    case "manifests/install-components.json": {
      const manifest = pick(raw, ["version", "components"]);
      if (!isRecord(manifest) || !Array.isArray(manifest.components)) return manifest;
      return {
        ...manifest,
        components: manifest.components.map((entry) => pick(entry, ["id", "family", "modules"])),
      };
    }
    case "manifests/install-modules.json": {
      const manifest = pick(raw, ["version", "modules"]);
      if (!isRecord(manifest) || !Array.isArray(manifest.modules)) return manifest;
      return {
        ...manifest,
        modules: manifest.modules.map((entry) =>
          pick(entry, ["id", "kind", "paths", "dependencies"]),
        ),
      };
    }
  }
  throw new Error(`unknown manifest ${path}`);
}

const ID = /^\/?[a-z0-9][a-z0-9._:/-]*$/u;
const keysOf = (value: unknown) => (isRecord(value) ? Object.keys(value).sort() : value);
const ids = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && ID.test(item));

/** The skill directories the plugin resolves: core + lang:typescript module closure, plus leaves. */
function selectedSkillPaths(value: Section): { baseline: string[]; all: string[] } {
  const evidence = value.pinnedSourceEvidence;
  const modules = new Map(evidence.modulesManifest.modules.map((item) => [item.id, item]));
  const language = evidence.componentsManifest.components.find(
    (item) => item.id === "lang:typescript",
  );
  const closure = new Set([
    ...(evidence.profilesManifest.profiles.core?.modules ?? []),
    ...(language?.modules ?? []),
  ]);
  for (const id of closure)
    for (const dependency of modules.get(id)?.dependencies ?? []) closure.add(dependency);
  const baseline = [
    ...new Set(
      [...closure].flatMap((id) =>
        modules.get(id)?.kind === "skills" ? (modules.get(id)?.paths ?? []) : [],
      ),
    ),
  ].sort();
  const leaves = value.profile.selections.activeSkills.map((id) => `skills/${id}`);
  return { baseline, all: [...new Set([...baseline, ...leaves])].sort() };
}

describe("ECC profile evidence at v2.2.1", () => {
  it("is produced by produce:ecc at the pin", () => {
    const manifest = readUpstreamInputsManifestV1(root);
    const input = readVerifiedUpstreamInputV1(root, manifest, ECC_PROFILE_SOURCES_FILE_V1);
    expect(input.provenance.repository).toBe("affaan-m/ECC");
    expect(input.provenance.commit).toBe(PIN);
    expect((input.json as ProfileSources).commit).toBe(PIN);
  });

  it("binds every commit field to the vendor pin", () => {
    const value = section();
    expect(value.format).toBe("aih-ecc-profile-evidence");
    expect(value.version).toBe(1);
    expect(value.repository).toBe("affaan-m/ECC");
    expect(value.sourceCommit).toBe(PIN);
    expect(value.profile.source.commit).toBe(PIN);
    expect(value.profile.source.reviewReceipt.sourceCommit).toBe(PIN);
    for (const item of value.profile.ownership) expect(item.sourcePin).toBe(PIN);
    expect(value.pinnedSourceEvidence.source.commit).toBe(PIN);
    expect(value.pinnedSourceEvidence.reviewReceipt).toEqual(value.profile.source.reviewReceipt);
    // v2.2.1 is itself the tagged release.
    expect(value.profile.source.releaseAncestorCommit).toBe(PIN);
    expect(value.profile.source.packageVersion).toBe("2.2.1");
  });

  it("carries exactly the keys the plugin's strict section schema accepts", () => {
    const value = section();
    expect(Object.keys(value).sort()).toEqual(
      [
        "format",
        "version",
        "repository",
        "sourceCommit",
        "profile",
        "pinnedSourceEvidence",
        "projectedSource",
        "documents",
      ].sort(),
    );
    expect(Object.keys(value.profile).sort()).toEqual(
      [
        "version",
        "source",
        "selections",
        "expected",
        "profileFlags",
        "mcpPolicy",
        "aihAdaptedWorkflows",
        "localPlannedSkills",
        "repoCuratedSkills",
        "ownership",
        "state",
      ].sort(),
    );
    expect(Object.keys(value.pinnedSourceEvidence).sort()).toEqual(
      [
        "evidenceVersion",
        "source",
        "reviewReceipt",
        "profilesManifest",
        "componentsManifest",
        "modulesManifest",
        "availableSkillPaths",
        "agentPaths",
        "workflowPaths",
      ].sort(),
    );
  });

  it("pins the manifests by their raw and canonical digests", () => {
    const value = section();
    const evidence = value.pinnedSourceEvidence;
    const payloads: Record<string, unknown> = {
      "manifests/install-components.json": evidence.componentsManifest,
      "manifests/install-modules.json": evidence.modulesManifest,
      "manifests/install-profiles.json": evidence.profilesManifest,
    };
    for (const text of sources().manifests) {
      const pin = value.profile.source.manifestPins[text.path];
      expect(pin?.rawSha256).toBe(sha256(text.text));
      expect(evidence.source.manifestHashes[text.path]).toBe(pin?.rawSha256);
      expect(pin?.canonicalSha256).toBe(sha256(canonicalJson(payloads[text.path])));
      expect(evidence.source.manifestPayloadHashes[text.path]).toBe(pin?.canonicalSha256);
      // The canonical pin is over the plugin's reduction of the raw bytes, never the raw object.
      const reduced = reduceUpstreamManifest(text.path, JSON.parse(text.text));
      expect(payloads[text.path]).toEqual(reduced);
      expect(pin?.canonicalSha256).toBe(sha256(canonicalJson(reduced)));
      expect(pin?.canonicalSha256).not.toBe(sha256(canonicalJson(JSON.parse(text.text))));
    }
    const component = evidence.source.manifestHashes["manifests/install-components.json"];
    expect(value.profile.source.sourceHash).toBe(component);
    expect(value.profile.source.normalizedHash).toBe(component);
    expect(value.profile.source.componentPath).toBe("manifests/install-components.json");
  });

  it("embeds exactly the reduced manifest shapes the plugin's strict evidence schema accepts", () => {
    // Core `sep-plugins` `packages/framework-ecc/src/profile/index.ts:217-263`
    // (`moduleSchema`, `eccPinnedEvidenceSchema`): every object is strict.
    const evidence = section().pinnedSourceEvidence as unknown as Record<string, unknown>;
    const profiles = evidence.profilesManifest as Record<string, unknown>;
    expect(keysOf(profiles)).toEqual(["profiles", "version"]);
    expect(profiles.version).toBe(1);
    const profileEntries = Object.entries(profiles.profiles as Record<string, unknown>);
    expect(profileEntries.length).toBeGreaterThan(0);
    for (const [id, entry] of profileEntries) {
      expect(id).toMatch(ID);
      expect(keysOf(entry)).toEqual(["modules"]);
      expect(ids((entry as Record<string, unknown>).modules)).toBe(true);
    }
    const components = evidence.componentsManifest as Record<string, unknown>;
    expect(keysOf(components)).toEqual(["components", "version"]);
    expect(components.version).toBe(1);
    for (const entry of components.components as Record<string, unknown>[]) {
      expect(keysOf(entry)).toEqual(["family", "id", "modules"]);
      expect(entry.id).toMatch(ID);
      expect(typeof entry.family === "string" && entry.family.length > 0).toBe(true);
      expect(ids(entry.modules)).toBe(true);
    }
    const modules = evidence.modulesManifest as Record<string, unknown>;
    expect(keysOf(modules)).toEqual(["modules", "version"]);
    expect(modules.version).toBe(1);
    for (const entry of modules.modules as Record<string, unknown>[]) {
      expect(keysOf(entry)).toEqual(["dependencies", "id", "kind", "paths"]);
      expect(entry.id).toMatch(ID);
      expect(typeof entry.kind === "string" && entry.kind.length > 0).toBe(true);
      expect(
        Array.isArray(entry.paths) && entry.paths.every((path) => typeof path === "string"),
      ).toBe(true);
      expect(ids(entry.dependencies)).toBe(true);
    }
  });

  it("refuses a manifest whose reduction the plugin's strict evidence schema would reject", () => {
    const withModules = (edit: (modules: Record<string, unknown>[]) => void) => {
      const input = sources();
      return {
        ...input,
        manifests: input.manifests.map((item) => {
          if (item.path !== "manifests/install-modules.json") return item;
          const manifest = JSON.parse(item.text) as { modules: Record<string, unknown>[] };
          edit(manifest.modules);
          return { ...item, text: JSON.stringify(manifest) };
        }),
      };
    };
    expect(() =>
      section(
        withModules((modules) => {
          delete (modules[0] as Record<string, unknown>).dependencies;
        }),
      ),
    ).toThrow(/dependencies/u);
    expect(() =>
      section(
        withModules((modules) => {
          (modules[0] as Record<string, unknown>).kind = 7;
        }),
      ),
    ).toThrow(/kind/u);
    expect(() =>
      section(
        withModules((modules) => {
          (modules[0] as Record<string, unknown>).paths = ["../escape"];
        }),
      ),
    ).toThrow(/path/u);
  });

  it("derives the counts from the pinned inventory (baseline 117 at v2.2.1)", () => {
    const value = section();
    const { baseline, all } = selectedSkillPaths(value);
    // 0c1d7be9 had 113; v2.2.1 adds four workflow-quality skills to the baseline.
    expect(baseline).toHaveLength(117);
    for (const id of ["council-multi-model", "dev-team", "living-docs-governance", "skill-comply"])
      expect(baseline).toContain(`skills/${id}`);
    expect(value.profile.expected).toEqual({
      skills: all.length,
      roles: value.pinnedSourceEvidence.agentPaths.length,
      workflows: value.pinnedSourceEvidence.workflowPaths.length,
    });
    expect(value.profile.expected).toEqual({ skills: 140, roles: 68, workflows: 94 });
  });

  it("keeps the curation only where the curated items exist at the pin", () => {
    const value = section();
    const available = new Set(value.pinnedSourceEvidence.availableSkillPaths);
    expect(value.profile.selections.activeSkills).toEqual(ECC_PROFILE_CURATION_V1.activeSkills);
    expect(value.profile.selections.activeSkills).toHaveLength(23);
    for (const id of [
      ...value.profile.selections.activeSkills,
      ...value.profile.selections.warmReserveSkills,
    ])
      expect(available.has(`skills/${id}`), id).toBe(true);
    for (const id of ["/auto-update", "/hookify", "/hookify-configure", "/project-init"])
      expect(value.pinnedSourceEvidence.workflowPaths).toContain(`commands${id}.md`);
    expect(value.profile.selections.baseline).toEqual(["core", "lang:typescript"]);
  });

  it("carries the two evidence documents as exact text bound to their digests", () => {
    const value = section();
    expect(value.documents.map((document) => document.path)).toEqual([
      value.profile.source.reviewReceipt.evidencePath,
      value.projectedSource.evidencePath,
    ]);
    const [receipt, closure] = value.documents;
    expect(receipt?.sha256).toBe(sha256(receipt?.text ?? ""));
    expect(receipt?.sha256).toBe(value.profile.source.reviewReceipt.evidenceSha256);
    expect(closure?.sha256).toBe(sha256(closure?.text ?? ""));
    expect(closure?.sha256).toBe(value.projectedSource.evidenceSha256);
    for (const document of value.documents)
      expect(document.path).toMatch(/^[a-z0-9][a-z0-9/._-]*[a-z0-9]$/u);
  });

  it("closes the projected source over exactly the selected skills, roles and workflows", () => {
    const value = section();
    const closure = JSON.parse(value.documents[1]?.text ?? "{}") as {
      receiptVersion: number;
      id: string;
      repository: string;
      sourceCommit: string;
      fileCount: number;
      totalBytes: number;
      aggregateSha256: string;
      entries: { path: string; rawSha256: string; bytes: number; fileType: string; mode: string }[];
    };
    expect(closure.receiptVersion).toBe(1);
    expect(closure.repository).toBe("affaan-m/ECC");
    expect(closure.sourceCommit).toBe(PIN);
    expect({
      id: closure.id,
      fileCount: closure.fileCount,
      totalBytes: closure.totalBytes,
      aggregateSha256: closure.aggregateSha256,
    }).toEqual({
      id: value.projectedSource.id,
      fileCount: value.projectedSource.fileCount,
      totalBytes: value.projectedSource.totalBytes,
      aggregateSha256: value.projectedSource.aggregateSha256,
    });
    expect(closure.entries).toHaveLength(closure.fileCount);
    expect(closure.entries.reduce((total, entry) => total + entry.bytes, 0)).toBe(
      closure.totalBytes,
    );
    expect(
      sha256(
        closure.entries
          .map((entry) =>
            [entry.path, entry.rawSha256, entry.bytes, entry.fileType, entry.mode].join("\0"),
          )
          .join("\n"),
      ),
    ).toBe(closure.aggregateSha256);
    const { all } = selectedSkillPaths(value);
    const exact = new Set([
      ...value.pinnedSourceEvidence.agentPaths,
      ...value.pinnedSourceEvidence.workflowPaths,
    ]);
    const expected = sources()
      .files.filter(
        (file) => exact.has(file.path) || all.some((skill) => file.path.startsWith(`${skill}/`)),
      )
      .map((file) => ({
        path: file.path,
        rawSha256: file.sha256,
        bytes: file.bytes,
        fileType: "regular",
        mode: file.mode,
      }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    expect(closure.entries).toEqual(expected);
    for (const skill of all)
      expect(closure.entries.map((entry) => entry.path)).toContain(`${skill}/SKILL.md`);
    expect(closure.fileCount).toBeLessThanOrEqual(512);
    expect(closure.totalBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("serializes to the recorded descriptor section digest", () => {
    expect(sha256(serializeCatalogDefaultV1(section()))).toBe(
      "83d2d2bc26afeb991130142ecd1b4566645e82f1eddb1c1fd274bcb07dbbccbe",
    );
  });

  it("refuses sources fetched at a commit other than the vendor pin", () => {
    expect(() => section(sources(), OTHER)).toThrow(new RegExp(`${PIN}.*${OTHER}`, "u"));
  });

  it("refuses a selected upstream commit other than the one the curation was reviewed at", () => {
    expect(() => section({ ...sources(), commit: OTHER }, OTHER)).toThrow(
      new RegExp(`reviewed at ${PIN}.*${OTHER}`, "u"),
    );
  });

  it("refuses rather than replaces a curated item missing at the pin", () => {
    const [active] = ECC_PROFILE_CURATION_V1.activeSkills;
    const [warm] = ECC_PROFILE_CURATION_V1.warmReserveSkills;
    for (const [removed, name] of [
      [`skills/${active}/`, active],
      [`skills/${warm}/`, warm],
      ["commands/hookify.md", "/hookify"],
    ] as const) {
      const input = sources();
      const changed = {
        ...input,
        files: input.files.filter((file) => !file.path.startsWith(removed)),
      };
      expect(changed.files.length).toBeLessThan(input.files.length);
      expect(() => section(changed)).toThrow(new RegExp(String(name).replace("/", "\\/"), "u"));
    }
  });

  it("refuses malformed sources", () => {
    const input = sources();
    expect(() => section({ ...input, extra: true })).toThrow(/extra/u);
    expect(() => section({ ...input, package: { ...input.package, name: "other" } })).toThrow(
      /ecc-universal/u,
    );
    expect(() => section({ ...input, manifests: input.manifests.slice(1) })).toThrow(/manifests/u);
    const [first, ...rest] = input.files;
    if (first === undefined) throw new Error("no files");
    expect(() => section({ ...input, files: [...rest, { ...first, mode: "120000" }] })).toThrow(
      /mode/u,
    );
    expect(() => section({ ...input, files: [first, first, ...rest] })).toThrow(/twice/u);
    expect(() =>
      section({ ...input, files: [{ ...first, path: "../escape.md" }, ...rest] }),
    ).toThrow(/path/u);
  });
});
