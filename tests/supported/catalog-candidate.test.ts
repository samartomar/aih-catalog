import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
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

// Exposure rollback tests inject one rename failure into the candidate-snapshot
// tool: the Nth renameSync after arming throws once, every other call passes
// through. The mock is inert while fsFaults.renameCountdown is null.
const fsFaults = vi.hoisted(() => ({ renameCountdown: null as number | null }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (fsFaults.renameCountdown !== null) {
        if (fsFaults.renameCountdown === 0) {
          fsFaults.renameCountdown = null;
          throw new Error("simulated rename failure");
        }
        fsFaults.renameCountdown -= 1;
      }
      return actual.renameSync(...args);
    },
  };
});

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

  it.each([
    [[]],
    [["--candidate"]],
    [["--out", "x"]],
    [["--candidate", "x", "extra"]],
  ])("refuses build:candidate arguments %j", (args) => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, "tools", "build-candidate.mjs"), ...args],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/usage: npm run build:candidate -- --candidate/u);
  });

  it("keeps the candidate root and its build staging out of git", () => {
    const ignored = readFileSync(resolve(root, ".gitignore"), "utf8").split(/\r?\n/u);
    expect(ignored).toContain(`${CATALOG_CANDIDATE_ROOT_V1}/`);
    expect(ignored).toContain("/.candidate-build-*/");
  });
});

// Shared fixtures for the candidate-snapshot tool tests: tools/candidate-snapshot.mjs
// builds from a private materialization of the recorded commit, never from the live
// tree, and exposes the output only if the live HEAD and the snapshot still match
// that commit afterwards.
type SnapshotStep = (snapshot: { root: string; catalogCommit: string }) => unknown;
const snapshotTool = async () =>
  (await import(pathToFileURL(resolve(root, "tools", "candidate-snapshot.mjs")).href)) as {
    buildCandidateFromCommitV1: (
      root: string,
      step: SnapshotStep,
    ) => Promise<{
      catalogCommit: string;
      outRoot: string;
      result: unknown;
      modesVerified: boolean;
    }>;
  };
const INPUT = join("src", "production", "data", "input.json");
const COMMITTED = '{"v":"committed"}';

const gitIn = (dir: string, ...args: string[]) => gitInWithInput(dir, undefined, ...args);
const gitInWithInput = (dir: string, input: string | undefined, ...args: string[]) => {
  const result = spawnSync(
    "git",
    [
      "-C",
      dir,
      "-c",
      "user.name=CQ4 fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8", input },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
};

/** A committed fixture checkout; returns its root. */
function fixtureCheckout(): string {
  const dir = tempDir();
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, ".gitattributes"), "* -text\n");
  writeFileSync(join(dir, ".gitignore"), "dist/\ndist-candidate/\n/.candidate-build-*/\n");
  writeFileSync(join(dir, "package.json"), '{"name":"@aihq/catalog"}');
  mkdirSync(join(dir, "src", "production", "data"), { recursive: true });
  writeFileSync(join(dir, INPUT), COMMITTED);
  mkdirSync(join(dir, "defaults"));
  writeFileSync(join(dir, "defaults", "x.json"), '{"x":"committed"}');
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "fixture");
  return dir;
}

/** What the real build does: read the handed root and write <root>/dist-candidate. */
const emit = ({ root: snapshot, catalogCommit }: { root: string; catalogCommit: string }) => {
  const out = join(snapshot, CATALOG_CANDIDATE_ROOT_V1);
  mkdirSync(out);
  writeFileSync(join(out, "input.json"), readFileSync(join(snapshot, INPUT)));
  writeFileSync(join(out, "x.json"), readFileSync(join(snapshot, "defaults", "x.json")));
  writeFileSync(
    join(out, "CANDIDATE.json"),
    JSON.stringify({ format: CATALOG_CANDIDATE_FORMAT_V1, version: 1, catalogCommit }),
  );
  return snapshot;
};
const staging = (dir: string) =>
  readdirSync(dir).filter((name) => name.startsWith(".candidate-build-"));
