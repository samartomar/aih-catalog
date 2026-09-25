import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv from "ajv";
import { afterEach, describe, expect, it } from "vitest";
import { baselineInventoryGitEnvV1 } from "../../src/production/catalog/baseline-inventory-v1.js";
import {
  policyAuthoringCatalogV1,
  readPolicyAuthoringCatalogInputsV1,
} from "../../src/production/catalog/policy-authoring-catalog-v1.js";
import { readCollectionSnapshotV1 } from "../../src/production/workbench/authoring-bundle-v1.js";
import {
  collectionCompilerInputAtPinV1,
  frameworkCompilerInputV1,
  produceCompilerInputV1,
  readCuratedCollectionTemplateV1,
  serializeCompilerInputV1,
} from "../../src/production/workbench/compiler-input-v1.js";
import { compilePinnedComponentCollectionV1 } from "../../src/production/workbench/pinned-component-collection-v1.js";
import { curatedVendorLockV2 } from "./v2-fixtures.js";

const root = resolve(import.meta.dirname, "..", "..");
const coreShape = new Ajv({ allErrors: true, strict: true }).compile(
  JSON.parse(
    readFileSync(
      resolve(root, "tests", "fixtures", "core-source-data-baseline-input-v1.schema.json"),
      "utf8",
    ),
  ),
);
const recorded = (file: string): string =>
  JSON.parse(
    readFileSync(resolve(root, "src", "production", "data", "upstream-inputs-v1.json"), "utf8"),
  ).files[file].commit;

type Json = Record<string, unknown>;
const scratch: string[] = [];
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});
function temporary(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(path);
  return path;
}

describe("T3 compiler input for a framework", () => {
  it("is the curated policy authoring framework in Core's exact strict shape", () => {
    const vendorLock = curatedVendorLockV2(root);
    const curated = policyAuthoringCatalogV1(readPolicyAuthoringCatalogInputsV1(root, vendorLock));
    for (const id of ["ecc", "superpowers"] as const) {
      const framework = curated.frameworks.find((entry) => entry.id === id);
      if (framework === undefined) throw new Error(`no curated ${id}`);
      const input = produceCompilerInputV1(root, id, framework.commit, { vendorLock }) as {
        version: string;
        framework: Json & { assets: Json[] };
      };
      expect(coreShape(input), JSON.stringify(coreShape.errors)).toBe(true);
      expect(input.version).toBe("pinned-baseline/v1");
      expect(input.framework.commit).toBe(framework.commit);
      expect(input.framework.assets).toEqual(
        framework.assets.map(({ vet: _vet, runtimeIdentity: _runtime, ...curation }) => curation),
      );
      expect(input.framework.assets.some((asset) => "vet" in asset)).toBe(false);
    }
    // ECC curation does carry runtime identities; Core's strict input never reads them.
    const ecc = curated.frameworks.find((entry) => entry.id === "ecc");
    expect(
      ecc?.assets.filter((asset) => asset.runtimeIdentity !== undefined).length,
    ).toBeGreaterThan(0);
  });

  it("derives from curation alone: no packaged source record is read", () => {
    const vendorLock = curatedVendorLockV2(root);
    const pin = recorded("ecc-modules-v1.json");
    const expected = serializeCompilerInputV1(
      produceCompilerInputV1(root, "ecc", pin, { vendorLock }),
    );
    const copy = temporary("aih-compiler-input-root-");
    cpSync(resolve(root, "src", "production", "data"), join(copy, "src", "production", "data"), {
      recursive: true,
    });
    writeFileSync(
      join(copy, "src", "production", "data", "packaged-source-data-v1.json"),
      '[{"bytes":"not a record","sha256":"0"}]\n',
    );
    expect(serializeCompilerInputV1(produceCompilerInputV1(copy, "ecc", pin, { vendorLock }))).toBe(
      expected,
    );
  });

  it("keeps the vetted-pin checks and refuses a pin the curation is not at", () => {
    const vendorLock = curatedVendorLockV2(root) as {
      sources: { id: string; pinnedSha: string }[];
    };
    const pin = recorded("ecc-modules-v1.json");
    expect(() => produceCompilerInputV1(root, "ecc", "0".repeat(40), { vendorLock })).toThrow(
      new RegExp(`curates ecc at ${pin}, not 0{40}`),
    );
    const moved = structuredClone(vendorLock);
    const ecc = moved.sources.find((source) => source.id === "ecc");
    if (ecc === undefined) throw new Error("no ecc source");
    ecc.pinnedSha = "1".repeat(40);
    expect(() =>
      produceCompilerInputV1(root, "ecc", "1".repeat(40), { vendorLock: moved }),
    ).toThrow(/was not fetched at the vetted pin/);
  });

  it("refuses a curated field it does not know instead of dropping it", () => {
    const framework = {
      id: "superpowers" as const,
      repository: "obra/Superpowers",
      commit: "a".repeat(40),
      assets: [
        {
          id: "skill:alpha",
          kind: "skill" as const,
          source: { repository: "obra/Superpowers", commit: "a".repeat(40), path: "skills/alpha" },
          sourcePaths: ["skills/alpha"],
          surprise: true,
        },
      ],
    };
    expect(() => frameworkCompilerInputV1(framework)).toThrow(
      /skill:alpha carries curated field surprise/,
    );
  });
});

