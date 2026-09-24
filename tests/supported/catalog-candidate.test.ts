import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_CANDIDATE_FORMAT_V1,
  CATALOG_CANDIDATE_ROOT_V1,
  writeCatalogCandidateRootV1,
} from "../../src/production/candidate-build-v1.js";
import {
  assertCandidateBaseSourcesV1,
  type CatalogCandidateV1,
  candidateFrameworkSourceSectionsV1,
  candidateOmittedSectionsV1,
  candidatePackagedSourceDataV1,
  readCatalogCandidateInputsV1,
} from "../../src/production/candidate-inputs-v1.js";
import {
  policyAuthoringCatalogV1,
  readPolicyAuthoringCatalogInputsV1,
} from "../../src/production/catalog/policy-authoring-catalog-v1.js";
import { assembleCompilerOutputsV1 } from "../../src/production/workbench/assembly-v1.js";
import { readCollectionSnapshotV1 } from "../../src/production/workbench/authoring-bundle-v1.js";
import { compileCatalogProvidersV1 } from "../../src/production/workbench/catalog-providers-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const data = (name: string) =>
  JSON.parse(readFileSync(resolve(root, "src", "production", "data", name), "utf8")) as unknown;
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

interface LockSource {
  id: string;
  owner: string;
  repo: string;
  pinnedSha: string;
}
const vendorLock = () => data("vendor-lock-v1.json") as { sources: LockSource[] };
const pinOf = (id: string) =>
  vendorLock().sources.find((source) => source.id === id)?.pinnedSha as string;
const OTHER = "0123456789abcdef0123456789abcdef01234567";

const temporary: string[] = [];
function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "aih-catalog-candidate-"));
  temporary.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function compilerInput(overrides: Record<string, unknown> = {}) {
  return {
    version: "pinned-baseline/v1",
    framework: {
      id: "superpowers",
      repository: "obra/Superpowers",
      commit: pinOf("superpowers"),
      assets: [
        {
          id: "skill:brainstorming",
          kind: "skill",
          source: {
            repository: "obra/Superpowers",
            commit: pinOf("superpowers"),
            path: "skills/brainstorming",
          },
          sourcePaths: ["skills/brainstorming"],
        },
      ],
      ...overrides,
    },
  };
}

/** Writes a compiler input and an inputs file naming it; returns the inputs path. */
function inputsFor(
  frameworks: (dir: string) => Record<string, unknown>,
  extra: Record<string, unknown> = {},
): string {
  const dir = tempDir();
  const path = join(dir, "candidate-inputs.json");
  writeFileSync(
    path,
    JSON.stringify({
      format: "aih-catalog-candidate-inputs",
      version: 1,
      frameworks: frameworks(dir),
      ...extra,
    }),
  );
  return path;
}

function superpowersInput(input: unknown = compilerInput(), digest?: string) {
  return (dir: string) => {
    mkdirSync(join(dir, "compiler"), { recursive: true });
    const text = typeof input === "string" ? input : JSON.stringify(input);
    writeFileSync(join(dir, "compiler", "superpowers.json"), text);
    return {
      superpowers: { compilerInput: "compiler/superpowers.json", sha256: digest ?? sha256(text) },
    };
  };
}

