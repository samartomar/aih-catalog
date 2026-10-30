// Copied into an outside consumer; only public package interfaces are imported.
// ECC release 1.7.0 content: the framework identity, ECC's install modules and
// profiles as sets, the one languages-and-frameworks option, the always-included
// common rules, ECC's 24 hooks optional and never pre-ticked, the TypeScript and Python closure with its origins,
// the collapsed MCP servers with their notice and distinct behaviour identities,
// the identity and retirement mapping of every earlier ECC item, the Kiro edition's
// own set, namespaces, hints, variants and steering inclusion, the restructuring
// comparison and the unbound state, also through the installed internal reader. No Core, no execution, no Scan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preparedReleaseContent, releaseInventory } from "@aihq/catalog/contracts";
import { readInstalledPreparedContent } from "@aihq/catalog/node";
import { compareRestructuring } from "@aihq/catalog/producer";
import {
  configureItem,
  createContentInventory,
  itemEvidenceDescriptor,
  readRelease,
  readReleaseContent,
  resolveSelections,
} from "@aihq/catalog/reader";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const exported = (name) => readFileSync(fileURLToPath(import.meta.resolve(`@aihq/catalog/${name}`)));
const json = (name) => JSON.parse(exported(name).toString("utf8"));
const member = (path) => readFileSync(join(root, path));
const results = [];
const case_ = async (name, fn) => {
  try {
    results.push({ ...((await fn()) ?? {}), name, status: "pass" });
  } catch (error) {
    results.push({ name, status: "fail", error: String(error?.stack ?? error) });
  }
};

