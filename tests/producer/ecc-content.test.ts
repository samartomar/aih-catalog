// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures carry literal environment references
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  // The accepted deterministic-acquisition recipe requires the separately acquired
  // npm CLI and an isolated integrity-verified npm cache; supply real values from a
  // disposable fixture only.
  const fixture = mkdtempSync(join(tmpdir(), "aihq-ecc-memory-"));
  const memoryConfiguration = {
    npmCli: join(fixture, "npm-cli.js"),
    npmCache: join(fixture, "npm-cache"),
  };
  writeFileSync(memoryConfiguration.npmCli, "// disposable fixture npm-cli.js\n");
  mkdirSync(memoryConfiguration.npmCache);
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
        configuration: memoryConfiguration,
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
    configuration: memoryConfiguration,
    materialSource: { kind: "local", input: "catalog" },
  });
  expect(configured.valid).toBe(true);
  const item = declaration.items.find(
    (item: { id: string }) => item.id === "ecc.claude.mcp.memory",
  );
  const recipe = JSON.parse(snapshot.recipes.ecc[item.recipePath]);
  expect(recipe.prerequisites).toEqual([{ kind: "executable", name: "node" }]);
  expect(
    recipe.operations.find((op: { kind: string }) => op.kind === "config.entries").entries,
  ).toContainEqual({
    action: "set",
    path: ["mcpServers", "memory"],
    value: {
      literal: {
        command: "node",
        args: [
          "-e",
          `const [a,b,c]=process.versions.node.split('.').map(Number);if(a!==26||b<12||(b===12&&c<1))throw Error('incompatible-runtime: Node >=26.12.1 <27 required');const r=process.env.AIHQ_MCP_MEMORY_ROOT;if(!r)throw Error('missing-runtime: AIHQ_MCP_MEMORY_ROOT must name the reviewed installation directory');const p=require('node:path').join(r,"node_modules/@modelcontextprotocol/server-memory/dist/index.js");process.argv.splice(1,0,p);import(require('node:url').pathToFileURL(p).href);`,
          "--",
        ],
        env: {
          AIHQ_MCP_MEMORY_ROOT: "${AIHQ_MCP_MEMORY_ROOT}",
          MEMORY_FILE_PATH: "${MEMORY_FILE_PATH}",
        },
      },
    },
  });
  rmSync(fixture, { recursive: true, force: true });
}, 90_000);

it("offers EvalView deterministic checks without requiring its optional model API key", () => {
  const declaration = JSON.parse(readFileSync("producer/ecc/declaration.json", "utf8"));
  const snapshot = JSON.parse(readFileSync("producer/ecc/snapshot.json", "utf8"));
  declaration.items = declaration.items.filter((item: { id: string }) =>
    ["ecc.claude.mcp.evalview", "ecc.notices"].includes(item.id),
  );
  const source = snapshot.sources[0];
  const compiled = compileProducerDeclaration({
    declaration,
    sourceFiles: [
      {
        source: source.id,
        revision: source.revision,
        files: {
          ...Object.fromEntries(
            source.files.map((file: { path: string; base64: string }) => [
              file.path,
              new Uint8Array(Buffer.from(file.base64, "base64")),
            ]),
          ),
          ...Object.fromEntries(
            Object.entries(snapshot.recipes.ecc).map(([path, text]) => [
              path,
              new TextEncoder().encode(text as string),
            ]),
          ),
        },
      },
    ],
  });
  expect(compiled.status, JSON.stringify(compiled.diagnostics)).toBe("ok");
  if (compiled.status !== "ok") return;
  const item = compiled.value.release.items.find((item) => item.id === "ecc.claude.mcp.evalview");
  if (!item) throw new Error("EvalView declaration missing");
  expect(JSON.stringify(item.metadata)).not.toContain("must provide OPENAI_API_KEY");
  const recipeFile = compiled.value.materials.find((file) => file.path === item.recipe?.path);
  if (!recipeFile) throw new Error("EvalView recipe missing");
  const recipe = JSON.parse(new TextDecoder().decode(recipeFile.bytes));
  const server = recipe.operations.find(
    (operation: { kind: string }) => operation.kind === "config.entries",
  ).entries[0].value.literal;
  expect(server).toEqual({
    command: "python3",
    args: ["-m", "evalview", "mcp", "serve"],
    env: { OPENAI_API_KEY: `\${OPENAI_API_KEY:-}` },
  });
  const inventory = JSON.parse(readFileSync("producer/ecc/inventory.json", "utf8"));
  expect(inventory.itemFacts["ecc.claude.mcp.evalview"].requiredHostEnvironment).toEqual([]);
  expect(inventory.itemFacts["ecc.claude.mcp.evalview"].optionalHostEnvironment).toEqual([
    "OPENAI_API_KEY",
  ]);
});

