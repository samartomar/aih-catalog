import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractSupport } from "../../src/release/contracts.js";
import { sha256 } from "./fixtures.js";

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
      "release/release.json",
      "schemas/release/1.0.0.json",
      "dist/release/reader.js",
      "dist/release/node.js",
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
    expect(result).toEqual({
      support: { name: pkg.name, version: pkg.version },
      schemaId: "urn:aihq:catalog:release:1.0.0",
      sha256: releaseSha256,
      items: ["mattpocock.grill-me", "mattpocock.grilling"],
      configured: { "mattpocock.grill-me": true, "mattpocock.grilling": true },
      requires: { s0: ["s1"], s1: [] },
      installed: true,
      installedSha256: releaseSha256,
    });
  });
});