const CONTENT = "release-ecc.content.json";
const INVENTORY = "release/baselines/ecc/content-inventory.json";
const contentBytes = exported(CONTENT);
const read = readReleaseContent(contentBytes, { expectedSha256: sha256(contentBytes) });
assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
const release = read.release;
const earlierBytes = exported("release-ecc.json");
const earlier = readRelease(earlierBytes, { expectedSha256: sha256(earlierBytes) });
assert.equal(earlier.valid, true, JSON.stringify(earlier.diagnostics));
const item = (id) => release.items.find((entry) => entry.id === id);
const set = (id) => release.sets.find((entry) => entry.id === id);
const groups = release.metadata.eccInstallGroups;
const modules = Object.entries(groups.modules);
const profiles = Object.entries(groups.profiles);
const TARGETS = { claude: "claude-code", "claude-project": "claude-code", codex: "codex" };
const KIRO_SET = "ecc.edition.kiro";
const kiroEdition = release.items.filter((entry) => entry.payload.namespace === "kiro");
const contentOf = (entry) => entry.materials.filter((material) => material.role === "content");
await case_("hosted MCP choices expose current endpoints and keep secrets as required inputs", () => {
  const browser = item("ecc.mcp.browser-use");
  assert.equal(browser.payload.url, "https://api.browser-use.com/v3/mcp");
  assert.deepEqual(browser.payload.headers, { "x-browser-use-api-key": { input: "BROWSER_USE_KEY" } });
  assert.equal(browser.requirements.inputs.BROWSER_USE_KEY.sensitive, true);
  const parallel = item("ecc.mcp.parallel-search");
  assert.equal(parallel.payload.url, "https://mcp.parallel.ai/mcp");
  assert.equal(parallel.payload.headers, undefined);
  assert.deepEqual(parallel.requirements.inputs, {});
  assert.equal(item("ecc.mcp.laraplugins").payload.url, "https://laraplugins.io/mcp/plugins");
  assert.deepEqual(item("ecc.mcp.laraplugins").requirements.inputs, {});
});
await case_("a local memory choice delivers an exact acquisition closure instead of floating npx", () => {
  assert.equal(configureItem({ release, itemId: "ecc.mcp.memory", configuration: {}, materialSource: { kind: "local", input: "catalog" }, clientId: "claude-code" }).valid, false);
  assert.equal(json("package.json").engines.node, ">=26.12.1 <27");
  const memory = item("ecc.mcp.memory");
  assert.equal(memory.payload.command, "node");
  assert.ok(!memory.payload.args.some(arg => arg.includes("npx")));
  const recipe = JSON.parse(member(memory.recipes["claude-code"].path));
  const lock = recipe.operations.find(entry => entry.kind === "file.write" && entry.target.segments.at(-1).literal === "package-lock.json");
  assert.ok(lock, "selected memory server has no delivered lock");
  const closure = JSON.parse(lock.content.literal);
  assert.equal(closure.lockfileVersion, 3);
  assert.equal(closure.packages["node_modules/@modelcontextprotocol/server-memory"].version, "2.0.0");
  for (const [path, dependency] of Object.entries(closure.packages)) {
    if (!path) continue;
    assert.match(dependency.integrity, /^sha512-/);
    assert.match(dependency.resolved, /^https:\/\/registry\.npmjs\.org\//);
  }
  const codescene = item("ecc.mcp.codescene");
  assert.equal(codescene.requirements.inputs.CS_MCP_BINARY_PATH.required, true);
  const nativeRecipe = JSON.parse(member(codescene.recipes["claude-code"].path));
  const manifest = JSON.parse(nativeRecipe.operations.find(operation => operation.kind === "file.write" && operation.target.segments.at(-1).literal === "native-artifacts.json").content.literal);
  assert.equal(manifest.version, "1.5.13");
  assert.match(manifest.targets["win32/x64"].binarySha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.targets["win32/arm64"].state, "missing-artifact");
});
await case_("Python server choices expose isolated exact runtimes and refuse a shared environment", () => {
  for (const key of ["jira", "omega-memory"]) {
    const server = item(`ecc.mcp.${key}`);
    assert.equal(server.payload.command, "python");
    assert.equal(server.payload.args[0], "-I");
    assert.ok(server.payload.args.join(" ").includes("3,14,10"));
    assert.ok(server.payload.args.join(" ").includes("1.30.0"));
    assert.match(server.description, /isolated/i);
    assert.match(server.description, /unqualified|unverified/i);
  }
  assert.ok(item("ecc.mcp.omega-memory").requirements.inputs.OMEGA_HOME);
});
await case_("official GitHub and Railway routes are separate explicit choices", () => {
  const github = item("ecc.mcp.github");
  assert.equal(github.payload.transport, "http");
  assert.equal(github.payload.url, "https://api.githubcopilot.com/mcp/readonly");
  assert.equal(github.payload.command, undefined);
  const local = item("ecc.mcp.github-local");
  assert.equal(local.payload.command, "github-mcp-server");
  assert.deepEqual(local.payload.args, ["stdio", "--read-only", "--toolsets", "repos,issues,pull_requests"]);
  assert.equal(local.requirements.inputs.GITHUB_PERSONAL_ACCESS_TOKEN.sensitive, true);
  assert.equal(item("ecc.mcp.railway-hosted").payload.url, "https://mcp.railway.com");
  assert.ok(item("ecc.mcp.railway").payload.args.includes("mcp"));
  assert.ok(!item("ecc.mcp.railway").payload.args.includes("local"));
  assert.ok(item("ecc.mcp.supabase").payload.args.includes("--read-only"));
  assert.equal(item("ecc.mcp.supabase").requirements.inputs.SUPABASE_ACCESS_TOKEN.sensitive, true);
});
const resolve = (setId, options) => {
  const chosen = set(setId);
  const request = {
    releases: { [release.sha256]: release },
    roots: [],
    skips: [],
    sets: [{ release: { releaseSha256: release.sha256, scope: "project" }, setId, setSha256: chosen.setSha256, ...(options ? { options } : {}) }],
  };
  const initial = resolveSelections(request);
  if (initial.status === "ok") return initial;
  const missing = initial.diagnostics.flatMap(diagnostic => diagnostic.details?.diagnostics ?? []);
  if (!missing.length || missing.some(diagnostic => diagnostic.reason !== "input-required" || !/\/(npmCli|npmCache)$/.test(diagnostic.path))) return initial;
  // These configuration-only profiles still need explicit acquisition inputs;
  // none of these fixture paths is executed by this packed reader scenario.
  request.roots = [...new Set(missing.map(diagnostic => diagnostic.itemId))].map(itemId => ({ releaseSha256: release.sha256, itemId, scope: "project", configuration: { npmCli: "/fixture/npm-cli.js", npmCache: "/fixture/npm-cache" } }));
  return resolveSelections(request);
};
const ruleIds = (result) => result.value.selections.map((selection) => selection.item.itemId).filter((id) => item(id).kind === "rule").sort();
const rulesIn = (directory) => release.items.filter((entry) => entry.kind === "rule" && entry.payload.namespace === directory).map((entry) => entry.id).sort();

await case_("the release is ECC release format 1.7.0 with its published framework identity", () => {
  assert.equal(release.schema, "urn:aihq:catalog:release:1.7.0");
  const plugin = JSON.parse(member(contentOf(item("ecc.notices")).find((entry) => entry.sourcePath === ".claude-plugin/plugin.json").packagePath).toString("utf8"));
  assert.deepEqual(release.framework, { id: "ecc", name: "ECC", version: plugin.version, description: plugin.description });
  assert.equal(release.sources[0].origin.repository, "https://github.com/affaan-m/ECC");
  assert.equal(release.sources[0].license, "MIT");
});

await case_("each ECC module with content is a set with its upstream dependencies, narrowing targets, default and own words", () => {
  assert.equal(modules.length, 36);
  // A module whose pinned paths give no item is not a set, and says why.
  const omitted = new Set(Object.keys(groups.omittedModules).map((id) => `ecc.module.${id}`));
  assert.equal(omitted.size, 11);
  for (const [setId, words] of modules) {
    const module = set(setId);
    if (omitted.has(setId)) {
      assert.equal(module, undefined, setId);
      continue;
    }
    assert.ok(module, setId);
    assert.deepEqual((module.requires ?? []).map((ref) => ref.setId), words.dependencies.map((id) => `ecc.module.${id}`).filter((id) => !omitted.has(id)), setId);
    assert.equal(module.optional, undefined, setId);
    assert.deepEqual(module.targets, [...new Set(words.targets.map((target) => TARGETS[target] ?? target))].sort(), setId);
    assert.equal(module.offer, words.defaultInstall ? "pre-ticked" : "listed", setId);
    assert.equal(module.stability, words.stability, setId);
    assert.equal(module.cost, words.cost, setId);
  }
  // The upstream's own words come from the pinned install manifests named by digest.
  assert.deepEqual(groups.manifests.map((entry) => entry.path).sort(), ["manifests/install-components.json", "manifests/install-modules.json", "manifests/install-profiles.json"]);
  assert.equal(set("ecc.module.agents-core").members.length, 68);
  assert.equal(set("ecc.module.commands-core").members.length, 94);
  assert.equal(set("ecc.module.platform-configs").members.filter((entry) => item(entry.item.itemId).kind === "mcp-server").length, 5);
});

await case_("each ECC profile is a set whose includes list its module sets", () => {
  assert.equal(profiles.length, 7);
  for (const [setId, words] of profiles) {
    const profile = set(setId);
    assert.deepEqual(profile.members, [], setId);
    assert.deepEqual(profile.includes.map((ref) => ref.setId), words.modules.filter((id) => !Object.hasOwn(groups.omittedModules, id)).map((id) => `ecc.module.${id}`), setId);
  }
});

await case_("languages and frameworks are one pick-several option mapping to ECC's own module lists", () => {
  const withOption = release.sets.filter((entry) => entry.options);
  assert.deepEqual(withOption.map((entry) => entry.id).sort(), profiles.filter(([, words]) => words.modules.includes("rules-core")).map(([id]) => id).sort());
  const [option] = withOption[0].options;
  for (const entry of withOption) {
    assert.equal(entry.options.length, 1);
    assert.deepEqual(entry.options[0], option);
  }
  assert.equal(option.id, "languages");
  assert.equal(option.multiple, true);
  const typescript = option.choices.find((choice) => choice.id === "typescript");
  assert.deepEqual(typescript.sets.map((ref) => ref.setId), ["ecc.rules.typescript", "ecc.module.framework-language"]);
  assert.deepEqual(option.choices.find((choice) => choice.id === "go").sets.map((ref) => ref.setId), ["ecc.rules.golang", "ecc.module.framework-language"]);
  assert.deepEqual(option.choices.find((choice) => choice.id === "swift").sets.map((ref) => ref.setId), ["ecc.rules.swift", "ecc.module.swift-apple"]);
  for (const choice of option.choices) for (const ref of choice.sets) assert.ok(set(ref.setId), `${choice.id}: ${ref.setId}`);
  // Every rule directory except common is reachable through the option.
  const reached = new Set(option.choices.flatMap((choice) => choice.sets.map((ref) => ref.setId)));
  for (const entry of release.sets.filter((candidate) => candidate.id.startsWith("ecc.rules.") && candidate.id !== "ecc.rules.common"))
    assert.ok(reached.has(entry.id), entry.id);
});

await case_("rules/common is always included with no choice made, and rules keep their language namespace", () => {
  const plain = resolve("ecc.profile.developer");
  assert.equal(plain.status, "ok", JSON.stringify(plain.diagnostics));
  assert.deepEqual(ruleIds(plain), rulesIn("common"));
  assert.deepEqual(set("ecc.module.rules-core").includes.map((ref) => ref.setId), ["ecc.rules.common"]);
  const style = item("ecc.rule.typescript.coding-style");
  assert.equal(`${style.name} (${style.payload.namespace})`, "coding-style (typescript)");
  assert.equal(style.nameBasis, "file-name");
  assert.deepEqual(style.payload.applyTo, ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]);
  assert.equal(item("ecc.rule.common.coding-style").payload.namespace, "common");
});

