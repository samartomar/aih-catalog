import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("verifies selected TUF roots through packed public exports with local fixture metadata", () => {
  const output = execFileSync(process.execPath, ["tools/verify-release-index-tuf-consumer.mjs"], {
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  expect(output).toContain("TUF packed consumer passed");
}, 240_000);
