import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("preserves source-field basis through packed public compilation and checked reading", () => {
  const output = execFileSync(process.execPath, ["tools/verify-source-fact-basis-consumer.mjs"], {
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  expect(output).toContain("Source fact basis packed consumer passed");
}, 240_000);
