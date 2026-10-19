import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportTargets } from "../../src/producer/package.js";
import { contractSupport } from "../../src/release/contracts.js";
import { seedConsumerLock } from "../../tools/seed-consumer-lock.mjs";
import { committedRelease, makePackageRoot, readTree } from "../producer/helpers.js";
import {
  fixtureRelease,
  type Json,
  MATT_ITEM_IDS,
  MATT_REQUIRED,
  releaseBytes,
  sha256,
} from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

function npmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      isAbsolute(candidate) &&
      basename(candidate) === "npm-cli.js" &&
      existsSync(candidate)
    ) {
      return candidate;
    }
  }
  throw new Error("unable to resolve a local npm-cli.js");
}
const env = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
  );

describe("declared public surface", () => {
  it("declares the actual package identity and one export per declared entry", () => {
    expect(contractSupport.package).toEqual({ name: pkg.name, version: pkg.version });
    for (const entry of contractSupport.entries) {
      expect(Object.keys(pkg.exports)).toContain(entry.export.replace("@aihq/catalog", "."));
    }
    expect(pkg.exports["./release.json"]).toBe("./release/release.json");
    expect(pkg.exports["./schemas/release/1.0.0.json"]).toBe("./schemas/release/1.0.0.json");
    const schema = JSON.parse(readFileSync(resolve(root, "schemas/release/1.0.0.json"), "utf8"));
    expect(schema.$id).toBe(contractSupport.contracts[0]?.id);
  });
});

