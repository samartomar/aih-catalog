import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("reads the Extensions release 1.7.0 content through the installed packed public exports only", () => {
  const root = resolve(import.meta.dirname, "../..");
  const output = execFileSync(process.execPath, ["tools/verify-extensions-17-consumer.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 300_000,
  });
  const receipt = JSON.parse(output);
  expect(receipt.ok).toBe(true);
  expect(receipt.cases).toBe(14);
  expect(receipt.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
}, 300_000);
