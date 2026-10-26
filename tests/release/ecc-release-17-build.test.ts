import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

// The owning build of the ECC release 1.7.0 content; it reads the built dist modules.
const tool = async () =>
  import(
    pathToFileURL(resolve(import.meta.dirname, "../../tools/generate-ecc-release-17.mjs")).href
  );

it("builds the committed content deterministically", async () => {
  const { buildEcc17, CONTENT_PATH, INVENTORY_PATH } = await tool();
  const first = buildEcc17();
  const second = buildEcc17();
  expect(first.releaseSha256).toBe(second.releaseSha256);
  expect([...first.outputs.keys()]).toEqual(expect.arrayContaining([CONTENT_PATH, INVENTORY_PATH]));
  expect(first.release.items).toHaveLength(663);
});

it("takes item-relative paths from install targets and refuses an unknown one", async () => {
  const { itemRelativePath } = await tool();
  expect(itemRelativePath([".claude", "skills", "api-design", "SKILL.md"])).toBe("SKILL.md");
  expect(itemRelativePath([".claude", "rules", "typescript", "coding-style.md"])).toBe(
    "typescript/coding-style.md",
  );
  expect(itemRelativePath([".aihq", "ecc", "source", "ecc.agent.architect", "LICENSE"])).toBe(
    "LICENSE",
  );
  expect(() => itemRelativePath([".cursor", "rules", "x.md"])).toThrow(
    /Unrecognised ECC install target/,
  );
});

it("turns offered MCP values into input references and refuses a value it cannot represent", async () => {
  const { mcpPayload } = await tool();
  const fact = (offeredServer: Record<string, unknown>, rawServer = offeredServer) => ({
    sourceKey: "demo",
    rawServer,
    offeredServer,
  });
  const bearer = mcpPayload(
    fact({
      type: "http",
      url: "https://x.test/mcp",
      headers: { Authorization: "Bearer ${DEMO_KEY}" },
    }),
    "asset-0",
  );
  expect(bearer.payload.headers).toEqual({ Authorization: { input: "DEMO_KEY" } });
  expect(bearer.inputs.DEMO_KEY).toMatchObject({ type: "string", required: true, sensitive: true });
  expect(bearer.payload.derivation).toEqual({
    sourceMaterial: "asset-0",
    pointer: "/mcpServers/demo",
    transform: "identical",
  });
  const optional = mcpPayload(
    fact(
      { command: "python3", env: { OPENAI_API_KEY: "${OPENAI_API_KEY:-}" } },
      { command: "python3", env: { OPENAI_API_KEY: "" }, description: "Demo" },
    ),
    "asset-0",
  );
  expect(optional.inputs.OPENAI_API_KEY.required).toBe(false);
  expect(optional.payload.derivation.transform).toBe("edited");
  expect(optional.payload.derivation.editsSha256).toMatch(/^[0-9a-f]{64}$/);
  // The display description alone is not an edit of the server definition.
  const described = mcpPayload(
    fact({ command: "demo" }, { command: "demo", description: "Demo" }),
    "asset-0",
  );
  expect(described.payload.derivation.transform).toBe("identical");
  expect(() =>
    mcpPayload(fact({ command: "demo", env: { MIXED: "a-${DEMO}" } }), "asset-0"),
  ).toThrow(/Unrepresentable MCP value/);
});
