import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function sourceFiles(path = resolve(root, "src")): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = resolve(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });
}

describe("supported bootstrap public boundary", () => {
  it("has no product entrypoint, CLI, publication, or controller surface", () => {
    const packageJson = readFileSync(resolve(root, "package.json"), "utf8");
    expect(readFileSync(resolve(root, "src/index.ts"), "utf8").trim()).toBe("export {};");
    expect(packageJson).not.toContain('"bin"');
    expect(packageJson).not.toContain("publish");
    expect(packageJson).not.toContain("catalog");
    expect(packageJson).not.toContain("sign");
  });

  it("keeps dormant supported contracts internal and incapable of network, process, provider, or signing work", () => {
    for (const source of sourceFiles()) {
      const text = readFileSync(source, "utf8");
      expect(text, source).not.toMatch(
        /node:(child_process|https|http|net|tls|dgram)|\b(fetch|spawn|exec|fork)\s*\(|provider\.(request|poll)|sign(?:ing|ature)?\s*\(/i,
      );
    }
  });
});
