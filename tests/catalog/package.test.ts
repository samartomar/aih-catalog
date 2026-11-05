import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
const SCAN_TARBALL = "vendor/aihq-scan-0.0.0-dev.1.tgz";
const SCAN_SHA256 = "4f1368c9b89d4055d71f6dc788d0838300f80e39603273cfd663ce1d7ff508c0";

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

/** npm run exports its own script settings; the fixture's copied .npmrc must decide instead. */
function withoutScriptSettings(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^npm_config_(?:ignore_scripts|allow_scripts|strict_allow_scripts)$/i.test(key),
    ),
  );
}

/**
 * Every runtime export, per entry point: the contract's functions and data plus the additions
 * CONTRACTS.md lists under "Exports beyond the contract".
 */
const RUNTIME_EXPORTS = {
  contracts: [
    "fixtures",
    "formats",
    "kinds",
    "leftOverReasons",
    "limits",
    "refusalCodes",
    "schemas",
    "toolProfiles",
  ],
  node: ["fetchSource", "readContentFile", "readLocalSource"],
  producer: ["buildContent", "checkContent"],
  reader: [
    "aihContent",
    "availability",
    "derive",
    "getItem",
    "listItems",
    "planInstall",
    "planRecipe",
    "readContent",
    "readQualification",
    "readRecipe",
    "readToolProfile",
    "renderStep",
  ],
  source: ["findItems", "isNoticePath", "noticeCovers", "parseSourceLink"],
};

describe("the package exposes exactly the five entry points", () => {
  it("exports exactly the listed runtime names from each entry point", () => {
    const modules = { contracts, node, producer, reader, source };
    for (const [name, module] of Object.entries(modules))
      expect(Object.keys(module).sort(), name).toEqual(
        RUNTIME_EXPORTS[name as keyof typeof RUNTIME_EXPORTS],
      );
    const listed = readFileSync(join(root, "CONTRACTS.md"), "utf8");
    for (const name of [
      "isNoticePath",
      "noticeCovers",
      "aihContent",
      "toolProfiles",
      "leftOverReasons",
      "documentDepth",
    ])
      expect(listed, name).toContain(`\`${name}\``);
  });

  it("exports only /source, /node, /producer, /reader and /contracts from dist/catalog", () => {
    expect(Object.keys(manifest.exports).sort()).toEqual(ENTRY_POINTS.map((name) => `./${name}`));
    for (const name of ENTRY_POINTS)
      expect(manifest.exports[`./${name}`]).toEqual({
        types: `./dist/catalog/${name}.d.ts`,
        import: `./dist/catalog/${name}.js`,
      });
    expect(manifest.main).toBeUndefined();
    expect(manifest.bin).toBeUndefined();
    expect(manifest.version).toBe("0.0.0-dev.1");
  });

  it("ships no local-path dependency; development resolves Scan from the vendored tarball", () => {
    const shipped = { ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const [name, spec] of Object.entries(shipped))
      expect(String(spec), name).not.toMatch(/^(?:file:|link:|\.|\/|git|https?:)/);
    expect(manifest.dependencies["@aihq/scan"]).toBe("0.0.0-dev.1");
    expect(manifest.bundleDependencies ?? manifest.bundledDependencies).toBeUndefined();
    expect(manifest.devDependencies["@aihq/scan"]).toBe(`file:${SCAN_TARBALL}`);
    const tarball = readFileSync(join(root, SCAN_TARBALL));
    expect(createHash("sha256").update(tarball).digest("hex")).toBe(SCAN_SHA256);
    // The documents that quote it quote this value, and no other sha256 of the tarball.
    for (const name of ["README.md", "CONTRIBUTING.md"])
      expect(readFileSync(join(root, name), "utf8"), name).toContain(SCAN_SHA256);
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    const locked = lock.packages["node_modules/@aihq/scan"];
    expect(locked.version).toBe("0.0.0-dev.1");
    expect(locked.resolved).toBe(`file:${SCAN_TARBALL}`);
    expect(locked.integrity).toBe(
      `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    );
  });

  it("pins every runtime dependency to the exact version the lockfile installs", () => {
    // Rendered bytes depend on the YAML serializer, so plans stay byte-deterministic only
    // while every consumer gets the same version.
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    for (const [name, spec] of Object.entries(manifest.dependencies as Record<string, string>)) {
      expect(spec, name).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/);
      expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(spec);
    }
  });

  it("packs the built entry points and nothing else", () => {
    for (const name of ENTRY_POINTS)
      expect(
        existsSync(join(root, "dist", "catalog", `${name}.js`)),
        "built by tests/build-dist.ts",
      ).toBe(true);
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

describe("the repository's npm configuration", () => {
  const npmrc = () =>
    Object.fromEntries(
      readFileSync(join(root, ".npmrc"), "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "" && !/^\s*[#;]/.test(line))
        .map((line) => line.split("=").map((part) => part.trim())),
    );

  it("fails an install on any dependency install script nobody reviewed", () => {
    // npm 11.20 (Node 26.12.1) refuses unreviewed dependency scripts under
    // strict-allow-scripts; reviewed ones are listed in allowScripts, and none is allowed.
    expect(npmrc()["strict-allow-scripts"]).toBe("true");
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    const withScripts = Object.entries(
      lock.packages as Record<string, { hasInstallScript?: boolean }>,
    )
      .filter(([path, entry]) => path !== "" && entry.hasInstallScript === true)
      .map(([path]) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length))
      .sort();
    expect(Object.keys(manifest.allowScripts ?? {}).sort()).toEqual(withScripts);
    for (const name of withScripts) expect(manifest.allowScripts[name], name).toBe(false);
  });

  it("refuses an install by an npm too old to honour strict-allow-scripts", () => {
    // An older npm ignores the unknown setting silently; engine-strict makes it stop instead.
    expect(npmrc()["engine-strict"]).toBe("true");
    expect(manifest.engines.npm).toBe(">=11.20.0");
  });

  it("keeps the package's own lifecycle scripts, so packing builds first", () => {
    // ignore-scripts would also skip prepack (a tarball without dist) and prepublishOnly.
    expect(npmrc()["ignore-scripts"]).toBeUndefined();
    const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-npmrc-"));
    try {
      copyFileSync(join(root, ".npmrc"), join(fixture, ".npmrc"));
      writeFileSync(
        join(fixture, "package.json"),
        JSON.stringify({
          name: "npmrc-fixture",
          version: "1.0.0",
          private: true,
          scripts: { prepack: "node -e \"require('fs').writeFileSync('built','')\"" },
        }),
      );
      const packed = spawnSync(process.execPath, [npmCli(), "pack", "--dry-run"], {
        cwd: fixture,
        encoding: "utf8",
        env: withoutScriptSettings(),
      });
      expect(packed.status, packed.stderr).toBe(0);
      expect(existsSync(join(fixture, "built"))).toBe(true);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
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

describe("tests reach the library through its entry points", () => {
  it("import nothing from src/catalog/internal", () => {
    const dir = join(root, "tests", "catalog");
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts")))
      expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(
        /from "\.\.\/\.\.\/src\/catalog\/internal\//,
      );
  });
});