await case_("every hook member of every ECC set is optional and never pre-ticked", () => {
  let hooks = 0;
  for (const entry of release.sets)
    for (const candidate of entry.members)
      if (item(candidate.item.itemId)?.kind === "hook") {
        hooks++;
        assert.equal(candidate.optional, true, `${entry.id}: ${candidate.item.itemId}`);
        assert.equal(candidate.defaultOn, false, `${entry.id}: ${candidate.item.itemId}`);
      }
  // ECC's 24 upstream hooks are the members of its hook runtime module.
  assert.equal(hooks, 24);
  assert.equal(release.items.filter((entry) => entry.kind === "hook").length, 24);
  assert.equal(set("ecc.module.hooks-runtime").members.length, 24);
});

await case_("a profile with TypeScript and Python resolves to exactly those rule modules plus the common rules", () => {
  const developer = set("ecc.profile.developer");
  const result = resolve("ecc.profile.developer", { languages: ["typescript", "python"] });
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.deepEqual(ruleIds(result), [...rulesIn("common"), ...rulesIn("python"), ...rulesIn("typescript")].sort());
  const origins = (id) => result.value.selections.find((selection) => selection.item.itemId === id).origins;
  const inSet = (options) => ({ reasonIncluded: "in-set", set: { framework: "ecc", setId: developer.id, setSha256: developer.setSha256 }, ...(options ? { options } : {}) });
  assert.deepEqual(origins("ecc.rule.typescript.testing"), [inSet({ languages: ["typescript"] })]);
  assert.deepEqual(origins("ecc.rule.python.testing"), [inSet({ languages: ["python"] })]);
  assert.ok(origins("ecc.rule.common.testing").some((origin) => JSON.stringify(origin) === JSON.stringify(inSet())));
  // The notice every rule requires arrives by dependency closure, never as an extra rule.
  assert.ok(origins("ecc.notices").every((origin) => origin.reasonIncluded === "required-by"));
  const unknown = resolve("ecc.profile.developer", { languages: ["cobol"] });
  assert.equal(unknown.status, "refused");
  assert.ok(unknown.diagnostics.some((entry) => entry.reason === "set-option-unknown"));
});

