import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCandidateBaseSourcesV1,
  type CatalogCandidateV1,
  candidateOmittedSectionsV1,
  candidatePackagedSourceDataV1,
  readCatalogCandidateInputsV1,
} from "../../src/production/candidate-inputs-v1.js";
import { buildCatalogFrameworkDefaultsV1 } from "../../src/production/catalog-defaults-v1.js";
import { readCollectionSnapshotV1 } from "../../src/production/workbench/authoring-bundle-v1.js";
import type { AuthoringCatalogBundleV1 } from "../../src/production/workbench/contracts-v1.js";
import {
  produceSingleSourceAuthoringBundleV1,
  projectAuthoringBundleSourceV1,
} from "../../src/production/workbench/single-source-bundle-v1.js";
import { curatedVendorLockV2 } from "./v2-fixtures.js";

// T3 of a collection (anthropics-skills, ponytail) admits the source from the candidate
// Catalog's own authoring bundle (Core scanner-catalog-consumer.ts admittedSourceV1), so the
// candidate must carry the collection at its new pin: its stale record is never overlaid.

const root = resolve(import.meta.dirname, "..", "..");
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const records = () =>
  JSON.parse(
    readFileSync(
      resolve(root, "src", "production", "data", "packaged-source-data-v1.json"),
      "utf8",
    ),
  ) as { bytes: string; sha256: string }[];
const PONYTAIL_PIN = (
  readCollectionSnapshotV1(root, "ponytail.snapshot.json") as {
    source: { commit: string };
  }
).source.commit;
const ANTHROPICS_PIN = "3".repeat(40);

const temporary: string[] = [];
function tempDir(prefix = "aih-candidate-collections-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function anthropicsInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const file = (path: string, content: string) => {
    const bytes = Buffer.from(content, "utf8");
    return {
      path,
      bytesBase64: bytes.toString("base64"),
      sha256: `sha256:${sha256(bytes)}`,
      size: bytes.length,
    };
  };
  return {
    version: "pinned-component-collection/v1",
    source: {
      id: "anthropics-skills",
      repository: "https://github.com/anthropics/skills",
      commit: ANTHROPICS_PIN,
      version: "0.0.0",
      licenseFileRef: "README.md",
      ...overrides,
    },
    files: [
      file("README.md", "# skills\n"),
      file("skills/alpha/LICENSE.txt", "Apache-2.0\n"),
      file("skills/alpha/SKILL.md", "---\nname: alpha\ndescription: Alpha.\n---\nalpha\n"),
    ],
    components: [
      {
        id: "skill:alpha",
        kind: "skill",
        label: "alpha",
        description: "The alpha skill.",
        primaryPath: "skills/alpha/SKILL.md",
        fileRefs: ["skills/alpha/LICENSE.txt", "skills/alpha/SKILL.md"],
      },
    ],
  };
}

/** An inputs file naming ecc and superpowers as omitted and the given collections. */
function inputsFor(collections: Record<string, unknown>, frameworks: unknown = undefined): string {
  const dir = tempDir();
  mkdirSync(join(dir, "compiler"));
  const named: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(collections)) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    writeFileSync(join(dir, "compiler", `${id}.json`), text);
    named[id] = { compilerInput: `compiler/${id}.json`, sha256: sha256(text) };
  }
  const path = join(dir, "candidate-inputs.json");
  writeFileSync(
    path,
    JSON.stringify({
      format: "aih-catalog-candidate-inputs",
      version: 1,
      frameworks: frameworks ?? { ecc: { omit: true }, superpowers: { omit: true } },
      collections: named,
    }),
  );
  return path;
}

const lock = () => curatedVendorLockV2(root);

describe("candidate collection inputs", () => {
  it("reads each named collection's compiler input at its own pin", () => {
    const candidate = readCatalogCandidateInputsV1(
      inputsFor({
        "anthropics-skills": anthropicsInput(),
        ponytail: readCollectionSnapshotV1(root, "ponytail.snapshot.json"),
      }),
      lock(),
    );
    expect(candidate.collections?.["anthropics-skills"]?.commit).toBe(ANTHROPICS_PIN);
    expect(candidate.collections?.["anthropics-skills"]?.compilerInput).toEqual(anthropicsInput());
    expect(candidate.collections?.ponytail?.commit).toBe(PONYTAIL_PIN);
  });

  it.each([
    ["an unknown collection", { mattpocock: anthropicsInput() }, /mattpocock/u],
    [
      "another source id",
      { "anthropics-skills": anthropicsInput({ id: "ponytail" }) },
      /anthropics-skills.*ponytail/u,
    ],
    [
      "another repository",
      { "anthropics-skills": anthropicsInput({ repository: "https://github.com/x/skills" }) },
      /https:\/\/github\.com\/anthropics\/skills/u,
    ],
    [
      "another input format",
      { "anthropics-skills": { ...anthropicsInput(), version: "pinned-baseline/v1" } },
      /pinned-component-collection\/v1/u,
    ],
    ["a malformed pin", { "anthropics-skills": anthropicsInput({ commit: "HEAD" }) }, /commit/u],
    ["a duplicate key", { "anthropics-skills": '{"version":"a","version":"b"}' }, /duplicate/u],
  ])("refuses %s", (_label, collections, message) => {
    expect(() => readCatalogCandidateInputsV1(inputsFor(collections), lock())).toThrow(message);
  });

  it("refuses a digest that does not match the named file", () => {
    const path = inputsFor({ "anthropics-skills": anthropicsInput() });
    const inputs = JSON.parse(readFileSync(path, "utf8"));
    inputs.collections["anthropics-skills"].sha256 = "0".repeat(64);
    writeFileSync(path, JSON.stringify(inputs));
    expect(() => readCatalogCandidateInputsV1(path, lock())).toThrow(/sha256/u);
  });

  it("refuses inputs that name nothing", () => {
    expect(() => readCatalogCandidateInputsV1(inputsFor({}, {}), lock())).toThrow(
      /at least one framework or collection/u,
    );
  });
});

