import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { compileProducerDeclaration } from "../../src/release/producer.js";
import { configureItem, readRelease, resolveSelections } from "../../src/release/reader.js";

it("compiles pinned ECC content with notices and configures an exact memory MCP alongside a skill", () => {
  const declaration = JSON.parse(readFileSync("producer/ecc/declaration.json", "utf8"));
  const snapshot = JSON.parse(readFileSync("producer/ecc/snapshot.json", "utf8"));
  const sourceFiles = snapshot.sources.map(
    (source: { id: string; revision: string; files: { path: string; base64: string }[] }) => ({
      source: source.id,
      revision: source.revision,
      files: {
        ...Object.fromEntries(
          source.files.map((file) => [
            file.path,
            new Uint8Array(Buffer.from(file.base64, "base64")),
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(snapshot.recipes[source.id]).map(([path, text]) => [
            path,
            new TextEncoder().encode(text as string),
          ]),
        ),
      },
    }),
  );
  const compiled = compileProducerDeclaration({ declaration, sourceFiles });
  expect(compiled.status, JSON.stringify(compiled.diagnostics)).toBe("ok");
  if (compiled.status !== "ok") return;
  // Golden source identity comes from the retained independently pinned donor.
  expect(compiled.value.release.metadata).toMatchObject({
    suppliedSources: [
      {
        source: "ecc",
        revision: "5064474d4d762dc9640234a41617cccb79185cec",
        files: expect.arrayContaining([
          {
            path: "skills/api-design/SKILL.md",
            sha256: "bfae53167acc91caff0ff9ab73a80ee3fd92caccdfa445c88302c3bf95255156",
            byteLength: 13227,
          },
        ]),
      },
    ],
  });
  const checked = readRelease(compiled.value.releaseBytes, {
    expectedSha256: compiled.value.releaseSha256,
  });
  expect(checked.valid).toBe(true);
  if (!checked.valid) return;
  const resolved = resolveSelections({
    releases: { [checked.release.sha256]: checked.release },
    roots: [
      {
        releaseSha256: checked.release.sha256,
        itemId: "ecc.skill.api-design",
        scope: "project",
        configuration: {},
      },
      {
        releaseSha256: checked.release.sha256,
        itemId: "ecc.claude.mcp.memory",
        scope: "project",
        configuration: {},
      },
    ],
    skips: [],
  });
  expect(resolved.status, JSON.stringify(resolved.diagnostics)).toBe("ok");
  if (resolved.status !== "ok") return;
  expect(resolved.value.selections.map((s) => s.item.itemId)).toContain("ecc.notices");
  const configured = configureItem({
    release: checked.release,
    itemId: "ecc.claude.mcp.memory",
    configuration: {},
    materialSource: { kind: "local", input: "catalog" },
  });
  expect(configured.valid).toBe(true);
  const item = declaration.items.find(
    (item: { id: string }) => item.id === "ecc.claude.mcp.memory",
  );
  const recipe = JSON.parse(snapshot.recipes.ecc[item.recipePath]);
  expect(recipe.prerequisites).toEqual([{ kind: "executable", name: "npx" }]);
  expect(
    recipe.operations.find((op: { kind: string }) => op.kind === "config.entries").entries,
  ).toContainEqual({
    action: "set",
    path: ["mcpServers", "memory"],
    value: { literal: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] } },
  });
}, 90_000);
