import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const manifest = () => JSON.parse(read("package.json"));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Same npm lookup as the historical public-boundary check; never invoke npx. */
function npmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates)
    if (
      candidate &&
      isAbsolute(candidate) &&
      basename(candidate) === "npm-cli.js" &&
      existsSync(candidate)
    )
      return candidate;
  throw new Error("unable to resolve a local npm-cli.js");
}

/** npm run forwards this flag, but npm rejects it for nested project installs. */
function isolatedNpmEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
  );
}
describe("Catalog migration boundary", () => {
  it("refuses the configured publication lifecycle even without private metadata", () => {
    const pkg = manifest();
    expect(pkg.private).toBe(true);
    const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-publish-refusal-"));
    try {
      mkdirSync(join(fixture, "tools"));
      copyFileSync(
        resolve(root, "tools/refuse-publication.mjs"),
        join(fixture, "tools/refuse-publication.mjs"),
      );
      writeFileSync(
        join(fixture, "package.json"),
        JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          private: false,
          scripts: { prepublishOnly: pkg.scripts.prepublishOnly },
        }),
      );
      const refusal = spawnSync(process.execPath, [npmCli(), "run", "prepublishOnly"], {
        cwd: fixture,
        encoding: "utf8",
        env: isolatedNpmEnvironment(),
      });
      expect(refusal.status, refusal.stderr).toBe(1);
      expect(refusal.stderr).toContain("publication is blocked");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
  it("packs actual donor bytes and reads verified content in a disposable installed consumer", () => {
    const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-packed-migration-"));
    const npm = npmCli();
    try {
      const raw = execFileSync(
        process.execPath,
        [npm, "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", fixture],
        {
          cwd: root,
          env: isolatedNpmEnvironment(),
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
          timeout: 120_000,
        },
      );
      const [packed] = JSON.parse(raw) as Array<{
        filename: string;
        files: Array<{ path: string }>;
      }>;
      if (!packed) throw new Error("npm pack produced no artifact");
      const paths = packed.files.map(({ path }) => path);
      expect(paths).toContain("LICENSE");
      expect(paths).toContain("dist/index.js");
      expect(paths).toContain("defaults/catalog-index-v1.json");
      for (const path of paths) {
        expect(path, path).not.toMatch(
          /^(?:ai-coding|tools|tests|docs|\.git|\.codex|\.serena|\.code-review-graph|\.codebase-memory|catalog)\//u,
        );
        expect(path, path).not.toMatch(/(?:private-key|\.pem$|\.env(?:\.|$))/u);
        expect(path, path).not.toContain("..");
      }
      const tarball = join(fixture, packed.filename);
      const originalHash = hash(readFileSync(tarball));
      const consumer = join(fixture, "consumer");
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
          tarball,
        ],
        {
          cwd: fixture,
          env: isolatedNpmEnvironment(),
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          timeout: 120_000,
        },
      );
      expect(hash(readFileSync(tarball))).toBe(originalHash);
      const installed = join(consumer, "node_modules", "@aihq", "catalog");
      for (const path of paths)
        expect(hash(readFileSync(join(installed, path))), `installed byte identity: ${path}`).toBe(
          hash(readFileSync(resolve(root, path))),
        );
      const script = [
        'import { readFileSync } from "node:fs";',
        'import { dirname } from "node:path";',
        'import { fileURLToPath } from "node:url";',
        'import { readCatalogContentV1 } from "@aihq/catalog";',
        'const packageRoot = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));',
        'const bytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/catalog-index.json")));',
        "const content = readCatalogContentV1({bytes, input:{root:packageRoot,verifyArtifacts:true}});",
        'if (!content || content.status.artifacts !== "verified" || content.entries.length === 0) throw new Error("packed donor content failed verification");',
        "process.stdout.write(JSON.stringify({structure:content.status.structure,artifacts:content.status.artifacts,entries:content.entries.length}));",
      ].join("\n");
      writeFileSync(join(consumer, "inspect.mjs"), script);
      const inspected = JSON.parse(
        execFileSync(process.execPath, [join(consumer, "inspect.mjs")], {
          cwd: consumer,
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          timeout: 60_000,
        }),
      );
      expect(inspected).toMatchObject({ structure: "valid", artifacts: "verified" });
      expect(inspected.entries).toBeGreaterThan(0);
      expect(readFileSync(join(installed, "LICENSE"), "utf8")).toContain("Apache License");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 300_000);
});