describe("candidate collections in the generated defaults", () => {
  const candidate = (): CatalogCandidateV1 => ({
    inputsSha256: "0".repeat(64),
    frameworks: { ecc: { kind: "omitted" }, superpowers: { kind: "omitted" } },
    collections: {
      "anthropics-skills": {
        kind: "compiler-input",
        path: "compiler/anthropics-skills.json",
        sha256: "0".repeat(64),
        commit: ANTHROPICS_PIN,
        compilerInput: anthropicsInput(),
      },
      ponytail: {
        kind: "compiler-input",
        path: "compiler/ponytail.json",
        sha256: "0".repeat(64),
        commit: PONYTAIL_PIN,
        compilerInput: readCollectionSnapshotV1(root, "ponytail.snapshot.json") as Record<
          string,
          unknown
        >,
      },
    },
  });

  it("never overlays a named collection's record", () => {
    expect(candidatePackagedSourceDataV1(records(), lock(), candidate())).toEqual([]);
  });

  it("states what the candidate leaves out for each named collection", () => {
    const omitted = candidateOmittedSectionsV1(candidate());
    for (const section of [
      "./catalog-authoring-bundle.json#packagedSource:anthropics/skills",
      "./catalog-scanner-evidence.json#sourceProofs:anthropics/skills",
      "./catalog-authoring-bundle.json#packagedSource:DietrichGebert/ponytail",
      "./catalog-scanner-evidence.json#sourceProofs:DietrichGebert/ponytail",
      "./catalog-scanner-providers.json#collections.ponytail",
    ])
      expect(omitted).toContain(section);
  });

  it("refuses a base bundle that does not carry a named collection at its pin", () => {
    const bundle = (revision: string, inputFormat = "pinned-component-collection/v1") => ({
      prepared: {
        bundle: {
          sources: {
            "source:anthropics-skills": { inputFormat, revision: { id: revision } },
            "source:ponytail": { inputFormat, revision: { id: PONYTAIL_PIN } },
          },
        },
      },
    });
    const only = { ...candidate(), frameworks: {} };
    expect(() => assertCandidateBaseSourcesV1(bundle(ANTHROPICS_PIN), lock(), only)).not.toThrow();
    expect(() => assertCandidateBaseSourcesV1(bundle("4".repeat(40)), lock(), only)).toThrow(
      /source:anthropics-skills.*3{40}/u,
    );
  });

  it("builds every collection and framework at its new pin, as the new-pin emitter does", () => {
    const copy = tempDir("aih-candidate-root-");
    cpSync(resolve(root, "src", "production", "data"), join(copy, "src", "production", "data"), {
      recursive: true,
    });
    const vendorLock = lock();
    writeFileSync(
      join(copy, "src", "production", "data", "vendor-lock-v1.json"),
      `${JSON.stringify(vendorLock)}\n`,
    );
    // The committed collection evidence is still v1 until runbook step 8.2 (T2).
    writeFileSync(
      join(copy, "src", "production", "data", "packaged-collection-evidence-v1.json"),
      "[]\n",
    );
    const files = buildCatalogFrameworkDefaultsV1(copy, candidate()) as Record<string, unknown>;
    const bundle = (
      files["defaults/catalog-authoring-bundle-v1.json"] as {
        prepared: { bundle: AuthoringCatalogBundleV1 };
      }
    ).prepared.bundle;
    const pins = Object.fromEntries(
      Object.values(bundle.sources).map((source) => [source.id, source.revision.id]),
    );
    expect(pins["source:anthropics-skills"]).toBe(ANTHROPICS_PIN);
    expect(pins["source:ponytail"]).toBe(PONYTAIL_PIN);
    const providers = files["defaults/catalog-scanner-providers-v1.json"] as {
      collections: Record<string, unknown>;
    };
    expect(Object.keys(providers.collections)).toEqual(["mattpocock"]);
    const expected = [
      ["anthropics-skills", ANTHROPICS_PIN, { compilerInput: anthropicsInput() }],
      ["ponytail", PONYTAIL_PIN, {}],
      ...(
        vendorLock as { sources: { id: "ecc" | "superpowers"; pinnedSha: string }[] }
      ).sources.map((source) => [source.id, source.pinnedSha, { vendorLock }] as const),
    ] as const;
    for (const [id, pin, options] of expected)
      expect(projectAuthoringBundleSourceV1(copy, bundle, `source:${id}`)).toEqual(
        produceSingleSourceAuthoringBundleV1(copy, id, pin, { newPin: true, ...options }),
      );
  });

  it("refuses a ponytail compiler input that is not the Catalog's fetched snapshot", () => {
    const copy = tempDir("aih-candidate-root-");
    cpSync(resolve(root, "src", "production", "data"), join(copy, "src", "production", "data"), {
      recursive: true,
    });
    writeFileSync(
      join(copy, "src", "production", "data", "vendor-lock-v1.json"),
      `${JSON.stringify(lock())}\n`,
    );
    writeFileSync(
      join(copy, "src", "production", "data", "packaged-collection-evidence-v1.json"),
      "[]\n",
    );
    const changed = candidate();
    const ponytail = changed.collections?.ponytail;
    if (ponytail === undefined) throw new Error("no ponytail");
    (ponytail.compilerInput.source as { version: string }).version = "0.0.1";
    expect(() => buildCatalogFrameworkDefaultsV1(copy, changed)).toThrow(
      /ponytail compiler input is not the Catalog's fetched ponytail snapshot/u,
    );
  });
});
