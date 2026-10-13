import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("uses installed public exports for multi-release composition and compatible data-only expansion", () => {
  const root = resolve(import.meta.dirname, "../..");
  const output = execFileSync(process.execPath, ["tools/verify-authoring-consumer.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000,
  });
  const receipt = JSON.parse(output);
  expect(receipt.cases.map((entry: { selectionCount: number }) => entry.selectionCount)).toEqual([
    4, 5,
  ]);
  expect(receipt.sourceReleaseSha256).toBe(receipt.installedReleaseSha256);
  expect(receipt.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(receipt.refusals).toContain("forged-reader-handle");
}, 180_000);
