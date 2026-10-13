import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("delivers permitted Anthropic closures and refuses restricted document copies through public contracts", () => {
  const output = execFileSync(
    process.execPath,
    ["tools/verify-anthropic-consumer.mjs", "--without-core"],
    { encoding: "utf8", timeout: 180_000 },
  );
  const receipt = JSON.parse(output);
  expect(receipt.inventory).toEqual({ files: 419, skillFiles: 413, donorSkills: 19 });
  expect(receipt.supportedSkills).toBe(14);
  expect(receipt.unsupportedSkills).toEqual(["doc-coauthoring", "docx", "pdf", "pptx", "xlsx"]);
  expect(receipt.requiredRefused).toBe(true);
  expect(receipt.optionalSkipped).toBe(true);
  expect(receipt.tamperRefused).toBe(true);
  expect(receipt.expansion.itemId).toBe("anthropic.extra.webapp-reference");
  expect(receipt.core.status).toBe("not-run");
}, 180_000);
