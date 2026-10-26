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

it("moves the notice recipe to the user home and refuses one that leaves the project", async () => {
  const { userScopeRecipe } = await tool();
  const target = (root: string) => ({
    root,
    segments: [{ literal: ".aihq" }, { literal: "LICENSE" }],
  });
  const recipe = {
    id: "ecc.notices",
    description: "Deliver.",
    targets: ["project"],
    operations: [{ id: "write", kind: "file.write", scope: "project", target: target("project") }],
    checks: [{ id: "check", kind: "file.sha256", target: target("project") }],
  };
  const user = userScopeRecipe(recipe);
  expect(user.targets).toEqual(["user"]);
  expect(user.operations[0]).toMatchObject({ scope: "user", target: target("userHome") });
  expect(user.checks[0].target).toEqual(target("userHome"));
  expect(() => userScopeRecipe({ ...recipe, targets: ["project", "user"] })).toThrow(
    /admits the project only/,
  );
  expect(() =>
    userScopeRecipe({
      ...recipe,
      checks: [{ id: "check", kind: "file.sha256", target: target("userHome") }],
    }),
  ).toThrow(/outside the project root/);
});

it("keeps a Kiro steering file's named inclusion and leaves an unnamed mode unset", async () => {
  const { steeringPayload } = await tool();
  const steering = (head: string) => `---\n${head}\ndescription: Demo.\n---\n# Demo\n`;
  expect(steeringPayload(steering('inclusion: fileMatch\nfileMatchPattern: "*.ts,*.tsx"'))).toEqual(
    {
      applyTo: ["*.ts", "*.tsx"],
      applyToBasis: "authored: frontmatter inclusion fileMatch and fileMatchPattern",
      inclusion: "fileMatch",
    },
  );
  expect(steeringPayload(steering("inclusion: manual"))).toMatchObject({
    applyTo: ["**"],
    inclusion: "manual",
  });
  expect(steeringPayload(steering("inclusion: always")).inclusion).toBe("always");
  const auto = steeringPayload(steering("inclusion: auto\nname: demo"));
  expect(auto.inclusion).toBeUndefined();
  expect(auto.applyToBasis).toMatch(/inclusion auto, a mode the release does not name/);
  expect(() => steeringPayload(steering('inclusion: manual\nfileMatchPattern: "*.go"'))).toThrow(
    /disagree/,
  );
  expect(() => steeringPayload(steering("inclusion: fileMatch"))).toThrow(/disagree/);
  expect(() => steeringPayload("# No frontmatter\n")).toThrow(/without an inclusion/);
});

it("builds a same-named ECC skill and its Kiro variant, the variant namespaced and naming it", async () => {
  const { buildEcc17, KIRO_SET_ID } = await tool();
  const { release } = buildEcc17();
  const byId = (id: string) => release.items.find((item: { id: string }) => item.id === id);
  const main = byId("ecc.skill.tdd-workflow");
  const variant = byId("ecc.skill.tdd-workflow.kiro-variant");
  expect(variant.name).toBe(main.name);
  expect(main.payload.namespace).toBeUndefined();
  expect(main.variantOf).toBeUndefined();
  expect(main.hints).toBeUndefined();
  expect(`${variant.name} (${variant.payload.namespace})`).toBe("tdd-workflow (kiro)");
  expect(variant.variantOf).toEqual({ itemId: main.id });
  expect(variant.hints).toEqual({ tools: ["kiro"] });
  const kiro = release.sets.find((set: { id: string }) => set.id === KIRO_SET_ID);
  expect(kiro.name).toBe("ECC for Kiro");
  expect(kiro.members.map((member: { item: { itemId: string } }) => member.item.itemId)).toContain(
    variant.id,
  );
});
