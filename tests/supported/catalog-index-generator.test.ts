import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const temporaryRoots: string[] = [];
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data));
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function generator() {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return import("../../tools/generate-catalog-index.mjs");
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "aih-catalog-index-"));
  temporaryRoots.push(directory);
  const defaults = join(directory, "defaults");
  mkdirSync(defaults);
  writeJson(join(directory, "package.json"), { name: "@aihq/catalog", version: "0.2.0" });
  const seed = readJson(join(root, "defaults/default-catalog-v2.json"));
  const seedPath = join(defaults, "default-catalog-v2.json");
  writeJson(seedPath, seed);
  const paths = [
    ...Object.values(seed.artifacts),
    seed.qualification.report,
    ...seed.qualification.rights,
  ] as string[];
  for (const path of paths) {
    mkdirSync(dirname(join(defaults, path)), { recursive: true });
    cpSync(join(root, "defaults", path), join(defaults, path));
  }
  const manifestPath = join(defaults, "default-catalog-seed-manifest-v2.json");
  writeJson(manifestPath, {
    format: "aih-supported-candidate-seed-manifest",
    version: 1,
    seeds: ["default-catalog-v2.json"],
  });
  return { directory, defaults, seed, seedPath, manifestPath };
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("catalog consumer index generator", () => {
  it("indexes every manifest entry with original evidence and portable paths", async () => {
    const { generateCatalogIndex } = await generator();
    const result = generateCatalogIndex(root);
    const manifest = readJson(join(root, "defaults/default-catalog-seed-manifest-v2.json"));
    expect(result).toMatchObject({
      format: "aih-catalog-index",
      version: 1,
      package: { name: "@aihq/catalog", version: "0.2.0" },
      organizationAdmission: "not-authoritative",
    });
    expect(result.entries).toHaveLength(manifest.seeds.length);
    const ids = result.entries.map((entry: { entryId: string }) => entry.entryId);
    expect(ids).toEqual([...ids].sort());
    for (const entry of result.entries) {
      const original = readJson(join(root, entry.seed.path));
      expect(entry.subject).toMatchObject(original.subject);
      expect(entry.seed.sha256).toBe(hash(join(root, entry.seed.path)));
      expect(entry.capabilities).toEqual(original.capabilities);
      expect(entry.platforms).toEqual(original.platforms);
      const descriptors = [
        entry.qualification.report,
        ...entry.qualification.findings,
        ...entry.qualification.gaps,
        ...entry.qualification.rights,
      ];
      for (const descriptor of descriptors) {
        expect(descriptor.evidence).toEqual(readJson(join(root, descriptor.path)));
        expect(descriptor.sha256).toBe(hash(join(root, descriptor.path)));
      }
      for (const descriptor of Object.values(entry.artifacts) as {
        path: string;
        sha256: string;
      }[]) {
        expect(descriptor.sha256).toBe(hash(join(root, descriptor.path)));
      }
    }
    const brainstorming = result.entries.find(
      (entry: { entryId: string }) => entry.entryId === "skill.superpowers.brainstorming",
    );
    expect(brainstorming.subject.subjectDigest).toBe(
      "sha256:44edc8683954da5fe67f206034c5913d6460e63fd3472dfe2584dbeb323d667e",
    );
    expect(JSON.stringify(result)).not.toContain(root);
    expect(result).not.toHaveProperty("qualificationBasis");
  }, 30_000);

  it("is deterministic even when the manifest order changes", async () => {
    const { generateCatalogIndex, serializeCatalogIndex } = await generator();
    const data = fixture();
    writeJson(join(data.defaults, "second.json"), { ...data.seed, entryId: "recipe.second" });
    const manifest = readJson(data.manifestPath);
    manifest.seeds.push("second.json");
    writeJson(data.manifestPath, manifest);
    const first = serializeCatalogIndex(generateCatalogIndex(data.directory));
    manifest.seeds.reverse();
    writeJson(data.manifestPath, manifest);
    expect(serializeCatalogIndex(generateCatalogIndex(data.directory))).toBe(first);
  });

  it("rejects duplicate entry identities", async () => {
    const { generateCatalogIndex } = await generator();
    const data = fixture();
    writeJson(join(data.defaults, "duplicate.json"), data.seed);
    const manifest = readJson(data.manifestPath);
    manifest.seeds.push("duplicate.json");
    writeJson(data.manifestPath, manifest);
    expect(() => generateCatalogIndex(data.directory)).toThrow(/duplicate entryId/);
  });

  it.each([
    "../package.json",
    "/outside.json",
    "C:/outside.json",
    "evidence/../report.json",
  ])("rejects unsafe input path %s", async (unsafePath) => {
    const { generateCatalogIndex } = await generator();
    const data = fixture();
    data.seed.qualification.report = unsafePath;
    writeJson(data.seedPath, data.seed);
    expect(() => generateCatalogIndex(data.directory)).toThrow(/unsafe path/);
  });

  it("rejects a linked evidence directory", async () => {
    const { generateCatalogIndex } = await generator();
    const data = fixture();
    symlinkSync(join(data.defaults, "evidence"), join(data.defaults, "linked"), "junction");
    data.seed.qualification.report = data.seed.qualification.report.replace("evidence/", "linked/");
    writeJson(data.seedPath, data.seed);
    expect(() => generateCatalogIndex(data.directory)).toThrow(/linked path/);
  });

  it("rejects missing evidence rather than producing a partial entry", async () => {
    const { generateCatalogIndex } = await generator();
    const data = fixture();
    rmSync(join(data.defaults, data.seed.qualification.report));
    expect(() => generateCatalogIndex(data.directory)).toThrow();
  });

  it("rejects evidence bound to a different subject", async () => {
    const { generateCatalogIndex } = await generator();
    const data = fixture();
    const reportPath = join(data.defaults, data.seed.qualification.report);
    const report = readJson(reportPath);
    writeJson(reportPath, { ...report, subjectDigest: `sha256:${"0".repeat(64)}` });
    expect(() => generateCatalogIndex(data.directory)).toThrow(/evidence subject/);
  });

  it("rejects an unknown manifest version and a wrong evidence kind", async () => {
    const { generateCatalogIndex } = await generator();
    const data = fixture();
    const manifest = readJson(data.manifestPath);
    writeJson(data.manifestPath, { ...manifest, version: 99 });
    expect(() => generateCatalogIndex(data.directory)).toThrow(/manifest version/);
    writeJson(data.manifestPath, manifest);
    const reportPath = join(data.defaults, data.seed.qualification.report);
    writeJson(reportPath, { ...readJson(reportPath), kind: "finding" });
    expect(() => generateCatalogIndex(data.directory)).toThrow(/evidence kind/);
  });

  it("writes/checks the index and preserves the last output when input is invalid", () => {
    const data = fixture();
    const script = join(root, "tools/generate-catalog-index.mjs");
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd: data.directory,
        encoding: "utf8",
      });
    const first = run(data.directory);
    expect(first.status, first.stderr).toBe(0);
    const output = join(data.defaults, "catalog-index-v1.json");
    const bytes = readFileSync(output, "utf8");
    const check = run("--check", data.directory);
    expect(check.status, check.stderr).toBe(0);
    writeFileSync(output, "{}\n");
    expect(run("--check", data.directory).status).toBe(1);
    expect(readFileSync(output, "utf8")).toBe("{}\n");
    writeFileSync(output, bytes);
    rmSync(join(data.defaults, data.seed.qualification.report));
    expect(run(data.directory).status).toBe(1);
    expect(readFileSync(output, "utf8")).toBe(bytes);
  });
});