await case_("collapsed MCP copies keep the union of dependencies and the licence notice", () => {
  const servers = release.items.filter((entry) => entry.kind === "mcp-server");
  assert.equal(servers.length, 37);
  for (const server of servers) {
    assert.ok(server.dependencies.requires.some((ref) => ref.itemId === "ecc.notices"), `${server.id} lacks its notice`);
    assert.ok(contentOf(server).some((entry) => entry.relPath === "LICENSE"), `${server.id} lacks its licence`);
    assert.ok(server.supersedes.some((entry) => entry.itemId === `ecc.claude.mcp.${server.payload.key}`), server.id);
  }
  // The Codex copies had dropped the notice dependency; their survivors keep it.
  const dropped = earlier.release.items.filter((entry) => entry.id.startsWith("ecc.codex.mcp.") && !entry.dependencies.requires.some((ref) => ref.itemId === "ecc.notices"));
  assert.equal(dropped.length, 34);
  for (const copy of dropped) {
    const survivor = item(copy.id.replace("ecc.codex.mcp.", "ecc.mcp."));
    assert.deepEqual(Object.keys(survivor.recipes), ["claude-code", "codex"]);
    assert.deepEqual(survivor.scopes, ["project", "user"]);
    assert.ok(survivor.dependencies.requires.some((ref) => ref.itemId === "ecc.notices"));
  }
  const github = item("ecc.mcp.github-local");
  assert.deepEqual(github.payload.env, { GITHUB_PERSONAL_ACCESS_TOKEN: { input: "GITHUB_PERSONAL_ACCESS_TOKEN" } });
  assert.equal(github.requirements.inputs.GITHUB_PERSONAL_ACCESS_TOKEN.sensitive, true);
});