const earlierCandidate = (dir: string) => {
  mkdirSync(join(dir, CATALOG_CANDIDATE_ROOT_V1));
  writeFileSync(
    join(dir, CATALOG_CANDIDATE_ROOT_V1, "CANDIDATE.json"),
    JSON.stringify({ format: CATALOG_CANDIDATE_FORMAT_V1, catalogCommit: "earlier" }),
  );
};

describe("the candidate build snapshot", () => {
  it("builds from the recorded commit, so an edit made during the build never reaches the candidate", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    const head = gitIn(dir, "rev-parse", "HEAD");
    earlierCandidate(dir);
    const built = await buildCandidateFromCommitV1(dir, (snapshot) => {
      expect(resolve(snapshot.root)).not.toBe(resolve(dir));
      writeFileSync(join(dir, INPUT), '{"v":"edited during the build"}');
      writeFileSync(join(dir, "defaults", "x.json"), '{"x":"edited during the build"}');
      return emit(snapshot);
    });
    const out = join(dir, CATALOG_CANDIDATE_ROOT_V1);
    expect(built.catalogCommit).toBe(head);
    expect(resolve(built.outRoot)).toBe(resolve(out));
    expect(readFileSync(join(out, "input.json"), "utf8")).toBe(COMMITTED);
    expect(readFileSync(join(out, "x.json"), "utf8")).toBe('{"x":"committed"}');
    expect(JSON.parse(readFileSync(join(out, "CANDIDATE.json"), "utf8")).catalogCommit).toBe(head);
    // The live edit stays where it was made; nothing of the snapshot is left.
    expect(readFileSync(join(dir, INPUT), "utf8")).toBe('{"v":"edited during the build"}');
    expect(staging(dir)).toEqual([]);
  });

  it("refuses when HEAD changes during the build and keeps the earlier candidate", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    const head = gitIn(dir, "rev-parse", "HEAD");
    earlierCandidate(dir);
    let moved = "";
    await expect(
      buildCandidateFromCommitV1(dir, (snapshot) => {
        writeFileSync(join(dir, INPUT), '{"v":"next"}');
        gitIn(dir, "commit", "-q", "-am", "moved during the build");
        moved = gitIn(dir, "rev-parse", "HEAD");
        return emit(snapshot);
      }),
    ).rejects.toThrow(new RegExp(`HEAD moved from ${head} to [0-9a-f]{40}`, "u"));
    expect(moved).not.toBe(head);
    // The new output is removed and the earlier candidate is restored untouched.
    expect(readdirSync(join(dir, CATALOG_CANDIDATE_ROOT_V1))).toEqual(["CANDIDATE.json"]);
    expect(
      JSON.parse(readFileSync(join(dir, CATALOG_CANDIDATE_ROOT_V1, "CANDIDATE.json"), "utf8"))
        .catalogCommit,
    ).toBe("earlier");
    expect(staging(dir)).toEqual([]);
  });

  it.each([
    [
      "a changed tracked file",
      (snapshot: string) => writeFileSync(join(snapshot, INPUT), '{"v":"changed in the snapshot"}'),
    ],
    ["a removed tracked file", (snapshot: string) => rmSync(join(snapshot, INPUT))],
    [
      "an added file",
      (snapshot: string) => writeFileSync(join(snapshot, "defaults", "added.json"), "{}"),
    ],
  ])("refuses a snapshot that no longer equals the commit (%s)", async (_label, change) => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    await expect(
      buildCandidateFromCommitV1(dir, (snapshot) => {
        emit(snapshot);
        change(snapshot.root);
      }),
    ).rejects.toThrow(/snapshot .* no longer equals/u);
    expect(readdirSync(dir)).not.toContain(CATALOG_CANDIDATE_ROOT_V1);
    expect(staging(dir)).toEqual([]);
  });

  it("refuses an output that names another commit or none", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    await expect(
      buildCandidateFromCommitV1(dir, (snapshot) =>
        emit({ root: snapshot.root, catalogCommit: "c".repeat(40) }),
      ),
    ).rejects.toThrow(/catalogCommit/u);
    await expect(buildCandidateFromCommitV1(dir, () => undefined)).rejects.toThrow(
      /CANDIDATE\.json/u,
    );
    expect(readdirSync(dir)).not.toContain(CATALOG_CANDIDATE_ROOT_V1);
    expect(staging(dir)).toEqual([]);
  });

  it("removes the partial output when the build fails", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    await expect(
      buildCandidateFromCommitV1(dir, (snapshot) => {
        emit(snapshot);
        throw new Error("generation failed");
      }),
    ).rejects.toThrow(/generation failed/u);
    expect(readdirSync(dir)).not.toContain(CATALOG_CANDIDATE_ROOT_V1);
    expect(staging(dir)).toEqual([]);
  });

  it.each([
    ["a dirty checkout", (dir: string) => writeFileSync(join(dir, INPUT), "{}"), /uncommitted/u],
    [
      "an untracked file",
      (dir: string) => writeFileSync(join(dir, "new.json"), "{}"),
      /uncommitted/u,
    ],
    [
      "a dist-candidate that is not a candidate",
      (dir: string) => mkdirSync(join(dir, CATALOG_CANDIDATE_ROOT_V1)),
      /not an earlier candidate root/u,
    ],
    [
      "a candidate root",
      (dir: string) => writeFileSync(join(dir, "CANDIDATE.json"), "{}"),
      /is a candidate root/u,
    ],
  ])("refuses %s before building", async (_label, prepare, message) => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    prepare(dir);
    let called = false;
    await expect(
      buildCandidateFromCommitV1(dir, () => {
        called = true;
      }),
    ).rejects.toThrow(message);
    expect(called).toBe(false);
    expect(staging(dir)).toEqual([]);
  });
});

