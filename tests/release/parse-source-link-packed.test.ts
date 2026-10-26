import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("parses source links through the packed public source export only", () => {
  const output = execFileSync(process.execPath, ["tools/verify-source-link-consumer.mjs"], {
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  expect(output).toContain("Source link packed consumer passed");
}, 240_000);
