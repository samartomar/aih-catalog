import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const index = json("defaults/catalog-index-v1.json");
const presentation = json("defaults/catalog-presentation-v1.json");
const ids = index.entries.map((entry: { entryId: string }) => entry.entryId);

describe("REL4 current curation", () => {
  it("has one indexed row per server and keeps the distinct ECC integrations", () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("mcp.ecc.exa-web-search");
    expect(ids).toContain("mcp.ecc.token-optimizer");
    expect(ids).not.toContain("mcp.aih.exa.core-0-7-0");
    expect(ids).not.toContain("tool.aih.token-optimizer.core-0-7-0");
    for (const name of [
      "code-review-graph",
      "codebase-memory-mcp",
      "context7",
      "github",
      "sequential-thinking",
      "exa",
    ])
      expect(ids).not.toContain(`mcp.ecc.${name}`);
  });

  it("publishes Core-authored aih descriptions bound to the declaration source", () => {
    const aih = presentation.entries.filter((entry: { entryId: string }) =>
      entry.entryId.startsWith("mcp.aih."),
    );
    expect(aih).toHaveLength(7);
    for (const entry of aih) {
      expect(entry.description.state, entry.entryId).toBe("published");
      expect(entry.source?.path, entry.entryId).toBe(
        "src/production/data/core-product-declarations-v1.json",
      );
      expect(entry.source?.sha256, entry.entryId).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.management, entry.entryId).toBeDefined();
    }
    for (const name of ["github", "context7"]) {
      const entry = aih.find(
        (candidate: { entryId: string }) => candidate.entryId === `mcp.aih.${name}.core-0-7-0`,
      );
      expect(entry?.management).toBe("developer-managed");
      expect(entry?.managementNote).toContain("hosted service; network egress");
    }
    for (const name of [
      "code-review-graph",
      "codebase-memory-mcp",
      "sequential-thinking",
      "serena",
      "playwright",
    ]) {
      const entry = aih.find(
        (candidate: { entryId: string }) => candidate.entryId === `mcp.aih.${name}.core-0-7-0`,
      );
      expect(entry?.management).toBe("aih-managed");
    }
  });

  it("has no Ponytail in current Catalog surfaces, while preserving signed history", () => {
    expect(ids.some((id: string) => id.includes("ponytail"))).toBe(false);
    expect(
      presentation.sources.some((source: { repository?: string }) =>
        source.repository?.includes("ponytail"),
      ),
    ).toBe(false);
    const status = execFileSync("git", ["diff", "--name-only", "c7d421b4", "--", "catalog"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(status).toBe("");
  });
});
