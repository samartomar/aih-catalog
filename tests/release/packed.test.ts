import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportTargets } from "../../src/producer/package.js";
import { contractSupport } from "../../src/release/contracts.js";
import { seedConsumerLock } from "../../tools/seed-consumer-lock.mjs";
import { committedRelease, makePackageRoot, readTree } from "../producer/helpers.js";
import { MATT_ITEM_IDS, MATT_REQUIRED, sha256 } from "./fixtures.js";

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