describe("the base authoring bundle under a vendor lock at the upstream-input pins", () => {
  // Runbook step 8.1 copies T2's vendor lock; the upstream inputs are already
  // fetched at the new pins. The base bundle (before any packaged-source
  // overlay) then carries each framework source at the lock pin with
  // pinned-baseline/v1, which is what T3 requires of a candidate.
  it("carries source:superpowers at the lock pin with pinned-baseline/v1", () => {
    const inputs = readPolicyAuthoringCatalogInputsV1(root);
    const upstreamPin = (file: string) => inputs.upstream.files[file]?.commit as string;
    const lock = structuredClone(inputs.vendorLock);
    for (const source of lock.sources)
      source.pinnedSha = upstreamPin(`${source.id}-content-metadata-v1.json`);
    const catalog = policyAuthoringCatalogV1({ ...inputs, vendorLock: lock });
    const compiled = compileCatalogProvidersV1({
      catalog,
      vendorSources: lock.sources,
      mattpocockSnapshot: readCollectionSnapshotV1(root, "mattpocock.snapshot.json"),
      ponytailSnapshot: readCollectionSnapshotV1(root, "ponytail.snapshot.json"),
    });
    const base = assembleCompilerOutputsV1(
      compiled.providers.flatMap((provider) => provider.inputs),
      compiled.coreCapabilities,
      inputs.core.hosts.filter((host) => host.policyTarget === true).map((host) => String(host.id)),
    );
    for (const id of ["superpowers", "ecc"]) {
      const source = base.sources[`source:${id}`];
      expect(source?.inputFormat).toBe("pinned-baseline/v1");
      expect(source?.revision.id).toBe(upstreamPin(`${id}-content-metadata-v1.json`));
    }
    expect(base.sources["source:superpowers"]?.revision.id).toBe(
      "5bf4e78011075bcfc0dc295f0724994cd123ee71",
    );
    expect(() =>
      assertCandidateBaseSourcesV1(
        { prepared: { bundle: base } },
        { sources: lock.sources },
        { inputsSha256: "0".repeat(64), frameworks: { superpowers: { kind: "omitted" } } },
      ),
    ).not.toThrow();
  });
});

describe("candidate inputs", () => {
  it("reads a compiler input at the vendor-lock pin and binds the inputs file digest", () => {
    const path = inputsFor(superpowersInput());
    const candidate = readCatalogCandidateInputsV1(path, vendorLock());
    expect(candidate.inputsSha256).toBe(sha256(readFileSync(path)));
    const entry = candidate.frameworks.superpowers;
    expect(entry?.kind).toBe("compiler-input");
    if (entry?.kind !== "compiler-input") throw new Error("unexpected");
    expect(entry.componentDefinitions).toEqual(compilerInput());
    expect(candidate.frameworks.ecc).toBeUndefined();
  });

  it("reads an explicit omission", () => {
    const candidate = readCatalogCandidateInputsV1(
      inputsFor(() => ({ ecc: { omit: true } })),
      vendorLock(),
    );
    expect(candidate.frameworks.ecc).toEqual({ kind: "omitted" });
  });

  it.each([
    [
      "a digest that does not match the bytes",
      superpowersInput(compilerInput(), "0".repeat(64)),
      /sha256/u,
    ],
    ["a malformed digest", superpowersInput(compilerInput(), "ABC"), /sha256/u],
    ["another commit", superpowersInput(compilerInput({ commit: OTHER })), /pin/u],
    [
      "another repository",
      superpowersInput(compilerInput({ repository: "someone/Superpowers" })),
      /obra\/Superpowers/u,
    ],
    ["another framework id", superpowersInput(compilerInput({ id: "ecc" })), /superpowers/u],
    [
      "another input format",
      superpowersInput({ ...compilerInput(), version: "pinned-component-collection/v1" }),
      /pinned-baseline\/v1/u,
    ],
    [
      "an unknown compiler input field",
      superpowersInput({ ...compilerInput(), extra: 1 }),
      /extra/u,
    ],
    ["no assets", superpowersInput(compilerInput({ assets: [] })), /assets/u],
    [
      "a duplicate key in the compiler input",
      superpowersInput('{"version":"pinned-baseline/v1","version":"x","framework":{}}'),
      /duplicate key/u,
    ],
    ["an unknown framework", () => ({ muse: { omit: true } }), /muse/u],
    ["no framework", () => ({}), /frameworks/u],
    [
      "a missing compiler input",
      () => ({ superpowers: { compilerInput: "absent.json", sha256: "0".repeat(64) } }),
      /absent\.json/u,
    ],
    [
      "an entry with both forms",
      () => ({ superpowers: { omit: true, compilerInput: "x" } }),
      /superpowers/u,
    ],
    ["an omission that is not true", () => ({ ecc: { omit: false } }), /omit/u],
  ])("refuses %s", (_label, frameworks, message) => {
    expect(() => readCatalogCandidateInputsV1(inputsFor(frameworks), vendorLock())).toThrow(
      message,
    );
  });

  it("refuses an inputs file with another format, version or an unknown field", () => {
    for (const extra of [{ format: "other" }, { version: 2 }, { extra: true }])
      expect(() =>
        readCatalogCandidateInputsV1(inputsFor(superpowersInput(), extra), vendorLock()),
      ).toThrow(/candidate inputs/u);
  });

  it("refuses a duplicate key in the inputs file", () => {
    const dir = tempDir();
    const path = join(dir, "candidate-inputs.json");
    writeFileSync(
      path,
      '{"format":"aih-catalog-candidate-inputs","version":1,"frameworks":{"ecc":{"omit":true},"ecc":{"omit":true}}}',
    );
    expect(() => readCatalogCandidateInputsV1(path, vendorLock())).toThrow(/duplicate key/u);
  });
});

