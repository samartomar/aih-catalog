import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("supported bootstrap public boundary", () => {
  it("has no product entrypoint, CLI, publication, or controller surface", () => {
    const packageJson = readFileSync(resolve(root, "package.json"), "utf8");
    expect(readFileSync(resolve(root, "src/index.ts"), "utf8").trim()).toBe("export {};");
    expect(packageJson).not.toContain('"bin"');
    expect(packageJson).not.toContain("publish");
    expect(packageJson).not.toContain("catalog");
    expect(packageJson).not.toContain("sign");
  });
});