describe("the candidate build reads raw commit bytes", () => {
  it("never lets a .git/info/attributes smudge filter reach the candidate", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    writeFileSync(join(dir, "README.md"), "clean readme\n");
    gitIn(dir, "add", "README.md");
    gitIn(dir, "commit", "-q", "-m", "readme");
    const head = gitIn(dir, "rev-parse", "HEAD");
    // A local filter that injects text on checkout and strips it on staging, so a
    // checkout-based snapshot carries the injected bytes while every git-normalized
    // comparison stays clean.
    writeFileSync(join(dir, ".git", "info", "attributes"), "README.md filter=inject\n");
    gitIn(dir, "config", "filter.inject.smudge", "sed 's/$/INJECTED/'");
    gitIn(dir, "config", "filter.inject.clean", "sed 's/INJECTED$//'");
    // The filter really fires on checkout, and the injected worktree file then
    // looks clean to git (the clean filter strips the injection again).
    rmSync(join(dir, "README.md"));
    gitIn(dir, "checkout", "--", "README.md");
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("clean readmeINJECTED\n");
    expect(gitIn(dir, "status", "--porcelain", "--untracked-files=all")).toBe("");

    const built = await buildCandidateFromCommitV1(dir, (snapshot) => {
      const out = join(snapshot.root, CATALOG_CANDIDATE_ROOT_V1);
      mkdirSync(out);
      writeFileSync(join(out, "README.md"), readFileSync(join(snapshot.root, "README.md")));
      writeFileSync(
        join(out, "CANDIDATE.json"),
        JSON.stringify({
          format: CATALOG_CANDIDATE_FORMAT_V1,
          version: 1,
          catalogCommit: snapshot.catalogCommit,
        }),
      );
    });
    expect(built.catalogCommit).toBe(head);
    expect(readFileSync(join(built.outRoot, "README.md"), "utf8")).toBe("clean readme\n");
    expect(staging(dir)).toEqual([]);
  });

  it.each([
    [
      "a symlink (120000)",
      (dir: string) => {
        gitIn(dir, "config", "core.symlinks", "false");
        const oid = gitInWithInput(dir, "target", "hash-object", "-w", "--stdin");
        gitIn(dir, "update-index", "--add", "--cacheinfo", `120000,${oid},link`);
        writeFileSync(join(dir, "link"), "target");
      },
      /120000/u,
    ],
    [
      "a gitlink (160000)",
      (dir: string) => {
        const head = gitIn(dir, "rev-parse", "HEAD");
        gitIn(dir, "update-index", "--add", "--cacheinfo", `160000,${head},sub`);
        mkdirSync(join(dir, "sub"));
      },
      /160000/u,
    ],
  ])("refuses a commit whose tree carries %s", async (_label, add, message) => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    add(dir);
    gitIn(dir, "commit", "-q", "-m", "non-regular entry");
    expect(gitIn(dir, "status", "--porcelain", "--untracked-files=all")).toBe("");
    let called = false;
    await expect(
      buildCandidateFromCommitV1(dir, () => {
        called = true;
      }),
    ).rejects.toThrow(message);
    expect(called).toBe(false);
    expect(readdirSync(dir)).not.toContain(CATALOG_CANDIDATE_ROOT_V1);
    expect(staging(dir)).toEqual([]);
  });

  it("ignores the build's own output directories when verifying the snapshot", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    await buildCandidateFromCommitV1(dir, (snapshot) => {
      mkdirSync(join(snapshot.root, "dist"), { recursive: true });
      writeFileSync(join(snapshot.root, "dist", "junk.js"), "junk");
      return emit(snapshot);
    });
    const out = join(dir, CATALOG_CANDIDATE_ROOT_V1);
    expect(readFileSync(join(out, "input.json"), "utf8")).toBe(COMMITTED);
    expect(readdirSync(out)).not.toContain("junk.js");
    expect(staging(dir)).toEqual([]);
  });
});

