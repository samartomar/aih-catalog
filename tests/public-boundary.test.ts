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
  it("publishes only the V2 API/CLI surface while publication remains deferred", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const index = readFileSync(resolve(root, "src/index.ts"), "utf8");

    expect(packageJson.name).toBe("@aihq/supported");
    expect(packageJson.bin).toEqual({ "aih-supported": "dist/cli.js" });
    expect(packageJson).not.toHaveProperty("publishConfig");
    expect(packageJson.scripts).not.toMatchObject({ publish: expect.any(String) });
    expect(index).toContain('from "./supported/signed-catalog-v2.js"');
    expect(index).not.toMatch(/V1|records-v1|provider-watcher-v1/);
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