describe("T3 compiler input for a collection", () => {
  it("is ponytail's verified snapshot at its fetched pin", () => {
    const pin = recorded("ponytail.snapshot.json");
    expect(produceCompilerInputV1(root, "ponytail", pin)).toEqual(
      readCollectionSnapshotV1(root, "ponytail.snapshot.json"),
    );
    expect(() => produceCompilerInputV1(root, "ponytail", "0".repeat(40))).toThrow(
      new RegExp(`curates ponytail at ${pin}, not 0{40}`),
    );
  });

  it("reads the curated anthropics-skills template from its sealed record", () => {
    const template = readCuratedCollectionTemplateV1(root, "anthropics-skills") as {
      version: string;
      source: Json;
      components: { id: string }[];
    };
    expect(template.version).toBe("pinned-component-collection/v1");
    expect(template.source.repository).toBe("https://github.com/anthropics/skills");
    expect(template.components.length).toBeGreaterThan(0);
  });

  const REPOSITORY = "https://github.com/anthropics/skills";

  function git(args: readonly string[]): Uint8Array {
    return execFileSync("git", args, {
      env: baselineInventoryGitEnvV1(process.env),
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  /** A checkout whose commits are built with plumbing, so no line ending or link support applies. */
  function repository(origin = REPOSITORY) {
    const path = temporary("aih-compiler-input-git-");
    const run = (args: string[], input?: string) =>
      execFileSync("git", ["-C", path, ...args], {
        input,
        env: {
          ...baselineInventoryGitEnvV1(process.env),
          GIT_AUTHOR_NAME: "fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        },
      })
        .toString("utf8")
        .trim();
    run(["init", "-q"]);
    run(["remote", "add", "origin", origin]);
    let parent: string | undefined;
    const commit = (files: Record<string, string | { link: string }>): string => {
      run(["read-tree", "--empty"]);
      for (const [file, content] of Object.entries(files)) {
        const link = typeof content === "object";
        const blob = run(
          ["hash-object", "-w", "--stdin"],
          link ? content.link : (content as string),
        );
        run([
          "update-index",
          "--add",
          "--cacheinfo",
          `${link ? "120000" : "100644"},${blob},${file}`,
        ]);
      }
      const tree = run(["write-tree"]);
      parent = run(["commit-tree", tree, "-m", "fixture", ...(parent ? ["-p", parent] : [])]);
      return parent;
    };
    return { path, commit };
  }
  const reference = (path: string) => ({
    path,
    bytesBase64: { __aihSourceFileV1: { bytes: 1, path, sha256: `sha256:${"0".repeat(64)}` } },
    sha256: `sha256:${"0".repeat(64)}`,
    size: 1,
  });
  function template(): Json {
    const skill = (name: string) => ({
      id: `skill:${name}`,
      kind: "skill",
      label: name,
      description: `The ${name} skill.`,
      primaryPath: `skills/${name}/SKILL.md`,
      fileRefs: [`skills/${name}/LICENSE.txt`, `skills/${name}/SKILL.md`],
    });
    return {
      version: "pinned-component-collection/v1",
      source: {
        id: "anthropics-skills",
        repository: REPOSITORY,
        commit: "c".repeat(40),
        version: "0.0.0",
        licenseFileRef: "README.md",
      },
      files: [
        "README.md",
        "skills/alpha/LICENSE.txt",
        "skills/alpha/SKILL.md",
        "skills/beta/LICENSE.txt",
        "skills/beta/SKILL.md",
      ].map(reference),
      components: [skill("alpha"), skill("beta")],
    };
  }
  const tree = {
    "README.md": "# skills\n",
    "skills/alpha/LICENSE.txt": "Apache-2.0\n",
    "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: Alpha.\n---\nalpha\n",
    "skills/beta/LICENSE.txt": "Apache-2.0\n",
    "skills/beta/SKILL.md": "---\nname: beta\ndescription: Beta.\n---\nbeta\n",
    "spec/other.md": "not curated, outside every component\n",
  };

  it("re-reads every curated file from the pinned commit's objects", () => {
    const checkout = repository();
    checkout.commit(tree);
    const pin = checkout.commit({ ...tree, "skills/beta/SKILL.md": "---\nname: beta\n---\nnew\n" });
    writeFileSync(join(checkout.path, "README.md"), "working tree bytes play no part\n");
    const input = collectionCompilerInputAtPinV1(template(), pin, checkout.path, git) as {
      source: Json;
      files: { path: string; bytesBase64: string; sha256: string; size: number }[];
      components: Json[];
    };
    expect(input.source.commit).toBe(pin);
    const beta = input.files.find((file) => file.path === "skills/beta/SKILL.md");
    expect(Buffer.from(beta?.bytesBase64 ?? "", "base64").toString("utf8")).toBe(
      "---\nname: beta\n---\nnew\n",
    );
    for (const file of input.files) {
      const bytes = Buffer.from(file.bytesBase64, "base64");
      expect(file.size).toBe(bytes.length);
      expect(file.sha256).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    }
    expect(input.components).toEqual((template() as { components: Json[] }).components);
    expect(compilePinnedComponentCollectionV1(input).source.revisionId).toBe(pin);
  });

  it("refuses stale curation, a missing or linked file, another origin or an absent commit", () => {
    const stale = repository();
    const extra = stale.commit({ ...tree, "skills/alpha/extra.md": "new upstream file\n" });
    expect(() => collectionCompilerInputAtPinV1(template(), extra, stale.path, git)).toThrow(
      /skill:alpha is stale at [0-9a-f]{40}: skills\/alpha holds uncurated skills\/alpha\/extra\.md/,
    );
    const missing = repository();
    const { "skills/beta/LICENSE.txt": _gone, ...rest } = tree;
    const without = missing.commit(rest);
    expect(() => collectionCompilerInputAtPinV1(template(), without, missing.path, git)).toThrow(
      /curated file skills\/beta\/LICENSE\.txt is absent at/,
    );
    const linked = repository();
    const link = linked.commit({
      ...tree,
      "skills/beta/LICENSE.txt": { link: "../alpha/LICENSE.txt" },
    });
    expect(() => collectionCompilerInputAtPinV1(template(), link, linked.path, git)).toThrow(
      /curated file skills\/beta\/LICENSE\.txt is not a regular file at/,
    );
    const foreign = repository("https://github.com/example/skills");
    const other = foreign.commit(tree);
    expect(() => collectionCompilerInputAtPinV1(template(), other, foreign.path, git)).toThrow(
      /checkout origin is https:\/\/github\.com\/example\/skills, not anthropics\/skills/,
    );
    const empty = repository();
    empty.commit(tree);
    expect(() =>
      collectionCompilerInputAtPinV1(template(), "d".repeat(40), empty.path, git),
    ).toThrow(/does not hold commit d{40}/);
  });

  it("needs a checkout for anthropics-skills and none for the others", () => {
    expect(() => produceCompilerInputV1(root, "anthropics-skills", "0".repeat(40))).toThrow(
      /anthropics-skills needs a checkout/,
    );
    expect(() =>
      produceCompilerInputV1(root, "ponytail", recorded("ponytail.snapshot.json"), {
        checkout: root,
        git,
      }),
    ).toThrow(/a checkout applies only to anthropics-skills/);
    expect(() =>
      produceCompilerInputV1(root, "ponytail", recorded("ponytail.snapshot.json"), {
        vendorLock: {},
      }),
    ).toThrow(/a vendor lock applies only to ecc and superpowers/);
    expect(() => produceCompilerInputV1(root, "aih" as "ecc", "0".repeat(40))).toThrow(
      /no compiler input subject aih/,
    );
  });
});