// Raw-object fixtures for the tree-path refusal tests: the entries cannot be
// represented in a Windows worktree (or even an index), so the commit is built
// by plumbing alone. The refusal must happen before the worktree is consulted.
// hash-object fsck-checks trees, so the tree object is written directly.
const writeRawObject = (dir: string, type: string, content: Buffer) => {
  const store = Buffer.concat([Buffer.from(`${type} ${content.length}\0`, "utf8"), content]);
  const oid = createHash("sha1").update(store).digest("hex");
  const path = join(dir, ".git", "objects", oid.slice(0, 2), oid.slice(2));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, deflateSync(store));
  return oid;
};

/** Commit a raw tree object (entries may carry any name bytes) and move HEAD to it. */
function commitRawTree(dir: string, names: Buffer[]): string {
  const oid = gitIn(dir, "rev-parse", "HEAD:package.json");
  const sorted = [...names].sort(Buffer.compare);
  const tree = Buffer.concat(
    sorted.map((name) =>
      Buffer.concat([
        Buffer.from(`100644 `, "utf8"),
        name,
        Buffer.from([0]),
        Buffer.from(oid, "hex"),
      ]),
    ),
  );
  const commit = gitInWithInput(
    dir,
    "raw tree\n",
    "commit-tree",
    writeRawObject(dir, "tree", tree),
    "-p",
    gitIn(dir, "rev-parse", "HEAD"),
  );
  gitIn(dir, "update-ref", "HEAD", commit);
  return commit;
}

