import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

/** The npm shipped with this Node, whether or not the suite was started through npm. */
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
    )
      return candidate;
  }
  throw new Error("unable to resolve a local npm-cli.js");
}

function sourceFiles(path = resolve(root, "src")): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = resolve(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });
}

describe("supported public V2 boundary", () => {
  it("exposes only the V2 API/CLI surface while publication remains deferred", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const index = readFileSync(resolve(root, "src/index.ts"), "utf8");

    expect(packageJson.name).toBe("@aihq/catalog");
    expect(packageJson.version).toBe("0.2.0");
    expect(packageJson).not.toHaveProperty("private");
    expect(packageJson.bin).toEqual({ "aih-supported": "dist/cli.js" });
    expect(packageJson.files).toEqual(["dist", "defaults", "README.md"]);
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.scripts).not.toMatchObject({ publish: expect.any(String) });
    expect(index).toContain('from "./supported/signed-catalog-v2.js"');
    expect(index).not.toMatch(/records-v1|provider-watcher-v1/);
    expect(index).toContain("QualificationReceiptSetV1");
    expect((packageJson.scripts as Record<string, string>)["test:cov"]).toMatch(
      /^vitest run --coverage(?:\s|$)/,
    );
    expect(readFileSync(resolve(root, "src/supported/signed-catalog-v2.ts"), "utf8")).toMatch(
      /export (?:async )?function runCatalogV2Cli/,
    );
    expect(readFileSync(resolve(root, "src/supported/signed-catalog-v2.ts"), "utf8")).not.toMatch(
      /\bDate\.now\s*\(|\bnew\s+Date\s*\(/,
    );
  });

  it("publishes the qualification basis through declared subpaths and packs its receipts", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
      scripts: Record<string, string>;
    };
    expect(packageJson.exports["./catalog-qualification.json"]).toBe(
      "./defaults/catalog-qualification-v1.json",
    );
    expect(packageJson.exports["./signed-catalog.json"]).toBe("./defaults/signed-catalog-v2.json");
    // No private key material is ever exported or packed.
    expect(Object.keys(packageJson.exports)).not.toContain("./catalog-signer-private.json");
    expect(packageJson.scripts["generate:catalog-qualification"]).toBe(
      "node tools/generate-catalog-qualification.mjs",
    );
    // Drift in the published receipts fails the same gate the index and collections use.
    expect(packageJson.scripts["check:catalog-index"]).toContain(
      "tools/generate-catalog-qualification.mjs --check",
    );
    const index = readFileSync(resolve(root, "src/index.ts"), "utf8");
    expect(index).toContain("readCatalogQualificationV1");
    expect(index).toContain("resolveCatalogQualificationPathV1");

    const raw = execFileSync(
      process.execPath,
      [npmCli(), "pack", "--ignore-scripts", "--dry-run", "--json"],
      { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
    );
    const packed = (JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>)[0];
    if (packed === undefined) throw new Error("npm pack produced no manifest");
    const paths = new Set(packed.files.map(({ path }) => path));
    expect(paths.has("defaults/catalog-qualification-v1.json")).toBe(true);
    expect(paths.has("defaults/signed-catalog-v2.json")).toBe(true);
    expect(paths.has("defaults/catalog-signer-root.json")).toBe(true);
    expect(paths.has("defaults/qualification/receipt-set.json")).toBe(true);
    const sidecar = JSON.parse(
      readFileSync(resolve(root, "defaults/catalog-qualification-v1.json"), "utf8"),
    ) as { entries: Array<{ receipt: { path: string } }> };
    expect(sidecar.entries.length).toBeGreaterThan(0);
    for (const entry of sidecar.entries) expect(paths.has(entry.receipt.path)).toBe(true);
    // The repository's own catalog generations still stay out of the package.
    expect([...paths].some((path) => path.startsWith("catalog/"))).toBe(false);
  }, 90_000);

  it("keeps all README and ai-coding truth surfaces explicit about Catalog V2 authority and use", () => {
    for (const path of ["README.md", "ai-coding/supported-catalog-v2.md"]) {
      const text = readFileSync(resolve(root, path), "utf8");
      expect(text).toMatch(/supported/i);
      expect(text).toMatch(/organization-qualified|org-qualified/i);
      expect(text).toMatch(/not.*admission authority|not-authoritative/i);
      expect(text).toMatch(/install/i);
      expect(text).toMatch(/candidate/i);
      expect(text).toMatch(/sign/i);
      expect(text).toMatch(/verify/i);
      expect(text).toMatch(/inspect/i);
      expect(text).toMatch(/version/i);
      expect(text).toMatch(/consum/i);
      expect(text).toMatch(/contribut/i);
      expect(text).toMatch(/publication[\s\S]{0,180}(?:separate|exact-SHA)/i);
      expect(text).toMatch(/Core.*does not.*consume.*Catalog V2/i);
      expect(text).toMatch(/aih-supported-catalog-member\/v2|catalogHeadSha256|candidateSha256/i);
      expect(text).toMatch(/inner claims.*declaration|signer declaration/i);
      expect(text).toMatch(/outer.*GitHub.*attestation|GitHub.*attestation.*verif/i);
      expect(text).toMatch(/transparency|publication.*exact-SHA/i);
    }
    for (const path of ["ai-coding/RULE_ROUTER.md", "ai-coding/project.md"]) {
      const text = readFileSync(resolve(root, path), "utf8");
      expect(text).toMatch(/supported-catalog-v2\.md/i);
      expect(text).toMatch(/public.*V2|V2.*public/i);
      expect(text).toMatch(/Core.*does not.*consume.*Catalog V2/i);
      expect(text).toMatch(/optional|not.*admission|not-authoritative/i);
      expect(text).not.toMatch(/deferred .*bootstrap|no product behavior|no public (?:API|CLI)/i);
    }
    const ciDiscipline = readFileSync(
      resolve(root, "ai-coding/rules/git-ci-discipline.md"),
      "utf8",
    );
    expect(ciDiscipline).toMatch(/(?:verify|verification).*(?:CI|workflow).*read-only/i);
    expect(ciDiscipline).toMatch(/manual.*outer.*(?:provenance|attestation)/i);
    expect(ciDiscipline).toMatch(/(?:publication|provenance).*separately authorized/i);
    expect(ciDiscipline).toMatch(/exact[- ]SHA|[0-9a-f]\{40\}/i);
    const project = JSON.parse(
      readFileSync(resolve(root, "ai-coding/project.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(project.description).toMatch(/public .*Catalog V2 producer/i);
    expect(project.description).not.toMatch(/private|bootstrap|no product/i);
    expect(project.entrypoints).toEqual(expect.arrayContaining(["dist/cli.js"]));
    expect(project.publication).toBe("published-npm-package");
    expect(project.supportedCatalogV2).toEqual({
      documentation: "ai-coding/supported-catalog-v2.md",
      entrypoints: ["dist/cli.js"],
      organizationAdmission: "not-authoritative",
      publicationStatus: "published-npm-package",
      coreConsumption: "independently-attested-qualification-receipt-v2",
      qualificationReceipt: "aih-supported-qualification-receipt-v2",
      status: "public-v2",
    });
  });

  it("keeps network/process/provider authority absent and confines cryptographic signing to one V2 module", () => {
    const signingModules: string[] = [];
    const forbiddenRuntimeAuthority =
      /["'](?:node:)?(?:child_process|http|https|net|tls|dgram)["']|\bprocess\.(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\b|\bfetch\s*\(|(?<![\w.$])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(|provider\.(request|poll)/i;
    expect("process.spawnSync()".match(forbiddenRuntimeAuthority)).not.toBeNull();
    expect("execFileSync()".match(forbiddenRuntimeAuthority)).not.toBeNull();
    expect("regex.exec()".match(forbiddenRuntimeAuthority)).toBeNull();
    for (const source of sourceFiles()) {
      const text = readFileSync(source, "utf8");
      expect(text, source).not.toMatch(forbiddenRuntimeAuthority);
      if (/\b(sign|createPrivateKey)\s*\(/.test(text))
        signingModules.push(relative(root, source).replaceAll("\\", "/"));
    }
    expect(signingModules).toEqual(["src/supported/signed-catalog-v2.ts"]);
  });
});
