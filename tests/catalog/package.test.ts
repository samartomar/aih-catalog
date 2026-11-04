import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as contracts from "../../src/catalog/contracts.js";
import * as node from "../../src/catalog/node.js";
import * as producer from "../../src/catalog/producer.js";
import * as reader from "../../src/catalog/reader.js";
import * as source from "../../src/catalog/source.js";

const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const ENTRY_POINTS = ["contracts", "node", "producer", "reader", "source"];
const SCAN_TARBALL = "vendor/aihq-scan-0.1.0.tgz";
const SCAN_SHA256 = "52f040b1e09dd4015d5c88b9b98b59d177626bf449f1e819448411552de59bcd";

/** The local npm CLI next to this Node; never npx. */
function npmCli(): string {
  for (const candidate of [
    process.env.npm_execpath,
    resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ])
    if (
      candidate &&
      isAbsolute(candidate) &&
      basename(candidate) === "npm-cli.js" &&
      existsSync(candidate)
    )
      return candidate;
  throw new Error("unable to resolve a local npm-cli.js");
}

describe("the package exposes exactly the five entry points", () => {
  it("exports only /source, /node, /producer, /reader and /contracts from dist/catalog", () => {
    expect(Object.keys(manifest.exports).sort()).toEqual(ENTRY_POINTS.map((name) => `./${name}`));
    for (const name of ENTRY_POINTS)
      expect(manifest.exports[`./${name}`]).toEqual({
        types: `./dist/catalog/${name}.d.ts`,
        import: `./dist/catalog/${name}.js`,
      });
    expect(manifest.main).toBeUndefined();
    expect(manifest.bin).toBeUndefined();
    expect(manifest.version).toBe("0.1.0");
  });

  it("ships no local-path dependency; development resolves Scan from the vendored tarball", () => {
    const shipped = { ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const [name, spec] of Object.entries(shipped))
      expect(String(spec), name).not.toMatch(/^(?:file:|link:|\.|\/|git|https?:)/);
    expect(manifest.dependencies["@aihq/scan"]).toBe("0.1.0");
    expect(manifest.bundleDependencies ?? manifest.bundledDependencies).toBeUndefined();
    expect(manifest.devDependencies["@aihq/scan"]).toBe(`file:${SCAN_TARBALL}`);
    const tarball = readFileSync(join(root, SCAN_TARBALL));
    expect(createHash("sha256").update(tarball).digest("hex")).toBe(SCAN_SHA256);
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    const locked = lock.packages["node_modules/@aihq/scan"];
    expect(locked.version).toBe("0.1.0");
    expect(locked.resolved).toBe(`file:${SCAN_TARBALL}`);
    expect(locked.integrity).toBe(
      `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    );
  });

  it("packs the built entry points and nothing else", () => {
    for (const name of ENTRY_POINTS)
      expect(existsSync(join(root, "dist", "catalog", `${name}.js`)), "run npm run build").toBe(
        true,
      );
    const packed = spawnSync(
      process.execPath,
      [npmCli(), "pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    expect(packed.status, packed.stderr).toBe(0);
    const [report] = JSON.parse(packed.stdout) as [{ files: { path: string; mode: number }[] }];
    const paths = report.files.map((file) => file.path).sort();
    for (const path of paths)
      expect(path, path).toMatch(
        /^(?:package\.json|README\.md|LICENSE|CHANGELOG\.md|dist\/catalog\/.+\.(?:js|d\.ts))$/,
      );
    for (const name of ENTRY_POINTS) {
      expect(paths).toContain(`dist/catalog/${name}.js`);
      expect(paths).toContain(`dist/catalog/${name}.d.ts`);
    }
    for (const file of report.files) expect(file.mode & 0o111, file.path).toBe(0);
  });
});

describe("nothing of the old model remains", () => {
  it("has no retired folders, formats, configs or scripts", () => {
    for (const path of [
      "release",
      "defaults",
      "catalog",
      "producer",
      "restructuring",
      "schemas",
      "fixtures",
      "workflows",
      "examples",
      "package-support.json",
      "package-support-1.1.json",
      "vitest.transition.config.ts",
      "src/cli.ts",
      "src/index.ts",
      "src/content",
      "src/producer",
      "src/production",
      "src/release",
      "src/supported",
    ])
      expect(existsSync(join(root, path)), path).toBe(false);
    const scripts = Object.keys(manifest.scripts);
    expect(scripts.filter((name) => /historical|candidate|release|materials/.test(name))).toEqual(
      [],
    );
  });

  it("exports none of the retired functions or other packages' formats", () => {
    const retired = [
      "readRelease",
      "readReleaseContent",
      "readReleaseIndex",
      "readReleaseSets",
      "resolveSelections",
      "resolveRelease",
      "readInstalledRelease",
      "readInstalledPreparedContent",
      "prepareProjectContext",
      "acquireBaselineArtifact",
      "prepareReleaseBaseline",
      "compileProducerDeclaration",
      "checkProducerDeclaration",
      "compileReleaseSets",
      "prepareSourceRefresh",
      "CORE_NATIVE_CLIENT_IDS",
      "itemEvidenceDescriptor",
    ];
    const modules = { contracts, node, producer, reader, source };
    for (const [name, module] of Object.entries(modules)) {
      const exported = Object.keys(module);
      expect(
        exported.filter((key) => retired.includes(key) || key.startsWith("compareRelease")),
        name,
      ).toEqual([]);
    }
  });
});