describe("exact packed consumer", () => {
  let fixture = "";
  let installed = "";
  let consumer = "";
  let packedPaths: string[] = [];

  beforeAll(() => {
    if (!existsSync(resolve(root, "dist/release/reader.js"))) {
      throw new Error(
        "dist/release is missing; run npm run build:dist before the packed consumer test",
      );
    }
    fixture = mkdtempSync(join(tmpdir(), "aih-catalog-packed-release-"));
    const npm = npmCli();
    const [packed] = JSON.parse(
      execFileSync(
        process.execPath,
        [npm, "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", fixture],
        {
          cwd: root,
          env: env(),
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          timeout: 180_000,
        },
      ),
    ) as { filename: string; files: { path: string }[] }[];
    if (!packed) throw new Error("npm pack produced no artifact");
    packedPaths = packed.files.map(({ path }) => path);
    consumer = join(fixture, "consumer");
    seedConsumerLock(consumer, root);
    execFileSync(
      process.execPath,
      [
        npm,
        "install",
        "--prefix",
        consumer,
        "--ignore-scripts",
        "--offline",
        "--no-audit",
        "--no-fund",
        join(fixture, packed.filename),
      ],
      { cwd: fixture, env: env(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 180_000 },
    );
    installed = join(consumer, "node_modules", "@aihq", "catalog");
  }, 400_000);

  afterAll(() => {
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });

  it("ships the release, schema and entry modules byte-identically, and no test fixtures", () => {
    for (const path of [
      ...exportTargets(pkg.exports).map((target) => target.slice(2)),
      ...pkg.files.filter((path: string) => path.startsWith("docs/")),
    ]) {
      expect(packedPaths).toContain(path);
    }
    expect(
      packedPaths
        .filter((path) => path.startsWith("release/") || path.startsWith("schemas/"))
        .every(
          (path) =>
            sha256(readFileSync(join(installed, path))) ===
            sha256(readFileSync(resolve(root, path))),
        ),
    ).toBe(true);
    expect(packedPaths.some((path) => path.startsWith("tests/"))).toBe(false);
  });

  it("assembles producer fixtures from the complete packed surface", () => {
    const assembled = makePackageRoot(join(fixture, "producer-source"), committedRelease());
    const files = readTree(assembled);
    // The lock is a producer input for offline installation, never a packed asset.
    files.delete("package-lock.json");
    expect([...files.keys()].sort()).toEqual([...packedPaths].sort());
    for (const [path, bytes] of files) {
      expect(bytes.equals(readFileSync(join(installed, path))), path).toBe(true);
    }
  });

  it("selects the optional Guide with exact offline manual bytes through packed exports", () => {
    const script = `
      import assert from "node:assert/strict";
      import { readFileSync } from "node:fs";
      import { dirname, join } from "node:path";
      import { fileURLToPath } from "node:url";
      import { readInstalledRelease } from "@aihq/catalog/node";
      import { configureItem, listItems } from "@aihq/catalog/reader";
      const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
      const read = await readInstalledRelease({ root, release: "./release-guide.json" });
      assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
      assert.deepEqual(listItems(read.release).map(i => i.id), ["aihq.guide"]);
      const configured = configureItem({ release: read.release, itemId: "aihq.guide",
        configuration: {}, materialSource: read.source });
      assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
      const manual = read.release.items[0].materials.find(m => m.id === "manual");
      assert.equal(manual.sha256, "77b5c9d21968cf194ca2a86cb4cd2b94cf421081780c59d7fa5289de6a364462");
      assert(readFileSync(join(root, manual.path), "utf8").includes("Ask AIH Guide"));
    `;
    writeFileSync(join(consumer, "guide.mjs"), script);
    execFileSync(process.execPath, [join(consumer, "guide.mjs")], {
      cwd: consumer,
      timeout: 60_000,
    });
  });

  it("type-checks and runs a strict TypeScript Nuclei authoring consumer without allowJs", () => {
    const declarations = join(installed, "workflows/nuclei/author.d.mts");
    expect(pkg.exports["./workflows/nuclei"]).toEqual({
      types: "./workflows/nuclei/author.d.mts",
      import: "./workflows/nuclei/author.mjs",
    });
    expect(packedPaths).toContain("workflows/nuclei/author.d.mts");
    const program = `
      import * as nuclei from "@aihq/catalog/workflows/nuclei";
      import {
        authorAssessmentPolicy,
        authorPreparationPolicy,
        authorReconciliationPolicy,
        type NucleiAssessmentOptions,
        type NucleiExecutionPolicy,
        type NucleiHelperMaterial,
      } from "@aihq/catalog/workflows/nuclei";
      declare const console: { log(message: string): void };
      const helper: NucleiHelperMaterial = { id: "nuclei-helper",
        source: { kind: "local", input: "catalog" }, path: "workflows/nuclei/bin/linux-x64",
        sha256: "a".repeat(64), byteLength: 8000000 };
      const assessment: NucleiAssessmentOptions = { platform: "linux", helper,
        runDirectory: "/tmp/assessment-one", bundle: "/tmp/templates.tgz",
        bundleSha256: "b".repeat(64), bundleBytes: 1024, target: "http://host.docker.internal:8080/",
        allowHosts: ["host.docker.internal"], targetMode: "local-host", hostGateway: true,
        containerUser: "1000:1000", daemon: "unix:///var/run/docker.sock", dockerCli: "/usr/bin/docker",
        image: \`projectdiscovery/nuclei@sha256:\${"c".repeat(64)}\`,
        container: "aih-nuclei-test-one", network: "aih-nuclei-net-one" };
      const prepared: NucleiExecutionPolicy<"prepare"> = authorPreparationPolicy({ platform: "linux",
        helper, output: "/tmp/prepared-one", official: ["http/technologies/tech-detect.yaml"],
        customData: [{ source: "/tmp/words.txt", path: "words.txt" }] });
      const reused = authorPreparationPolicy({ platform: "linux", helper, output: "/tmp/prepared-two",
        reuse: { path: "/tmp/templates.tgz", sha256: "b".repeat(64), byteLength: 1024 } });
      const assessed: NucleiExecutionPolicy<"run"> = authorAssessmentPolicy(assessment);
      const reconciled: NucleiExecutionPolicy<"reconcile"> = authorReconciliationPolicy({
        platform: "linux", helper, runDirectory: assessment.runDirectory, daemon: assessment.daemon,
        dockerCli: assessment.dockerCli, container: assessment.container, network: assessment.network });
      const validation: "process.exit" = assessed.selections[0].recipe.inline.checks[0].kind;
      const noPreparationChecks: [] = prepared.selections[0].recipe.inline.checks;
      const refusals: string[] = [];
      const refuse = (name: string, author: () => unknown): void => {
        try { author(); } catch (error) { if (error instanceof Error) { refusals.push(name); return; } }
        throw new Error("accepted invalid " + name);
      };
      refuse("image-tag", () => authorAssessmentPolicy({ ...assessment,
        // @ts-expect-error a tag is not a pinned image digest
        image: "projectdiscovery/nuclei:latest" }));
      refuse("platform", () => authorAssessmentPolicy({ ...assessment,
        // @ts-expect-error macOS is not a selected helper platform
        platform: "darwin" }));
      refuse("target-mode", () => authorAssessmentPolicy({ ...assessment,
        // @ts-expect-error host networking is not a target mode
        targetMode: "host" }));
      refuse("resource-name", () => authorReconciliationPolicy({ ...assessment,
        // @ts-expect-error owned resources use the aih-nuclei- prefix
        container: "other-container" }));
      refuse("missing-container-user", () => {
        const { containerUser: _omitted, ...withoutUser } = assessment;
        // @ts-expect-error containerUser is required
        return authorAssessmentPolicy(withoutUser);
      });
      refuse("target-scheme", () => authorAssessmentPolicy({ ...assessment, target: "file:///tmp/a" }));
      refuse("reuse-with-selections", () =>
        // @ts-expect-error reusing a bundle excludes fresh template selections
        authorPreparationPolicy({ platform: "linux", helper, output: "/tmp/x", reuse: { path: "/tmp/b", sha256: "b".repeat(64), byteLength: 1 }, official: [] }));
      const declared = { authorPreparationPolicy: true, authorAssessmentPolicy: true,
        authorReconciliationPolicy: true } as const satisfies Record<keyof typeof nuclei, true>;
      const runtimeNames = Object.keys(nuclei).sort();
      const declaredNames = Object.keys(declared).sort();
      if (JSON.stringify(runtimeNames) !== JSON.stringify(declaredNames))
        throw new Error("runtime exports differ from declarations: " + JSON.stringify(runtimeNames));
      for (const name of runtimeNames)
        if (typeof (nuclei as Record<string, unknown>)[name] !== "function") throw new Error(name);
      const policies = [prepared, reused, assessed, reconciled];
      console.log(JSON.stringify({
        schemas: policies.map((policy) => policy.schema),
        modes: policies.map((policy) => policy.mode),
        recipes: policies.map((policy) => policy.selections[0].recipe.inline.id),
        reused: reused.selections[0].recipe.inline.operations[0].args.some((slot) => slot.literal === "--reuse-bundle"),
        validation, preparationChecks: noPreparationChecks.length, refusals, runtimeNames,
      }));
    `;
    const project = join(consumer, "nuclei-types");
    mkdirSync(project);
    writeFileSync(join(project, "consume.mts"), program);
    writeFileSync(
      join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          allowJs: false,
          skipLibCheck: false,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          lib: ["es2023"],
          types: [],
          noEmitOnError: true,
          rootDir: ".",
          outDir: "out",
        },
        files: ["consume.mts"],
      }),
    );
    const tsc = (args: string[]) =>
      spawnSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), ...args], {
        cwd: project,
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
      });
    const compiled = tsc(["-p", "tsconfig.json", "--listFiles"]);
    expect(compiled.status, `${compiled.stdout}${compiled.stderr}`).toBe(0);
    const listed = compiled.stdout.split(/\r?\n/u).map((line) => resolve(line.trim()));
    expect(listed).toContain(resolve(declarations));
    const ran = spawnSync(process.execPath, [join(project, "out", "consume.mjs")], {
      cwd: project,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
    expect(ran.status, ran.stderr).toBe(0);
    expect(JSON.parse(ran.stdout)).toEqual({
      schemas: Array(4).fill("urn:aihq:core:execution-policy:1.0.0"),
      modes: Array(4).fill("vibe"),
      recipes: ["nuclei-prepare", "nuclei-prepare", "nuclei-run", "nuclei-reconcile"],
      reused: true,
      validation: "process.exit",
      preparationChecks: 0,
      refusals: [
        "image-tag",
        "platform",
        "target-mode",
        "resource-name",
        "missing-container-user",
        "target-scheme",
        "reuse-with-selections",
      ],
      runtimeNames: [
        "authorAssessmentPolicy",
        "authorPreparationPolicy",
        "authorReconciliationPolicy",
      ],
    });
    // Without the shipped declarations the same strict program has no typed contract.
    const hidden = `${declarations}.hidden`;
    renameSync(declarations, hidden);
    try {
      const untyped = tsc(["-p", "tsconfig.json", "--noEmit"]);
      expect(untyped.status).not.toBe(0);
      expect(untyped.stdout).toContain("TS7016");
    } finally {
      renameSync(hidden, declarations);
    }
  }, 180_000);
  it("names the unavailable reference and the conflicting pair through the public reader", () => {
    type Item = { [key: string]: Json } & { dependencies: { [key: string]: Json[] } };
    const document = (name: string, items: Item[]) => {
      const base = fixtureRelease();
      base.package = { name, version: "1.0.0" };
      base.items = items;
      return base;
    };
    const item = (id: string, dependencies: Partial<Record<string, Json[]>> = {}): Item => {
      const alpha = structuredClone((fixtureRelease().items as Item[])[0] as Item);
      const recipe = alpha.recipe as { [key: string]: Json };
      return {
        ...alpha,
        id,
        label: id,
        inputs: {},
        recipe: { ...recipe, id, path: `release/recipes/${id}.json` },
        dependencies: { requires: [], optional: [], conflicts: [], ...dependencies },
      };
    };
    const primaryBytes = releaseBytes(
      document("conflict-catalog", [item("b", { conflicts: [{ itemId: "c" }] }), item("c")]),
    );
    const primary = sha256(primaryBytes);
    const secondaryBytes = releaseBytes(
      document("other-catalog", [
        item("a", {
          requires: [
            {
              itemId: "zz",
              itemSha256: "f".repeat(64),
              release: {
                source: { kind: "local", input: "maintained" },
                manifest: {
                  path: "release/release.json",
                  sha256: primary,
                  byteLength: primaryBytes.byteLength,
                },
              },
            },
          ],
        }),
      ]),
    );
    const secondary = sha256(secondaryBytes);
    writeFileSync(join(consumer, "primary.json"), primaryBytes);
    writeFileSync(join(consumer, "secondary.json"), secondaryBytes);
    const script = `
      import { readFileSync } from "node:fs";
      import { createHash } from "node:crypto";
      import { readRelease, resolveSelections } from "@aihq/catalog/reader";
      const load = (file) => {
        const bytes = readFileSync(file);
        const read = readRelease(bytes, { expectedSha256: createHash("sha256").update(bytes).digest("hex") });
        if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
        return read.release;
      };
      const primary = load("primary.json");
      const secondary = load("secondary.json");
      const root = (release, itemId) => ({ releaseSha256: release.sha256, itemId, scope: "project", configuration: {} });
      const own = (releases, roots) => resolveSelections({ releases, roots, skips: [] }).diagnostics
        .filter((d) => d.code !== "INPUT_INVALID");
      process.stdout.write(JSON.stringify({
        conflict: own({ [primary.sha256]: primary }, [root(primary, "c"), root(primary, "b")]),
        item: own({ [primary.sha256]: primary, [secondary.sha256]: secondary }, [root(secondary, "a")]),
        release: own({ [secondary.sha256]: secondary }, [root(secondary, "a")]),
      }));
    `;
    writeFileSync(join(consumer, "resolve-detail.mjs"), script);
    const result = JSON.parse(
      execFileSync(process.execPath, [join(consumer, "resolve-detail.mjs")], {
        cwd: consumer,
        encoding: "utf8",
        timeout: 60_000,
      }),
    );
    const ref = (releaseSha256: string, itemId: string) => ({
      releaseSha256,
      itemId,
      scope: "project",
    });
    const requires = `/releases/${secondary}/items/0/dependencies/requires/0`;
    expect(result).toEqual({
      conflict: [
        {
          code: "ITEM_CONFLICT",
          path: `/releases/${primary}/items/0/dependencies/conflicts/0`,
          message: "Conflicting items are selected together.",
          reference: ref(primary, "c"),
          declaredBy: ref(primary, "b"),
        },
      ],
      item: [
        {
          code: "ITEM_UNAVAILABLE",
          path: requires,
          message: "Referenced item is absent from the supplied release.",
          reference: { ...ref(primary, "zz"), itemSha256: "f".repeat(64) },
          declaredBy: ref(secondary, "a"),
        },
      ],
      release: [
        {
          code: "RELEASE_UNAVAILABLE",
          path: requires,
          message: "Referenced release was not supplied.",
          reference: { ...ref(primary, "zz"), itemSha256: "f".repeat(64) },
          declaredBy: ref(secondary, "a"),
        },
      ],
    });
  });

  it("exposes only the retained names and discovers every release through releaseInventory", () => {
    const script = `
      import assert from "node:assert/strict";
      import { readFileSync } from "node:fs";
      import { dirname } from "node:path";
      import { fileURLToPath } from "node:url";
      import * as contracts from "@aihq/catalog/contracts";
      import * as node from "@aihq/catalog/node";
      const internal = ["diagnostic", "failureResult", "packageIdentity", "verifyPackageRelease",
        "sha256", "ARCHIVE_PACKAGE_PREFIX", "CATALOG_PACKAGE_NAME", "CATALOG_PACKAGE_VERSION"];
      for (const name of internal) {
        assert.equal(name in node, false, "node exports " + name);
        assert.equal(name in contracts, false, "contracts exports " + name);
      }
      const unreachable = [];
      for (const specifier of ["@aihq/catalog/dist/release/package-release.js",
        "@aihq/catalog/dist/release/node.js", "@aihq/catalog/dist/release/document.js"]) {
        try { await import(specifier); } catch (error) {
          if (error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") { unreachable.push(specifier); continue; }
          throw error;
        }
      }
      const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
      const manifest = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")), "utf8"));
      const { releaseInventory, contractSupport } = contracts;
      assert.deepEqual(releaseInventory.package, { name: manifest.name, version: manifest.version });
      assert.deepEqual(contractSupport.package, releaseInventory.package);
      const releases = [];
      for (const entry of releaseInventory.releases) {
        const read = await node.readInstalledRelease({ root, release: entry.release });
        assert.equal(read.valid, true, entry.release + JSON.stringify(read.diagnostics));
        const declared = contractSupport.contracts.find((c) => c.id === entry.schema);
        const schema = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve(declared.schemaExport)), "utf8"));
        assert.equal(read.provenance.manifestPath, manifest.exports[entry.release].slice(2));
        assert.equal(fileURLToPath(import.meta.resolve(entry.export)),
          fileURLToPath(new URL(manifest.exports[entry.release], import.meta.resolve("@aihq/catalog/package.json"))));
        releases.push([entry.release, entry.purpose, entry.support, read.release.schema === entry.schema && schema.$id === entry.schema]);
      }
      const defaulted = await node.readInstalledRelease({ root });
      process.stdout.write(JSON.stringify({
        node: Object.keys(node).sort(),
        contracts: Object.keys(contracts).filter((name) => !/^(?:RELEASE|CORE)_/.test(name)).sort(),
        unreachable, releases,
        defaultRelease: releaseInventory.defaultRelease,
        defaulted: defaulted.provenance?.manifestPath,
      }));
    `;
    writeFileSync(join(consumer, "inventory.mjs"), script);
    const result = JSON.parse(
      execFileSync(process.execPath, [join(consumer, "inventory.mjs")], {
        cwd: consumer,
        encoding: "utf8",
        timeout: 120_000,
      }),
    );
    expect(result).toEqual({
      node: ["prepareProjectContext", "readInstalledRelease", "resolveRelease"],
      contracts: ["contractSupport", "releaseInventory"],
      unreachable: [
        "@aihq/catalog/dist/release/package-release.js",
        "@aihq/catalog/dist/release/node.js",
        "@aihq/catalog/dist/release/document.js",
      ],
      releases: [
        ["./release.json", "content", "supported", true],
        ["./release-1.1.json", "hook", "supported", true],
        ["./release-native-fixture.json", "native-fixture", "test-scope", true],
        ["./release-native-bundles.json", "native-fixture", "test-scope", true],
        ["./release-guide.json", "content", "supported", true],
        ["./release-extensions.json", "content", "supported", true],
        ["./release-ecc.json", "content", "supported", true],
        ["./release-superpowers.json", "content", "supported", true],
        ["./release-anthropic.json", "content", "supported", true],
      ],
      defaultRelease: "./release.json",
      defaulted: "release/release.json",
    });

    // Declarations agree: the internal names are absent and selection stays a closed union.
    const program = `
      import { releaseInventory, type ReleaseInventoryEntry } from "@aihq/catalog/contracts";
      import { readInstalledRelease, type ReleaseExport } from "@aihq/catalog/node";
      // @ts-expect-error acquisition helpers are internal
      import { verifyPackageRelease, packageIdentity, sha256, diagnostic, failureResult } from "@aihq/catalog/node";
      // @ts-expect-error package identity lives in support metadata
      import { CATALOG_PACKAGE_NAME, CATALOG_PACKAGE_VERSION, ARCHIVE_PACKAGE_PREFIX } from "@aihq/catalog/contracts";
      void [verifyPackageRelease, packageIdentity, sha256, diagnostic, failureResult,
        CATALOG_PACKAGE_NAME, CATALOG_PACKAGE_VERSION, ARCHIVE_PACKAGE_PREFIX];
      const fixtures: ReleaseExport[] = releaseInventory.releases
        .filter((entry: ReleaseInventoryEntry) => entry.support === "test-scope")
        .map((entry) => entry.release);
      // @ts-expect-error a release outside the inventory is not selectable
      const unknown: ReleaseExport = "./release-unknown.json";
      const name: "@aihq/catalog" = releaseInventory.package.name;
      void [fixtures, unknown, name, readInstalledRelease];
    `;
    const project = join(consumer, "inventory-types");
    mkdirSync(project);
    writeFileSync(join(project, "consume.mts"), program);
    writeFileSync(
      join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          // The Node entry's declarations name AbortSignal and fetch, which a Node host's types supply.
          lib: ["es2023", "dom"],
          types: [],
        },
        files: ["consume.mts"],
      }),
    );
    const compiled = spawnSync(
      process.execPath,
      [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
      { cwd: project, encoding: "utf8", timeout: 120_000, windowsHide: true },
    );
    expect(compiled.status, `${compiled.stdout}${compiled.stderr}`).toBe(0);
  }, 180_000);

  it("keeps the portable entries free of Node, filesystem and network imports", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      const specifiers = [
        ...source.matchAll(
          /\b(?:import|export)\b[^"';]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g,
        ),
      ].map((match) => match[1] ?? match[2]);
      for (const specifier of specifiers) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\.?\//);
        visit(resolve(dirname(file), specifier as string));
      }
      expect(source, file).not.toMatch(/\b(?:require\s*\(|process\.|Buffer\b|fetch\s*\()/);
    };
    visit(join(installed, "dist/release/reader.js"));
    visit(join(installed, "dist/release/contracts.js"));
    const reached = [...seen].map((file) => basename(file));
    expect(reached).not.toContain("node.js");
    expect(reached).not.toContain("archive.js");
  });

  it("reads, configures, validates and resolves through the public exports only", () => {
    const script = `
      import { readFileSync } from "node:fs";
      import { createHash } from "node:crypto";
      import { dirname } from "node:path";
      import { fileURLToPath } from "node:url";
      import { contractSupport } from "@aihq/catalog/contracts";
      import { readRelease, listItems, configureItem, validateSelectionSet } from "@aihq/catalog/reader";
      import { readInstalledRelease } from "@aihq/catalog/node";
      const bytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release.json")));
      const schema = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/schemas/release/1.0.0.json")), "utf8"));
      const clientSchema = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/schemas/release/1.4.0.json")), "utf8"));
      const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
      const read = readRelease(bytes, { expectedSha256 });
      if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
      const release = read.release;
      const source = { kind: "local", input: "catalog" };
      const configured = Object.fromEntries(listItems(release).map((item) => [item.id,
        configureItem({ release, itemId: item.id, configuration: {}, materialSource: source })]));
      const selections = listItems(release).map((item, index) => ({ id: "s" + index,
        item: { releaseSha256: release.sha256, itemId: item.id, itemSha256: item.itemSha256 }, configuration: {} }));
      const set = validateSelectionSet({ releases: { [release.sha256]: release }, selections });
      const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
      const installed = await readInstalledRelease({ root, sourceInput: "catalog" });
      process.stdout.write(JSON.stringify({
        support: contractSupport.package, schemaId: schema.$id, sha256: release.sha256,
        releaseSchema: release.schema, clientSchemaId: clientSchema.$id,
        clientIds: Object.fromEntries(listItems(release).filter((item) => item.kind === "client-adapter").map((item) => [item.id, item.clientId])),
        otherClientIds: listItems(release).filter((item) => item.kind !== "client-adapter" && item.clientId !== undefined).length,
        items: listItems(release).map((item) => item.id),
        configured: Object.fromEntries(Object.entries(configured).map(([id, r]) => [id, r.valid])),
        requires: set.requiresBySelectionId, installed: installed.valid, installedSha256: installed.release?.sha256,
      }));
    `;
    writeFileSync(join(consumer, "consume.mjs"), script);
    const result = JSON.parse(
      execFileSync(process.execPath, [join(consumer, "consume.mjs")], {
        cwd: consumer,
        encoding: "utf8",
        timeout: 60_000,
      }),
    );
    const releaseSha256 = sha256(readFileSync(resolve(root, "release/release.json")));
    const expectedItems = [
      "aihq.client.antigravity",
      "aihq.client.claude",
      "aihq.client.codex",
      "aihq.client.copilot",
      "aihq.client.cursor",
      "aihq.client.gemini",
      "aihq.client.kimi",
      "aihq.client.kiro",
      "aihq.client.opencode",
      "aihq.client.windsurf",
      "aihq.client.zed",
      "aihq.project-context",
      "aihq.project-context-pointer.agents-md",
      "aihq.project-context-pointer.claude-md",
      "aihq.project-context-pointer.copilot-instructions",
      "aihq.project-context-pointer.cursor-rules",
      "aihq.project-context-pointer.gemini-md",
      "aihq.project-context-pointer.kiro-steering",
      "aihq.project-context-pointer.windsurfrules",
      ...MATT_ITEM_IDS,
    ];
    const expectedRequires: Record<string, string[]> = {
      "aihq.client.antigravity": [
        "aihq.project-context-pointer.agents-md",
        "aihq.project-context-pointer.gemini-md",
      ],
      "aihq.client.claude": ["aihq.project-context-pointer.claude-md"],
      "aihq.client.codex": ["aihq.project-context-pointer.agents-md"],
      "aihq.client.copilot": ["aihq.project-context-pointer.copilot-instructions"],
      "aihq.client.cursor": ["aihq.project-context-pointer.cursor-rules"],
      "aihq.client.gemini": ["aihq.project-context-pointer.gemini-md"],
      "aihq.client.kimi": ["aihq.project-context-pointer.agents-md"],
      "aihq.client.kiro": ["aihq.project-context-pointer.kiro-steering"],
      "aihq.client.opencode": ["aihq.project-context-pointer.agents-md"],
      "aihq.client.windsurf": ["aihq.project-context-pointer.windsurfrules"],
      "aihq.client.zed": ["aihq.project-context-pointer.agents-md"],
      "aihq.project-context": [],
      "aihq.project-context-pointer.agents-md": ["aihq.project-context"],
      "aihq.project-context-pointer.claude-md": ["aihq.project-context"],
      "aihq.project-context-pointer.copilot-instructions": ["aihq.project-context"],
      "aihq.project-context-pointer.cursor-rules": ["aihq.project-context"],
      "aihq.project-context-pointer.gemini-md": ["aihq.project-context"],
      "aihq.project-context-pointer.kiro-steering": ["aihq.project-context"],
      "aihq.project-context-pointer.windsurfrules": ["aihq.project-context"],
      ...MATT_REQUIRED,
    };
    const requires = Object.fromEntries(
      expectedItems.map((id, index) => [
        `s${index}`,
        (expectedRequires[id] ?? []).map((required) => `s${expectedItems.indexOf(required)}`),
      ]),
    );
    expect(result).toEqual({
      support: { name: pkg.name, version: pkg.version },
      schemaId: "urn:aihq:catalog:release:1.0.0",
      releaseSchema: "urn:aihq:catalog:release:1.4.0",
      clientSchemaId: "urn:aihq:catalog:release:1.4.0",
      clientIds: Object.fromEntries(
        expectedItems
          .filter((id) => id.startsWith("aihq.client."))
          .map((id) => [id, id.slice("aihq.client.".length)]),
      ),
      otherClientIds: 0,
      sha256: releaseSha256,
      items: expectedItems,
      configured: Object.fromEntries(expectedItems.map((id) => [id, true])),
      requires,
      installed: true,
      installedSha256: releaseSha256,
    });
  });
});
