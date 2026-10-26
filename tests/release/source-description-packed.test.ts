import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("checks source descriptions and exact identities through the packed public source export only", () => {
  const output = execFileSync(process.execPath, ["tools/verify-source-description-consumer.mjs"], {
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  expect(output).toContain("Source description packed consumer passed");
}, 240_000);
