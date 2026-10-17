import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("resolves mixed ECC and Extensions through exact installed archives and expands ordinary data", () => {
  const output = execFileSync(
    process.execPath,
    ["tools/verify-ecc-consumer.mjs", "--without-core"],
    {
      cwd: resolve(import.meta.dirname, "../.."),
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  const receipt = JSON.parse(output);
  expect(receipt.inventory).toEqual({ files: 3538, donorAssets: 442 });
  expect(receipt.items).toBe(697);
  expect(receipt.mixedSelections).toContain("extensions.skill.security-and-hardening");
  expect(receipt.mixedSelections).toContain("ecc.skill.api-design");
  expect(receipt.expansion.itemId).toBe("ecc.extra.api-reference");
  expect(receipt.core.status).toBe("not-run");
}, 180_000);
