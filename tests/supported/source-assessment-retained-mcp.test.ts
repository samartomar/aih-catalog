import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Retention = {
  selectCurrentClosureRowsV1(
    rows: { kind: string; name: string; files: string[] }[],
    index: unknown,
    provider: string,
  ): { kind: string; name: string; files: string[] }[];
  preserveUnmappedMcpRowsV1(input: {
    root: string;
    index: unknown;
    provider: string;
    names: string[];
    sourceCommit: string;
  }): Map<string, Buffer>;
};

const api = async (): Promise<Retention> => {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return (await import("../../tools/generate-source-assessment-rows.mjs")) as Retention;
};
const root = resolve("defaults/workbench/ecc");
const index = JSON.parse(readFileSync(resolve("defaults/catalog-index-v1.json"), "utf8"));
const sourceCommit = "5064474d4d762dc9640234a41617cccb79185cec";

describe("retaining committed P-prime MCP rows during P-double-prime regeneration", () => {
  it("selects only current rows and retains an uncovered MCP byte for byte", async () => {
    const tool = await api();
    expect(
      tool
        .selectCurrentClosureRowsV1(
          [
            { kind: "mcp", name: "browser-use", files: ["mcp-configs/mcp-servers.json"] },
            { kind: "mcp", name: "exa", files: [".mcp.json"] },
          ],
          index,
          "ecc",
        )
        .map((row) => row.name),
    ).toEqual(["browser-use"]);
    const files = tool.preserveUnmappedMcpRowsV1({
      root,
      index,
      provider: "ecc",
      names: ["browser-use"],
      sourceCommit,
    });
    expect(files.get("mcp.ecc.browser-use/evidence/report.json")).toEqual(
      readFileSync(join(root, "mcp.ecc.browser-use/evidence/report.json")),
    );
    expect(files.get("mcp.ecc.browser-use/seed.json")).toEqual(
      readFileSync(join(root, "mcp.ecc.browser-use/seed.json")),
    );
  });

  it("refuses an index digest mismatch or a non-MCP preservation request", async () => {
    const tool = await api();
    const args = { root, index, provider: "ecc", names: ["browser-use"], sourceCommit };
    const altered = structuredClone(index);
    altered.entries.find(
      (entry: { entryId: string }) => entry.entryId === "mcp.ecc.browser-use",
    ).seed.sha256 = "0".repeat(64);
    expect(() => tool.preserveUnmappedMcpRowsV1({ ...args, index: altered })).toThrow(
      "retained-row-digest",
    );
    expect(() =>
      tool.preserveUnmappedMcpRowsV1({ ...args, names: ["skill.ecc.api-design"] }),
    ).toThrow("retained-row-kind");
  });

  it("refuses duplicate current index IDs before selection or preservation", async () => {
    const tool = await api();
    const duplicate = structuredClone(index);
    duplicate.entries.push(
      structuredClone(
        duplicate.entries.find(
          (entry: { entryId: string }) => entry.entryId === "mcp.ecc.browser-use",
        ),
      ),
    );
    expect(() => tool.selectCurrentClosureRowsV1([], duplicate, "ecc")).toThrow(
      "current-index-duplicate-entry-id",
    );
    expect(() =>
      tool.preserveUnmappedMcpRowsV1({
        root,
        index: duplicate,
        provider: "ecc",
        names: ["browser-use"],
        sourceCommit,
      }),
    ).toThrow("current-index-duplicate-entry-id");
  });
});
