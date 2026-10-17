// Author the Codex counterpart of every offered ECC Claude MCP item into producer/ecc.
// Deterministic and idempotent: previously authored ecc.codex.mcp.* data is dropped and rebuilt
// from the Claude items' reviewed offered servers through the translation module. No fetch,
// source execution or installation. Run `npm run build:dist` first, then
// `node tools/generate-ecc-release.mjs` to regenerate the release.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { translateCodexMcpServer } from "../dist/release/codex-mcp-entries.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE = "ecc.claude.mcp.", CODEX = "ecc.codex.mcp.";
const path = name => resolve(root, `producer/ecc/${name}.json`);
const read = name => JSON.parse(readFileSync(path(name)));
const write = (name, value) => writeFileSync(path(name), `${JSON.stringify(value, null, 2)}\n`);
const literal = value => ({ literal: value });
const unsupportedReason = "This item targets the Codex user configuration; no translated native mechanism is offered.";

export function authorEccCodexMcp(declaration, snapshot, inventory) {
  const claude = declaration.items.filter(item => item.id.startsWith(CLAUDE));
  assert(claude.length > 0, "No Claude MCP items to translate");
  const recipes = snapshot.recipes.ecc;
  const withoutCodex = declaration.items.filter(item => !item.id.startsWith(CODEX));
  const last = withoutCodex.findLastIndex(item => item.id.startsWith(CLAUDE));
  const items = [], newRecipes = new Map(), facts = new Map(), exclusions = [];
  for (const sibling of claude) {
    const key = sibling.id.slice(CLAUDE.length);
    const claudeFact = inventory.itemFacts[sibling.id];
    assert(claudeFact?.sourceKey, `Missing Claude MCP facts ${sibling.id}`);
    const translation = translateCodexMcpServer(claudeFact.sourceKey, claudeFact.offeredServer);
    if (!translation.supported) { exclusions.push({ sourceKey: claudeFact.sourceKey, reason: translation.reason }); continue; }
    const id = `${CODEX}${key}`, recipePath = `catalog-recipes/${id}.json`;
    // The Claude recipe supplies the asset delivery and its checks; here they land in the user's home.
    const claudeRecipe = JSON.parse(recipes[sibling.recipePath]);
    const retarget = target => ({
      root: "userHome",
      segments: target.segments.map(segment => (segment.literal === sibling.id ? { literal: id } : segment)),
    });
    const register = {
      id: "register-server",
      purpose: `Register exact offered ECC ${claudeFact.sourceKey} server for Codex`,
      kind: "config.entries",
      scope: "user",
      target: { root: "userHome", segments: [{ literal: ".codex" }, { literal: "config.toml" }] },
      format: "toml",
      entries: translation.entries,
      requires: [],
      checks: [],
    };
    const recipe = {
      schema: "urn:aihq:core:recipe:1.0.0",
      id,
      description: "Catalog overlay: deliver pinned ECC mcp material and register the exact offered server in the Codex user configuration; execute no source code.",
      inputs: {},
      materials: [],
      targets: ["user"],
      prerequisites: translation.prerequisites,
      operations: [
        ...claudeRecipe.operations.filter(operation => operation.kind === "file.write").map(operation => ({ ...operation, scope: "user", target: retarget(operation.target) })),
        register,
      ],
      checks: claudeRecipe.checks.map(check => ({ ...check, target: retarget(check.target) })),
    };
    newRecipes.set(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
    const prerequisites = claudeFact.runtimePrerequisites;
    items.push({
      id,
      source: "ecc",
      label: id,
      description: `Pinned ECC mcp server registered in the Codex user configuration through structured TOML entries translated from the exact upstream server. ${prerequisites}`,
      kind: "mcp",
      recipePath,
      materials: sibling.materials.map(material => ({ ...material })),
      requires: [],
      optional: [],
      conflicts: [],
      clientCapabilities: [
        { client: "codex", surface: "user", capability: "mcp-configuration", support: "supported", reason: "Exact user recipe for the Codex user configuration; native invocation unobserved." },
        ...["claude-code", "kiro-ide", "copilot-vscode"].map(client => ({ client, surface: "project", capability: "mcp-configuration", support: "unsupported", reason: unsupportedReason })),
        { client: "codex", surface: "user", capability: "native-execution", support: "unknown", reason: prerequisites },
      ],
      activation: [{ client: "codex", surface: "user", instructions: prerequisites }],
      configuration: {},
    });
    facts.set(id, {
      ...claudeFact,
      overlay: "User scope, omit display description, forward documented host environment references by name through env_vars, bearer_token_env_var or env_http_headers; command/package/URL stays upstream-authored.",
    });
  }
  const nextItems = [...withoutCodex.slice(0, last + 1), ...items, ...withoutCodex.slice(last + 1)];
  const nextRecipes = {};
  for (const [recipePath, text] of Object.entries(recipes)) {
    if (!recipePath.startsWith(`catalog-recipes/${CODEX}`)) nextRecipes[recipePath] = text;
    if (recipePath === `catalog-recipes/${claude.at(-1).id}.json`) for (const [name, body] of newRecipes) nextRecipes[name] = body;
  }
  assert.equal(Object.keys(nextRecipes).length, Object.keys(recipes).filter(name => !name.startsWith(`catalog-recipes/${CODEX}`)).length + newRecipes.size);
  const nextFacts = {};
  for (const [id, fact] of Object.entries(inventory.itemFacts)) {
    if (id.startsWith(CODEX)) continue;
    nextFacts[id] = fact;
    if (id === claude.at(-1).id) for (const [codexId, codexFact] of facts) nextFacts[codexId] = codexFact;
  }
  // The shared source rows list every item that delivers them, in declaration order.
  const nextEntries = inventory.entries.map(row => {
    if (!items.some(item => item.materials.some(material => material.path === row.path))) return row;
    const rest = row.items.filter(id => !id.startsWith(CODEX));
    const at = rest.lastIndexOf(claude.at(-1).id) + 1;
    return { ...row, items: [...rest.slice(0, at), ...items.filter(item => item.materials.some(material => material.path === row.path)).map(item => item.id), ...rest.slice(at)] };
  });
  const nextInventory = {};
  for (const [name, value] of Object.entries(inventory)) {
    if (name === "codexMcpExclusions") continue;
    nextInventory[name] = name === "itemFacts" ? nextFacts : name === "entries" ? nextEntries : value;
    if (name === "itemFacts") nextInventory.codexMcpExclusions = exclusions;
  }
  return {
    declaration: { ...declaration, items: nextItems },
    snapshot: { ...snapshot, recipes: { ...snapshot.recipes, ecc: nextRecipes } },
    inventory: nextInventory,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, "Usage: node tools/author-ecc-codex-mcp.mjs");
  const authored = authorEccCodexMcp(read("declaration"), read("snapshot"), read("inventory"));
  write("declaration", authored.declaration);
  write("snapshot", authored.snapshot);
  write("inventory", authored.inventory);
  console.log(`Authored ${authored.declaration.items.filter(item => item.id.startsWith(CODEX)).length} Codex MCP items; ${authored.inventory.codexMcpExclusions.length} servers recorded as untranslated`);
}
