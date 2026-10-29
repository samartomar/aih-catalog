import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("meets the Catalog contract in every prepared release 1.7.0 content, read through the installed packed exports only", () => {
  const root = resolve(import.meta.dirname, "../..");
  const output = execFileSync(process.execPath, ["tools/verify-conformance-consumer.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 300_000,
  });
  const receipt = JSON.parse(output);
  expect(receipt.ok).toBe(true);
  expect(receipt.cases).toBe(13);
  expect(receipt.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
}, 300_000);
