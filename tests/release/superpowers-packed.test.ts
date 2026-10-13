import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("uses real mixed-family Superpowers content and expands through packed public contracts", () => {
  const output = execFileSync(
    process.execPath,
    ["tools/verify-superpowers-consumer.mjs", "--without-core"],
    { encoding: "utf8", timeout: 180_000 },
  );
  const receipt = JSON.parse(output);
  expect(receipt.inventory).toEqual({ files: 231, donorAssets: 16 });
  expect(receipt.items).toBe(59);
  expect(receipt.mixedSelections).toContain("extensions.skill.security-and-hardening");
  expect(receipt.mixedSelections).toContain("superpowers.skill.test-driven-development");
  expect(receipt.expansion.itemId).toBe("superpowers.extra.tdd-reference");
  expect(receipt.core.status).toBe("not-run");
}, 180_000);