await case_("a user-scope Codex server selection resolves with its notice; the project route is unchanged", () => {
  const resolveRoot = (itemId, scope) =>
    resolveSelections({
      releases: { [release.sha256]: release },
      roots: [{ releaseSha256: release.sha256, itemId, scope, configuration: {} }],
      skips: [],
    });
  const scoped = (result) => result.value.selections.map((selection) => `${selection.item.itemId}@${selection.scope}`).sort();
  // Formerly refused: the notice the Codex copy dropped now has user-scope delivery.
  const user = resolveRoot("ecc.mcp.github", "user");
  assert.equal(user.status, "ok", JSON.stringify(user.diagnostics));
  assert.deepEqual(scoped(user), ["ecc.mcp.github@user", "ecc.notices@user"]);
  const project = resolveRoot("ecc.mcp.github", "project");
  assert.equal(project.status, "ok", JSON.stringify(project.diagnostics));
  assert.deepEqual(scoped(project), ["ecc.mcp.github@project", "ecc.notices@project"]);
  // Each client's notice recipe delivers the same four materials in its own scope.
  const notices = item("ecc.notices");
  assert.deepEqual(notices.scopes, ["project", "user"]);
  assert.deepEqual(Object.keys(notices.recipes), ["claude-code", "codex", "copilot-vscode", "kiro-ide"]);
  const recipe = (clientId) => JSON.parse(member(notices.recipes[clientId].path).toString("utf8"));
  const materials = contentOf(notices).map((entry) => entry.id).sort();
  for (const clientId of Object.keys(notices.recipes)) {
    const configured = configureItem({ release, itemId: "ecc.notices", configuration: {}, materialSource: { kind: "local", input: "catalog" }, clientId });
    assert.equal(configured.valid, true, `${clientId}: ${JSON.stringify(configured.diagnostics)}`);
    assert.deepEqual(configured.selection.recipe.reference.materials.map((entry) => entry.id).sort(), materials, clientId);
    const scope = clientId === "codex" ? "user" : "project";
    const root = clientId === "codex" ? "userHome" : "project";
    assert.deepEqual(recipe(clientId).targets, [scope], clientId);
    for (const operation of recipe(clientId).operations) {
      assert.equal(operation.scope, scope, clientId);
      assert.equal(operation.target.root, root, clientId);
    }
  }
  // The project clients keep the exact notice recipe the shipped release delivers.
  for (const clientId of ["claude-code", "copilot-vscode", "kiro-ide"])
    assert.deepEqual(notices.recipes[clientId].sha256, earlier.release.items.find((entry) => entry.id === "ecc.notices").recipe.sha256);
  const missing = configureItem({ release, itemId: "ecc.notices", configuration: {}, materialSource: { kind: "local", input: "catalog" }, clientId: "cursor" });
  assert.equal(missing.diagnostics[0].reason, "client-unavailable");
});

