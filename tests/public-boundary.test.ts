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

    expect(packageJson.name).toBe("@aihq/supported");
    expect(packageJson.version).toBe("1.0.0");
    expect(packageJson.bin).toEqual({ "aih-supported": "dist/cli.js" });
    expect(packageJson.files).toEqual(["dist", "defaults", "README.md"]);
    expect(packageJson).not.toHaveProperty("publishConfig");
    expect(packageJson.scripts).not.toMatchObject({ publish: expect.any(String) });
    expect(index).toContain('from "./supported/signed-catalog-v2.js"');
    expect(index).not.toMatch(/V1|records-v1|provider-watcher-v1/);
  });

  it("keeps all README and ai-coding truth surfaces explicit about Catalog V2 authority and use", () => {
    const truthSurfaces = [
      "README.md",
      "ai-coding/RULE_ROUTER.md",
      "ai-coding/project.md",
      "ai-coding/project.json",
      "ai-coding/supported-catalog-v2.md",
    ];
    for (const path of truthSurfaces) {
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
    }
  });

  it("keeps network/process/provider authority absent and confines cryptographic signing to one V2 module", () => {
    const signingModules: string[] = [];
    for (const source of sourceFiles()) {
      const text = readFileSync(source, "utf8");
      expect(text, source).not.toMatch(
        /node:(child_process|http|https|net|tls|dgram)|\b(fetch|spawn|exec|fork)\s*\(|provider\.(request|poll)/i,
      );
      if (/\b(sign|createPrivateKey)\s*\(/.test(text))
        signingModules.push(relative(root, source).replaceAll("\\", "/"));
    }
    expect(signingModules).toEqual(["src/supported/signed-catalog-v2.ts"]);
  });
});