describe("candidate packaged source records", () => {
  const records = () => data("packaged-source-data-v1.json") as { bytes: string; sha256: string }[];
  const repositories = (wrappers: unknown) =>
    (wrappers as { bytes: string }[]).map(
      (wrapper) =>
        (JSON.parse(wrapper.bytes) as { source: { repository: string } }).source.repository,
    );
  const commitOf = (repository: string) =>
    (
      records()
        .map(
          (wrapper) =>
            JSON.parse(wrapper.bytes) as { source: { repository: string; commit: string } },
        )
        .find((record) => record.source.repository === repository) as { source: { commit: string } }
    ).source.commit;

  it("never overlays the record of a named framework and keeps the collection records", () => {
    const candidate: CatalogCandidateV1 = {
      inputsSha256: "0".repeat(64),
      frameworks: { superpowers: { kind: "omitted" }, ecc: { kind: "omitted" } },
    };
    const kept = candidatePackagedSourceDataV1(records(), vendorLock(), candidate);
    expect(repositories(kept).sort()).toEqual(["DietrichGebert/ponytail", "anthropics/skills"]);
    // The kept wrappers are byte-identical to the sealed ones.
    for (const wrapper of kept as { bytes: string; sha256: string }[])
      expect(records()).toContainEqual(wrapper);
  });

  it("refuses an unnamed framework whose record is not at the vendor-lock pin", () => {
    // Today the ECC record is at v2.2.1 while the unsealed lock still pins 5caf398a.
    expect(commitOf("affaan-m/ECC")).not.toBe(pinOf("ecc"));
    const candidate: CatalogCandidateV1 = {
      inputsSha256: "0".repeat(64),
      frameworks: { superpowers: { kind: "omitted" } },
    };
    expect(() => candidatePackagedSourceDataV1(records(), vendorLock(), candidate)).toThrow(
      new RegExp(`affaan-m/ECC.*${commitOf("affaan-m/ECC")}.*${pinOf("ecc")}.*ecc`, "u"),
    );
  });

  it("keeps an unnamed framework record that is at the vendor-lock pin", () => {
    expect(commitOf("obra/Superpowers")).toBe(pinOf("superpowers"));
    const candidate: CatalogCandidateV1 = {
      inputsSha256: "0".repeat(64),
      frameworks: { ecc: { kind: "omitted" } },
    };
    expect(
      repositories(candidatePackagedSourceDataV1(records(), vendorLock(), candidate)),
    ).toContain("obra/Superpowers");
  });

  it("refuses an unnamed framework without a record", () => {
    const candidate: CatalogCandidateV1 = {
      inputsSha256: "0".repeat(64),
      frameworks: { ecc: { kind: "omitted" } },
    };
    const without = records().filter(
      (wrapper) => !wrapper.bytes.includes('"repository":"obra/Superpowers"'),
    );
    expect(without.length).toBe(records().length - 1);
    expect(() => candidatePackagedSourceDataV1(without, vendorLock(), candidate)).toThrow(
      /obra\/Superpowers/u,
    );
  });
});

describe("candidate base sources", () => {
  const candidate: CatalogCandidateV1 = {
    inputsSha256: "0".repeat(64),
    frameworks: { superpowers: { kind: "omitted" } },
  };
  const bundle = (source: unknown) => ({
    prepared: { bundle: { sources: source === undefined ? {} : { "source:superpowers": source } } },
  });
  const pin = () => pinOf("superpowers");

  it("accepts the named framework's source at the pin with pinned-baseline/v1", () => {
    expect(() =>
      assertCandidateBaseSourcesV1(
        bundle({ inputFormat: "pinned-baseline/v1", revision: { id: pin() } }),
        vendorLock(),
        candidate,
      ),
    ).not.toThrow();
  });

  it.each([
    ["another revision", { inputFormat: "pinned-baseline/v1", revision: { id: OTHER } }],
    [
      "another input format",
      { inputFormat: "pinned-component-collection/v1", revision: { id: "PIN" } },
    ],
    ["no source", undefined],
  ])("refuses %s", (_label, source) => {
    const value =
      source === undefined ? undefined : JSON.parse(JSON.stringify(source).replace("PIN", pin()));
    expect(() => assertCandidateBaseSourcesV1(bundle(value), vendorLock(), candidate)).toThrow(
      /source:superpowers.*pinned-baseline\/v1/u,
    );
  });
});

