import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("prepares sibling bundles for both exact digests using a fixture-only signer", () => {
  const output = execFileSync(process.execPath, ["tools/fixtures/release-signing-proof.mjs"], {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  expect(output).toContain("Signing preparation passed");
});