await case_("every ECC MCP server has its own behaviour identity", () => {
  const servers = release.items.filter((entry) => entry.kind === "mcp-server");
  assert.equal(new Set(servers.map((entry) => entry.behaviourSha256)).size, servers.length);
  // They share one upstream file, so their content identity is the same.
  assert.equal(new Set(servers.map((entry) => entry.contentSha256)).size, 1);
  for (const server of servers) {
    const behaviour = server.materials.find((entry) => entry.role === "behaviour");
    const bytes = member(behaviour.packagePath);
    assert.equal(sha256(bytes), behaviour.sha256, server.id);
    assert.deepEqual(JSON.parse(bytes.toString("utf8")).payload, server.payload, server.id);
  }
});

await case_("every earlier ECC item id is a survivor, with supersedes when renamed, or retired with a reason", () => {
  const live = new Map(release.items.map((entry) => [entry.id, entry]));
  const retired = new Map(release.retired.map((entry) => [entry.id, entry]));
  for (const old of earlier.release.items) {
    if (live.has(old.id)) continue;
    const entry = retired.get(old.id);
    assert.ok(entry?.reason, `${old.id} is neither a survivor nor retired`);
    for (const ref of entry.replacedBy) {
      // Superseded in the shipped release an installed copy records, by name and source path.
      const record = live.get(ref.itemId)?.supersedes.find((candidate) => candidate.itemId === old.id && candidate.releaseSha256 === earlier.release.sha256);
      assert.equal(record?.match, "name+sourcePath", `${ref.itemId} does not supersede ${old.id} in release-ecc.json`);
      assert.equal(record.itemSha256, old.itemSha256);
    }
  }
  assert.match(retired.get("ecc.kiro.skill.api-design").reason, /^Renamed/);
  assert.match(retired.get("ecc.codex.mcp.github").reason, /^Collapsed/);
  assert.equal(release.retired.length, 138);
  assert.deepEqual(retired.get("ecc.template.api-review").replacedBy, []);
  // Kiro-edition copies survive under their own namespace.
  assert.equal(kiroEdition.length, 65);
});

await case_("ECC's Kiro edition is one set, ECC for Kiro, and no main ECC set lists its items", () => {
  const edition = set(KIRO_SET);
  assert.equal(edition.name, "ECC for Kiro");
  assert.deepEqual(edition.members.map((entry) => entry.item.itemId).sort(), kiroEdition.map((entry) => entry.id).sort());
  assert.equal(edition.targets, undefined);
  for (const entry of release.sets)
    for (const candidate of entry.members)
      assert.equal(item(candidate.item.itemId).payload.namespace === "kiro", entry.id === KIRO_SET, `${entry.id}: ${candidate.item.itemId}`);
  assert.ok(!release.sets.some((entry) => (entry.includes ?? []).some((ref) => ref.setId === KIRO_SET)));
  // Every hook member is optional; the pinned edition's hooks are not admitted items.
  for (const candidate of edition.members) if (item(candidate.item.itemId).kind === "hook") assert.equal(candidate.optional, true);
  const chosen = resolve(KIRO_SET);
  assert.equal(chosen.status, "ok", JSON.stringify(chosen.diagnostics));
  const selected = chosen.value.selections.map((selection) => selection.item.itemId);
  assert.deepEqual(selected.filter((id) => id !== "ecc.notices").sort(), kiroEdition.map((entry) => entry.id).sort());
  const developer = resolve("ecc.profile.developer", { languages: ["typescript", "python"] });
  assert.ok(!developer.value.selections.some((selection) => item(selection.item.itemId).payload.namespace === "kiro"));
});

