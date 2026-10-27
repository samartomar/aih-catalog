import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("delivers the authored artifact scaffold through packed public material", () => {
  const receipt = JSON.parse(
    execFileSync(process.execPath, ["tools/verify-web-artifacts-consumer.mjs", "--without-core"], {
      encoding: "utf8",
      timeout: 180_000,
    }),
  );
  expect(receipt.configured).toBe(true);
  expect(receipt.scaffolded).toBe(true);
  expect(receipt.existingProjectRefused).toBe(true);
  expect(receipt.tamperRefused).toBe(true);
  expect(receipt.core.status).toBe("not-run");
  expect(receipt.build.status).toBe("not-run");
}, 180_000);
