import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("acquires ordinary npm snapshots and prepares supplied content through installed public exports", () => {
  const output = execFileSync(process.execPath, ["tools/verify-npm-snapshot-consumer.mjs"], {
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  expect(output).toContain("npm snapshot packed consumer passed");
}, 240_000);
