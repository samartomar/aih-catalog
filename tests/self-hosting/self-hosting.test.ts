import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const boundary = "Never run an installed aih-supported against this checkout.";
const read = (path: string): string => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

function managedBody(text: string): string {
  const match = text.match(
    /<!-- BEGIN aih-supported-canonical:shared -->\n\n([\s\S]*?)\n\n<!-- END aih-supported-canonical:shared -->/,
  );
  if (match?.[1] === undefined) throw new Error("missing aih-supported shared canon block");
  return match[1].trim();
}

describe("aih-supported self-hosting boundary", () => {
  it("keeps root bootloaders aligned with the public-safe shared canon", () => {
    const shared = read("ai-coding/adapters/_shared-canonical-block.md").trim();
    for (const path of ["AGENTS.md", "CLAUDE.md"])
      expect(managedBody(read(path)), path).toBe(shared);
  });

  it("states the no-self-application boundary on every always-loaded surface", () => {
    for (const path of [
      "AGENTS.md",
      "CLAUDE.md",
      "ai-coding/RULE_ROUTER.md",
      "ai-coding/SELF-HOSTING.md",
      "ai-coding/rules/agent-behavior-core.md",
      "ai-coding/rules/repo-ai-tools.md",
    ])
      expect(read(path), path).toContain(boundary);
  });
});