describe("the candidate build snapshot file modes", () => {
  /** A fixture with a committed 100755 file (the index bit works on win32 too). */
  function executableCheckout(): string {
    const dir = fixtureCheckout();
    writeFileSync(join(dir, "tool.sh"), "#!/bin/sh\necho ok\n");
    if (process.platform !== "win32") chmodSync(join(dir, "tool.sh"), 0o755);
    gitIn(dir, "add", "tool.sh");
    gitIn(dir, "update-index", "--chmod=+x", "tool.sh");
    gitIn(dir, "commit", "-q", "-m", "executable");
    expect(gitIn(dir, "ls-tree", "HEAD", "--", "tool.sh")).toMatch(/^100755 /u);
    expect(gitIn(dir, "status", "--porcelain", "--untracked-files=all")).toBe("");
    return dir;
  }

  it("reports whether modes were verified (never on win32)", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = executableCheckout();
    const built = await buildCandidateFromCommitV1(dir, emit);
    expect(built.modesVerified).toBe(process.platform !== "win32");
    expect(readFileSync(join(built.outRoot, "input.json"), "utf8")).toBe(COMMITTED);
    expect(staging(dir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "materializes a 100755 file executable and refuses a build that strips the bit",
    async () => {
      const { buildCandidateFromCommitV1 } = await snapshotTool();
      const dir = executableCheckout();
      await buildCandidateFromCommitV1(dir, (snapshot) => {
        expect(lstatSync(join(snapshot.root, "tool.sh")).mode & 0o111).not.toBe(0);
        return emit(snapshot);
      });
      const stripped = executableCheckout();
      await expect(
        buildCandidateFromCommitV1(stripped, (snapshot) => {
          const result = emit(snapshot);
          chmodSync(join(snapshot.root, "tool.sh"), 0o644);
          return result;
        }),
      ).rejects.toThrow(/no longer equals.*mode/su);
      expect(readdirSync(stripped)).not.toContain(CATALOG_CANDIDATE_ROOT_V1);
      expect(staging(stripped)).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a build that adds the executable bit to a 100644 file",
    async () => {
      const { buildCandidateFromCommitV1 } = await snapshotTool();
      const dir = executableCheckout();
      await expect(
        buildCandidateFromCommitV1(dir, (snapshot) => {
          const result = emit(snapshot);
          chmodSync(join(snapshot.root, "defaults", "x.json"), 0o755);
          return result;
        }),
      ).rejects.toThrow(/no longer equals.*mode/su);
    },
  );
});

describe("the candidate build refuses unusable tree paths", () => {
  it("refuses a path that is not UTF-8, naming the byte offset", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    commitRawTree(dir, [Buffer.from([0x62, 0x61, 0x64, 0x2e, 0xff, 0x6a, 0x73, 0x6f, 0x6e])]);
    let called = false;
    let failure: unknown;
    await buildCandidateFromCommitV1(dir, () => {
      called = true;
    }).catch((error: unknown) => {
      failure = error;
    });
    expect((failure as Error)?.message).toMatch(/not UTF-8.*byte offset [0-9]+/u);
    expect((failure as { code?: string })?.code).toBe("candidate-path-not-utf8");
    expect(called).toBe(false);
    expect(staging(dir)).toEqual([]);
  });

  it("refuses a duplicate path", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    commitRawTree(dir, [Buffer.from("dup.json"), Buffer.from("dup.json")]);
    let called = false;
    await expect(
      buildCandidateFromCommitV1(dir, () => {
        called = true;
      }),
    ).rejects.toThrow(/duplicate.*dup\.json/u);
    expect(called).toBe(false);
    expect(staging(dir)).toEqual([]);
  });

  it("refuses paths that alias on a case-insensitive file system", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    commitRawTree(dir, [Buffer.from("Case.json"), Buffer.from("case.json")]);
    let called = false;
    await expect(
      buildCandidateFromCommitV1(dir, () => {
        called = true;
      }),
    ).rejects.toThrow(/alias.*Case\.json.*case\.json/u);
    expect(called).toBe(false);
    expect(staging(dir)).toEqual([]);
  });

  it("refuses paths that alias under Unicode normalization", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    commitRawTree(dir, [
      Buffer.from("é.json".normalize("NFC"), "utf8"),
      Buffer.from("é.json".normalize("NFD"), "utf8"),
    ]);
    let called = false;
    await expect(
      buildCandidateFromCommitV1(dir, () => {
        called = true;
      }),
    ).rejects.toThrow(/alias/u);
    expect(called).toBe(false);
    expect(staging(dir)).toEqual([]);
  });
});

describe("the cat-file batch framing", () => {
  const entry = { mode: "100644", oid: "1".repeat(40), size: 3, path: "a.json" };
  const record = (oid: string, content: Buffer, headerSize = content.length) =>
    Buffer.concat([
      Buffer.from(`${oid} blob ${headerSize}\n`, "utf8"),
      content,
      Buffer.from([0x0a]),
    ]);
  const parser = async () =>
    (await import(pathToFileURL(resolve(root, "tools", "candidate-snapshot.mjs")).href)) as {
      parseCatFileBatchV1: (
        entries: { oid: string; size: number; path: string }[],
        output: Buffer,
      ) => Map<string, Buffer>;
    };

  it("reads a well-formed batch", async () => {
    const { parseCatFileBatchV1 } = await parser();
    const bytes = parseCatFileBatchV1([entry], record(entry.oid, Buffer.from("abc")));
    expect(bytes.get("a.json")?.toString("utf8")).toBe("abc");
  });

  it("refuses a wrong object id in a header", async () => {
    const { parseCatFileBatchV1 } = await parser();
    expect(() => parseCatFileBatchV1([entry], record("2".repeat(40), Buffer.from("abc")))).toThrow(
      /batch/u,
    );
  });

  it("refuses a header size that differs from the tree listing", async () => {
    const { parseCatFileBatchV1 } = await parser();
    expect(() => parseCatFileBatchV1([entry], record(entry.oid, Buffer.from("abc"), 2))).toThrow(
      /size/u,
    );
  });

  it("refuses a missing terminating newline", async () => {
    const { parseCatFileBatchV1 } = await parser();
    const broken = Buffer.concat([
      Buffer.from(`${entry.oid} blob 3\n`, "utf8"),
      Buffer.from("abc"),
      Buffer.from([0x00]),
    ]);
    expect(() => parseCatFileBatchV1([entry], broken)).toThrow(/newline/u);
  });

  it("refuses trailing bytes after the last object", async () => {
    const { parseCatFileBatchV1 } = await parser();
    const trailing = Buffer.concat([record(entry.oid, Buffer.from("abc")), Buffer.from("x")]);
    expect(() => parseCatFileBatchV1([entry], trailing)).toThrow(/trailing/u);
  });
});