describe("candidate descriptor sections", () => {
  it("takes componentDefinitions from the compiler input and omits packagedSource", () => {
    const definitions = compilerInput();
    expect(
      candidateFrameworkSourceSectionsV1("superpowers", {
        kind: "compiler-input",
        path: "x",
        sha256: "0".repeat(64),
        componentDefinitions: definitions,
      }),
    ).toEqual({ componentDefinitions: definitions });
    expect(candidateFrameworkSourceSectionsV1("ecc", { kind: "omitted" })).toEqual({});
  });

  it("names every omitted section", () => {
    expect(
      candidateOmittedSectionsV1({
        inputsSha256: "0".repeat(64),
        frameworks: {
          superpowers: {
            kind: "compiler-input",
            path: "x",
            sha256: "0".repeat(64),
            componentDefinitions: {},
          },
          ecc: { kind: "omitted" },
        },
      }),
    ).toEqual([
      "./catalog-authoring-bundle.json#packagedSource:affaan-m/ECC",
      "./catalog-authoring-bundle.json#packagedSource:obra/Superpowers",
      "./catalog-framework-ecc.json#sections.componentDefinitions",
      "./catalog-framework-ecc.json#sections.packagedSource",
      "./catalog-framework-ecc.json#sections.runtimeDescriptor",
      "./catalog-framework-superpowers.json#sections.packagedSource",
      "./catalog-scanner-evidence.json#sourceProofs:affaan-m/ECC",
      "./catalog-scanner-evidence.json#sourceProofs:obra/Superpowers",
    ]);
  });
});