await case_("Kiro-edition items are namespaced kiro, hinted for Kiro and unique per kind and namespace", () => {
  const skills = kiroEdition.filter((entry) => entry.kind === "skill");
  assert.equal(skills.length, 43);
  assert.equal(kiroEdition.filter((entry) => entry.kind === "rule").length, 22);
  for (const entry of kiroEdition) assert.deepEqual(entry.hints, { tools: ["kiro"] }, entry.id);
  // Outside the Kiro edition only hooks carry a hint: written for Claude Code's hook protocol.
  assert.ok(release.items.filter((entry) => entry.payload.namespace !== "kiro").every((entry) => entry.kind === "hook" ? entry.hints.tools.join() === "claude-code" : entry.hints === undefined));
  const keys = release.items.map((entry) => `${entry.kind}\t${entry.payload.namespace ?? ""}\t${entry.name.toLowerCase()}`);
  assert.equal(new Set(keys).size, keys.length);
});

await case_("an ECC skill and its Kiro variant share a name; the variant shows as {name} (kiro) and names it", () => {
  const main = item("ecc.skill.tdd-workflow");
  const variant = item("ecc.skill.tdd-workflow.kiro-variant");
  assert.equal(variant.name, main.name);
  assert.equal(`${variant.name} (${variant.payload.namespace})`, "tdd-workflow (kiro)");
  assert.deepEqual(variant.variantOf, { itemId: main.id });
  assert.equal(main.variantOf, undefined);
  for (const skill of kiroEdition.filter((entry) => entry.kind === "skill")) {
    const varied = item(skill.variantOf.itemId);
    assert.equal(varied.kind, "skill", skill.id);
    assert.equal(varied.name, skill.name, skill.id);
    assert.equal(varied.payload.namespace, undefined, skill.id);
  }
});

await case_("variantOf and hints change neither identity nor tool binding", () => {
  for (const entry of kiroEdition) {
    // The behaviour file, which behaviourSha256 covers, carries neither declaration.
    const behaviour = JSON.parse(member(entry.materials.find((material) => material.role === "behaviour").packagePath).toString("utf8"));
    assert.deepEqual(Object.keys(behaviour).sort(), ["dependencies", "executable", "kind", "payload", "requirements"], entry.id);
    // Each keeps the Kiro recipe its shipped copy delivers, and that copy's content.
    const [superseded] = entry.supersedes;
    const copy = earlier.release.items.find((candidate) => candidate.id === superseded.itemId);
    assert.ok(superseded.itemId.startsWith("ecc.kiro."), entry.id);
    assert.equal(entry.recipe.sha256, copy.recipe.sha256, entry.id);
    assert.deepEqual(entry.scopes, copy.scopes, entry.id);
    assert.deepEqual(contentOf(entry).map((material) => material.sha256).sort(), copy.materials.map((material) => material.sha256).sort(), entry.id);
  }
  const configured = configureItem({ release, itemId: "ecc.skill.tdd-workflow.kiro-variant", configuration: {}, materialSource: { kind: "local", input: "catalog" } });
  assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
});

await case_("Kiro steering keeps its authored inclusion and applyTo patterns", () => {
  const steering = kiroEdition.filter((entry) => entry.kind === "rule");
  const count = (inclusion) => steering.filter((entry) => entry.payload.inclusion === inclusion).length;
  assert.deepEqual([count("fileMatch"), count("manual"), count("always"), count(undefined)], [11, 3, 0, 8]);
  const cpp = item("ecc.steering.cpp-patterns").payload;
  assert.equal(cpp.inclusion, "fileMatch");
  assert.deepEqual(cpp.applyTo, ["*.cpp", "*.hpp", "*.h", "*.cc", "*.cxx"]);
  assert.equal(item("ecc.steering.dev-mode").payload.inclusion, "manual");
  for (const entry of steering) {
    const text = member(contentOf(entry)[0].packagePath).toString("utf8");
    const authored = text.match(/^inclusion:\s*(\S+)$/m)[1];
    if (["always", "fileMatch", "manual"].includes(authored)) assert.equal(entry.payload.inclusion, authored, entry.id);
    else assert.match(entry.payload.applyToBasis, new RegExp(`inclusion ${authored}, a mode the release does not name`), entry.id);
    assert.equal(entry.payload.applyTo.length > 0 && (entry.payload.inclusion === "fileMatch") === !entry.payload.applyTo.includes("**"), true, entry.id);
  }
});

