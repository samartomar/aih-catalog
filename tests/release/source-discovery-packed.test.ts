import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("preserves source purpose through packed preparation and reading", () => {
  const output = execFileSync(process.execPath, ["tools/verify-source-discovery-consumer.mjs"], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  expect(output).toContain("Source discovery packed consumer passed");
}, 120_000);
