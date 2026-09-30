import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const boundary = "Never run an installed aih-supported against this checkout.";
const read = (path: string): string =>
  readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

describe("aih-supported self-hosting boundary", () => {
  it("states the no-self-application boundary in agent instructions and technical references", () => {
    for (const path of [
      "AGENTS.md",
      "ai-coding/RULE_ROUTER.md",
      "ai-coding/SELF-HOSTING.md",
      "ai-coding/rules/agent-behavior-core.md",
      "ai-coding/rules/repo-ai-tools.md",
    ])
      expect(read(path), path).toContain(boundary);
  });
});