describe("the candidate build never runs repository configuration code", () => {
  it("never executes a core.fsmonitor command from .git/config", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    const outside = tempDir();
    const marker = join(outside, "fsmonitor-ran");
    const script = join(outside, "fsmonitor.js").split(sep).join("/");
    writeFileSync(
      join(outside, "fsmonitor.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker.split(sep).join("/"))}, "ran");\n`,
    );
    const command = `"${process.execPath.split(sep).join("/")}" "${script}"`;
    gitIn(dir, "config", "core.fsmonitor", command);
    // The monitor really fires for an unhardened git command in this fixture.
    gitIn(dir, "status", "--porcelain");
    expect(readFileSync(marker, "utf8")).toBe("ran");
    rmSync(marker);

    const built = await buildCandidateFromCommitV1(dir, emit);
    expect(built.catalogCommit).toBe(gitIn(dir, "rev-parse", "HEAD"));
    expect(readFileSync(join(built.outRoot, "input.json"), "utf8")).toBe(COMMITTED);
    expect(existsSync(marker)).toBe(false);
    expect(staging(dir)).toEqual([]);
  });
});

describe("the candidate build reads only the named checkout", () => {
  it("ignores an inherited GIT_DIR and GIT_WORK_TREE that point elsewhere", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    const head = gitIn(dir, "rev-parse", "HEAD");
    const other = fixtureCheckout();
    writeFileSync(join(other, INPUT), '{"v":"other repository"}');
    gitIn(other, "commit", "-q", "-am", "other");
    const otherHead = gitIn(other, "rev-parse", "HEAD");
    expect(otherHead).not.toBe(head);
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = join(other, ".git");
    process.env.GIT_WORK_TREE = other;
    try {
      const built = await buildCandidateFromCommitV1(dir, emit);
      expect(built.catalogCommit).toBe(head);
      expect(readFileSync(join(built.outRoot, "input.json"), "utf8")).toBe(COMMITTED);
    } finally {
      for (const [name, value] of Object.entries(saved))
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    expect(staging(dir)).toEqual([]);
  });

  it("builds the original commit's bytes when a replace ref substitutes its tree", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    const head = gitIn(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, INPUT), '{"v":"doctored by a replace ref"}');
    gitIn(dir, "add", INPUT);
    const doctored = gitInWithInput(
      dir,
      "doctored\n",
      "commit-tree",
      gitIn(dir, "write-tree"),
      "-p",
      head,
    );
    gitIn(dir, "reset", "-q", "--hard", head);
    gitIn(dir, "replace", head, doctored);
    // The replacement really substitutes the tree for replace-aware readers.
    expect(gitIn(dir, "show", `${head}:src/production/data/input.json`)).toBe(
      '{"v":"doctored by a replace ref"}',
    );
    expect(
      gitIn(dir, "--no-replace-objects", "show", `${head}:src/production/data/input.json`),
    ).toBe(COMMITTED);

    const built = await buildCandidateFromCommitV1(dir, emit);
    expect(built.catalogCommit).toBe(head);
    expect(readFileSync(join(built.outRoot, "input.json"), "utf8")).toBe(COMMITTED);
    expect(
      JSON.parse(readFileSync(join(built.outRoot, "CANDIDATE.json"), "utf8")).catalogCommit,
    ).toBe(head);
    expect(staging(dir)).toEqual([]);
  });

  it("refuses a root that is not the checkout's top level", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    let called = false;
    await expect(
      buildCandidateFromCommitV1(join(dir, "src"), () => {
        called = true;
      }),
    ).rejects.toThrow(/top level/u);
    expect(called).toBe(false);
    expect(readdirSync(join(dir, "src"))).not.toContain(CATALOG_CANDIDATE_ROOT_V1);
  });
});