await case_("the installed internal reader reads ECC with the Kiro set, unbound and unauthenticated", async () => {
  const installed = await readInstalledPreparedContent({ root, frameworkId: "ecc" });
  assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
  assert.deepEqual(
    { baseline: installed.status.baseline, authenticated: installed.status.authenticated, productionRelease: installed.status.productionRelease },
    { baseline: "unbound", authenticated: false, productionRelease: false },
  );
  assert.equal(installed.provenance.contentSha256, sha256(contentBytes));
  assert.equal(installed.release.sets.find((entry) => entry.id === KIRO_SET).members.length, 65);
  const pinned = await readInstalledPreparedContent({ root, frameworkId: "ecc", expectedContentSha256: sha256(contentBytes) });
  assert.equal(pinned.valid, true, JSON.stringify(pinned.diagnostics));
  return { contentSha256: sha256(contentBytes), inventorySha256: sha256(exported(INVENTORY)) };
});

await case_("the restructuring comparison against the amended expectation passes for ECC", () => {
  const result = compareRestructuring({ release, expectation: json("restructuring/expected-1.7.0.json") });
  assert.equal(result.status, "pass", JSON.stringify(result.rows.filter((row) => row.status === "fail").slice(0, 5)));
  assert.deepEqual(result.counts.item, { pass: 689, fail: 0 });
  assert.deepEqual(result.counts.hash, { pass: 689, fail: 0 });
  assert.deepEqual(result.counts["mcp-pair"], { pass: 34, fail: 0 });
  assert.deepEqual(result.counts.edits, { pass: 37, fail: 0 });
  // Every Kiro-edition item, its identity and its renaming are checked rows.
  for (const entry of kiroEdition)
    for (const check of ["item", "hash"]) {
      const rows = result.rows.filter((row) => row.check === check && row.subject === entry.id);
      assert.ok(rows.length === 1 && rows[0].status === "pass", `${check} ${entry.id}`);
    }
});

await case_("the shipped content inventory is the frozen inventory and each item maps to a Scan descriptor", () => {
  const inventory = createContentInventory(contentBytes, { expectedSha256: sha256(contentBytes) });
  assert.equal(inventory.valid, true, JSON.stringify(inventory.diagnostics));
  assert.deepEqual(Buffer.from(inventory.bytes), exported(INVENTORY));
  for (const id of ["ecc.mcp.github", "ecc.rule.common.testing", "ecc.skill.api-design"]) {
    const descriptor = itemEvidenceDescriptor(release, { itemId: id });
    assert.equal(descriptor.valid, true, JSON.stringify(descriptor.diagnostics));
    assert.equal(descriptor.descriptor.behaviourSha256, item(id).behaviourSha256);
    assert.ok(descriptor.descriptor.materials.some((entry) => entry.role === "behaviour"));
  }
});

await case_("the content is prepared, not a qualified release: no baseline is bound or listed", () => {
  const unbound = readRelease(contentBytes, { expectedSha256: sha256(contentBytes) });
  assert.equal(unbound.valid, false);
  assert.ok(unbound.diagnostics.some((entry) => entry.reason === "baseline-invalid"));
  assert.ok(!releaseInventory.releases.some((entry) => entry.release.includes("ecc.content")));
  const [prepared] = preparedReleaseContent.filter((entry) => entry.frameworkId === "ecc");
  assert.equal(prepared.export, `@aihq/catalog/${CONTENT}`);
  assert.equal(prepared.inventory, INVENTORY);
});

process.stdout.write(JSON.stringify({ results }));
