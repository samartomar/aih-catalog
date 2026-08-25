import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

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
    expect(packageJson.version).toBe("0.1.2");
    expect(packageJson).not.toHaveProperty("private");
    expect(packageJson.bin).toEqual({ "aih-supported": "dist/cli.js" });
    expect(packageJson.files).toEqual(["dist", "defaults", "README.md"]);
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.scripts).not.toMatchObject({ publish: expect.any(String) });
    expect(index).toContain('from "./supported/signed-catalog-v2.js"');
    expect(index).not.toMatch(/V1|records-v1|provider-watcher-v1/);
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
      expect(text).toMatch(/publication.*deferred|publish.*separate/i);
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
    expect(project.publication).toBe("prepublication-source-candidate");
    expect(project.supportedCatalogV2).toEqual({
      documentation: "ai-coding/supported-catalog-v2.md",
      entrypoints: ["dist/cli.js"],
      organizationAdmission: "not-authoritative",
      publicationStatus: "prepublication-source-candidate",
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