describe("the candidate build exposure rolls back safely", () => {
  const earlierCandidateRestored = (dir: string) => {
    const out = join(dir, CATALOG_CANDIDATE_ROOT_V1);
    expect(readdirSync(out)).toEqual(["CANDIDATE.json"]);
    expect(JSON.parse(readFileSync(join(out, "CANDIDATE.json"), "utf8")).catalogCommit).toBe(
      "earlier",
    );
    expect(staging(dir)).toEqual([]);
  };

  it.each([
    ["the quarantine move", 0],
    ["the exposure rename", 1],
  ])("restores the earlier candidate when %s fails", async (_label, countdown) => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    earlierCandidate(dir);
    fsFaults.renameCountdown = countdown;
    try {
      await expect(buildCandidateFromCommitV1(dir, emit)).rejects.toThrow(
        /simulated rename failure/u,
      );
    } finally {
      fsFaults.renameCountdown = null;
    }
    earlierCandidateRestored(dir);
  });

  it("removes the new output and restores the earlier candidate when the final HEAD check throws", async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    earlierCandidate(dir);
    await expect(
      buildCandidateFromCommitV1(dir, (snapshot) => {
        const result = emit(snapshot);
        renameSync(join(dir, ".git"), join(dir, ".git-hidden"));
        return result;
      }),
    ).rejects.toThrow(/HEAD|git/u);
    earlierCandidateRestored(dir);
  });

  it.each([
    [
      "an unrelated real directory",
      (out: string) => {
        mkdirSync(out);
        writeFileSync(join(out, "keep.txt"), "keep");
      },
    ],
    [
      "a junction to an unrelated directory",
      (out: string, dir: string) => {
        const target = join(dir, "unrelated-target");
        mkdirSync(target);
        writeFileSync(join(target, "keep.txt"), "keep");
        symlinkSync(target, out, "junction");
      },
    ],
  ])("refuses and leaves %s swapped in at dist-candidate untouched", async (_label, swap) => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    earlierCandidate(dir);
    const out = join(dir, CATALOG_CANDIDATE_ROOT_V1);
    await expect(
      buildCandidateFromCommitV1(dir, (snapshot) => {
        const result = emit(snapshot);
        // A concurrent swapper replaces the earlier candidate mid-build.
        rmSync(out, { recursive: true, force: true });
        swap(out, dir);
        return result;
      }),
    ).rejects.toThrow(/not an earlier candidate root/u);
    expect(readFileSync(join(out, "keep.txt"), "utf8")).toBe("keep");
    expect(staging(dir)).toEqual([]);
  });
});

describe("the candidate build at real repository size", () => {
  it("materializes a tree whose listing exceeds the child process default buffer", {
    timeout: 120_000,
  }, async () => {
    const { buildCandidateFromCommitV1 } = await snapshotTool();
    const dir = fixtureCheckout();
    // ~7000 entries with ~100-character paths: the ls-tree listing is over
    // 1 MiB, past spawnSync's default maxBuffer.
    const deep = join(dir, "d".repeat(60));
    mkdirSync(deep);
    for (let i = 0; i < 7000; i += 1) writeFileSync(join(deep, `f${i}-${"g".repeat(30)}`), `${i}`);
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "many files");
    const head = gitIn(dir, "rev-parse", "HEAD");
    const built = await buildCandidateFromCommitV1(dir, emit);
    expect(built.catalogCommit).toBe(head);
    expect(readFileSync(join(built.outRoot, "input.json"), "utf8")).toBe(COMMITTED);
    expect(staging(dir)).toEqual([]);
  });
});