it("offers Codex user-scope MCP registration for every translatable server and records the rest", () => {
  const declaration = JSON.parse(readFileSync("producer/ecc/declaration.json", "utf8"));
  const snapshot = JSON.parse(readFileSync("producer/ecc/snapshot.json", "utf8"));
  const inventory = JSON.parse(readFileSync("producer/ecc/inventory.json", "utf8"));
  const claudeKeys = declaration.items
    .filter((item: { id: string }) => item.id.startsWith("ecc.claude.mcp."))
    .map((item: { id: string }) => item.id.slice("ecc.claude.mcp.".length));
  const codexKeys = declaration.items
    .filter((item: { id: string }) => item.id.startsWith("ecc.codex.mcp."))
    .map((item: { id: string }) => item.id.slice("ecc.codex.mcp.".length));
  const excluded = inventory.codexMcpExclusions.map((row: { sourceKey: string }) => row.sourceKey);
  expect(claudeKeys).toHaveLength(37);
  expect(codexKeys).toHaveLength(34);
  expect([...codexKeys, ...excluded].sort()).toEqual([...claudeKeys].sort());
  expect(excluded.sort()).toEqual(["filesystem", "ito-compute", "supabase"]);
  for (const row of inventory.codexMcpExclusions) expect(row.reason).toContain("args-placeholder");

  declaration.items = declaration.items.filter((item: { id: string }) =>
    ["ecc.codex.mcp.github", "ecc.codex.mcp.memxus", "ecc.notices"].includes(item.id),
  );
  const source = snapshot.sources[0];
  const compiled = compileProducerDeclaration({
    declaration,
    sourceFiles: [
      {
        source: source.id,
        revision: source.revision,
        files: {
          ...Object.fromEntries(
            source.files.map((file: { path: string; base64: string }) => [
              file.path,
              new Uint8Array(Buffer.from(file.base64, "base64")),
            ]),
          ),
          ...Object.fromEntries(
            Object.entries(snapshot.recipes.ecc).map(([path, text]) => [
              path,
              new TextEncoder().encode(text as string),
            ]),
          ),
        },
      },
    ],
  });
  expect(compiled.status, JSON.stringify(compiled.diagnostics)).toBe("ok");
  if (compiled.status !== "ok") return;
  const item = compiled.value.release.items.find((item) => item.id === "ecc.codex.mcp.github");
  expect(item?.scopes).toEqual(["user"]);
  const recipeFile = compiled.value.materials.find((file) => file.path === item?.recipe?.path);
  if (!recipeFile) throw new Error("Codex recipe missing");
  const recipe = JSON.parse(new TextDecoder().decode(recipeFile.bytes));
  expect(recipe.targets).toEqual(["user"]);
  expect(recipe.operations.map((operation: { scope: string }) => operation.scope)).toEqual([
    "user",
    "user",
    "user",
  ]);
  expect(recipe.operations.at(-1).entries).toEqual([
    {
      action: "set",
      path: ["mcp_servers", "github", "url"],
      value: { literal: "https://api.githubcopilot.com/mcp/readonly" },
    },
  ]);
  const checked = readRelease(compiled.value.releaseBytes, {
    expectedSha256: compiled.value.releaseSha256,
  });
  expect(checked.valid).toBe(true);
  if (!checked.valid) return;
  // Dependencies resolve in the dependent's scope, and ecc.notices is project-only.
  const resolved = resolveSelections({
    releases: { [checked.release.sha256]: checked.release },
    roots: [
      {
        releaseSha256: checked.release.sha256,
        itemId: "ecc.codex.mcp.github",
        scope: "user",
        configuration: {},
      },
    ],
    skips: [],
  });
  expect(resolved.status, JSON.stringify(resolved.diagnostics)).toBe("ok");
  if (resolved.status !== "ok") return;
  expect(resolved.value.selections.map((s) => s.item.itemId)).toEqual(["ecc.codex.mcp.github"]);
  const configured = configureItem({
    release: checked.release,
    itemId: "ecc.codex.mcp.memxus",
    configuration: {},
    materialSource: { kind: "local", input: "catalog" },
  });
  expect(configured.valid).toBe(true);
});