describe("the candidate package root", () => {
  const candidate: CatalogCandidateV1 = {
    inputsSha256: "a".repeat(64),
    frameworks: { superpowers: { kind: "omitted" } },
  };
  const COMMIT = "b".repeat(40);

  function fixtureRoot(): string {
    const dir = tempDir();
    mkdirSync(join(dir, "defaults"));
    writeFileSync(join(dir, "defaults", "catalog-index-v1.json"), '{"committed":"index"}\n');
    writeFileSync(
      join(dir, "defaults", "catalog-framework-superpowers-v1.json"),
      '{"committed":1}\n',
    );
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify(
        {
          name: "@aihq/catalog",
          version: "0.3.0",
          exports: { "./package.json": "./package.json" },
          files: ["dist", "defaults"],
          scripts: { build: "x", prepublishOnly: "node tools/check-not-candidate.mjs" },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(join(dir, "README.md"), "readme\n");
    writeFileSync(join(dir, "LICENSE"), "license\n");
    return dir;
  }

  const write = (
    dir: string,
    files: Record<string, unknown>,
    outRoot = join(dir, CATALOG_CANDIDATE_ROOT_V1),
  ) =>
    writeCatalogCandidateRootV1({
      root: dir,
      outRoot,
      files,
      candidate,
      catalogCommit: COMMIT,
      omittedSections: ["./catalog-framework-superpowers.json#sections.packagedSource"],
    });

  it("writes the marked candidate beside, never over, the committed defaults", () => {
    const dir = fixtureRoot();
    const before = readFileSync(join(dir, "defaults", "catalog-framework-superpowers-v1.json"));
    write(dir, { "defaults/catalog-framework-superpowers-v1.json": { candidate: true } });
    const out = join(dir, CATALOG_CANDIDATE_ROOT_V1);
    expect(readFileSync(join(dir, "defaults", "catalog-framework-superpowers-v1.json"))).toEqual(
      before,
    );
    expect(
      readFileSync(join(out, "defaults", "catalog-framework-superpowers-v1.json"), "utf8"),
    ).toBe('{"candidate":true}\n');
    expect(readFileSync(join(out, "defaults", "catalog-index-v1.json"), "utf8")).toBe(
      '{"committed":"index"}\n',
    );
    expect(JSON.parse(readFileSync(join(out, "CANDIDATE.json"), "utf8"))).toEqual({
      format: CATALOG_CANDIDATE_FORMAT_V1,
      version: 1,
      catalogCommit: COMMIT,
      inputsSha256: "a".repeat(64),
      omittedSections: ["./catalog-framework-superpowers.json#sections.packagedSource"],
    });
    const manifest = JSON.parse(readFileSync(join(out, "package.json"), "utf8"));
    expect(manifest.name).toBe("@aihq/catalog");
    expect(manifest.version).toBe("0.3.0");
    expect(manifest.aihCandidate).toEqual({
      format: CATALOG_CANDIDATE_FORMAT_V1,
      version: 1,
      inputsSha256: "a".repeat(64),
    });
    expect(manifest.private).toBe(true);
    // npm pack keeps only package.json#files (plus package.json, README, LICENSE).
    expect(manifest.files).toEqual(["dist", "defaults", "CANDIDATE.json"]);
    expect(Object.keys(manifest.scripts)).toEqual(["prepublishOnly"]);
    expect(readdirSync(out).sort()).toEqual(
      ["CANDIDATE.json", "LICENSE", "README.md", "defaults", "package.json"].sort(),
    );
  });

  it("refuses a publish from the candidate root", () => {
    const dir = fixtureRoot();
    write(dir, {});
    const out = join(dir, CATALOG_CANDIDATE_ROOT_V1);
    const script = JSON.parse(readFileSync(join(out, "package.json"), "utf8")).scripts
      .prepublishOnly;
    const result = spawnSync(script, { cwd: out, shell: true, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/candidate/u);
  });

  it("refuses any other output root and any file outside defaults/", () => {
    const dir = fixtureRoot();
    expect(() => write(dir, {}, dir)).toThrow(/dist-candidate/u);
    expect(() => write(dir, {}, join(dir, "defaults"))).toThrow(/dist-candidate/u);
    expect(() => write(dir, { "package.json": {} })).toThrow(/defaults/u);
    expect(() => write(dir, { "defaults/../x.json": {} })).toThrow(/defaults/u);
  });

  it("replaces only an earlier candidate root", () => {
    const dir = fixtureRoot();
    write(dir, {});
    expect(() => write(dir, {})).not.toThrow();
    const out = join(dir, CATALOG_CANDIDATE_ROOT_V1);
    rmSync(join(out, "CANDIDATE.json"));
    expect(() => write(dir, {})).toThrow(/CANDIDATE\.json/u);
  });
});

describe("candidate guards in the package scripts", () => {
  const manifest = () =>
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
  const guard = "node tools/check-not-candidate.mjs";

  it("runs the guard before build, build:dist and check:catalog-index and before publishing", () => {
    const { scripts } = manifest();
    for (const name of ["build", "build:dist", "check:catalog-index"])
      expect(scripts[name]?.startsWith(`${guard} && `)).toBe(true);
    expect(scripts.prepublishOnly).toBe(guard);
    expect(scripts["build:candidate"]).toBe("node tools/build-candidate.mjs");
  });

  it.each([
    ["a CANDIDATE.json", (dir: string) => writeFileSync(join(dir, "CANDIDATE.json"), "{}")],
    [
      "an aihCandidate package field",
      (dir: string) =>
        writeFileSync(join(dir, "package.json"), JSON.stringify({ aihCandidate: { version: 1 } })),
    ],
  ])("refuses a root carrying %s", (_label, mark) => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@aihq/catalog" }));
    const run = () =>
      spawnSync(process.execPath, [resolve(root, "tools", "check-not-candidate.mjs")], {
        cwd: dir,
        encoding: "utf8",
      });
    expect(run().status).toBe(0);
    mark(dir);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/candidate/u);
  });

  it("keeps the candidate root out of git and lint", () => {
    expect(readFileSync(resolve(root, ".gitignore"), "utf8").split(/\r?\n/u)).toContain(
      `${CATALOG_CANDIDATE_ROOT_V1}/`,
    );
  });
});
