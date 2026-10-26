import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("checks GitHub ref resolution and exact-commit acquisition through the packed public node export only", () => {
  const output = execFileSync(process.execPath, ["tools/verify-git-resolution-consumer.mjs"], {
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  expect(output).toContain("Git resolution packed consumer passed");
}, 240_000);
