import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("delivers executable requirements without mistaking copied bytes for readiness", () => {
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      ["tools/verify-executable-content-consumer.mjs", "--without-core"],
      { encoding: "utf8", timeout: 180_000 },
    ),
  );
  expect(result.assets).toBe(113);
  expect(result.configured).toBe(true);
  expect(result.absentRuntimeRefused).toBe(true);
  expect(result.tamperRefused).toBe(true);
  expect(result.native).toBe("not-run");
}, 180_000);
