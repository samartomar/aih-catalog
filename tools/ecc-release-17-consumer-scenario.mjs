// Copied into an outside consumer; only public package interfaces are imported.
// ECC release 1.7.0 content: the framework identity, ECC's install modules and
// profiles as sets, the one languages-and-frameworks option, the always-included
// common rules, optional hooks, the TypeScript and Python closure with its origins,
// the collapsed MCP servers with their notice and distinct behaviour identities,
// the identity and retirement mapping of every earlier ECC item, the restructuring
// comparison and the unbound state. No Core, no execution, no Scan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preparedReleaseContent, releaseInventory } from "@aihq/catalog/contracts";
import { compareRestructuring } from "@aihq/catalog/producer";
import {
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
    await fn();
    results.push({ name, status: "pass" });
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
const STABILITY = { stable: "stable", beta: "in-progress", experimental: "in-progress" };
const contentOf = (entry) => entry.materials.filter((material) => material.role === "content");
const resolve = (setId, options) => {
  const chosen = set(setId);
  return resolveSelections({
    releases: { [release.sha256]: release },
    roots: [],
    skips: [],
    sets: [{ release: { releaseSha256: release.sha256, scope: "project" }, setId, setSha256: chosen.setSha256, ...(options ? { options } : {}) }],
  });
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

await case_("each ECC module is a set with its upstream dependencies, narrowing targets, default and stability", () => {
  assert.equal(modules.length, 36);
  for (const [setId, words] of modules) {
    const module = set(setId);
    assert.ok(module, setId);
    assert.deepEqual((module.requires ?? []).map((ref) => ref.setId), words.dependencies.map((id) => `ecc.module.${id}`), setId);
    assert.equal(module.optional, undefined, setId);
    assert.deepEqual(module.targets, [...new Set(words.targets.map((target) => TARGETS[target] ?? target))].sort(), setId);
    assert.equal(module.offer, words.defaultInstall ? "pre-ticked" : "listed", setId);
    assert.equal(module.stability, STABILITY[words.stability], setId);
    assert.ok(["light", "medium", "heavy"].includes(words.cost), setId);
  }
  // The upstream's own words come from the pinned install manifests named by digest.
  assert.deepEqual(groups.manifests.map((entry) => entry.path).sort(), ["manifests/install-components.json", "manifests/install-modules.json", "manifests/install-profiles.json"]);
  assert.equal(set("ecc.module.agents-core").members.length, 68);
  assert.equal(set("ecc.module.commands-core").members.length, 94);
  assert.equal(set("ecc.module.platform-configs").members.filter((entry) => item(entry.item.itemId).kind === "mcp-server").length, 35);
});

await case_("each ECC profile is a set whose includes list its module sets", () => {
  assert.equal(profiles.length, 7);
  for (const [setId, words] of profiles) {
    const profile = set(setId);
    assert.deepEqual(profile.members, [], setId);
    assert.deepEqual(profile.includes.map((ref) => ref.setId), words.modules.map((id) => `ecc.module.${id}`), setId);
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

await case_("every hook member of every ECC set is optional", () => {
  let hooks = 0;
  for (const entry of release.sets)
    for (const candidate of entry.members)
      if (item(candidate.item.itemId)?.kind === "hook") {
        hooks++;
        assert.equal(candidate.optional, true, `${entry.id}: ${candidate.item.itemId}`);
      }
  // The pinned ECC hook runtime has no admitted hook item, so its module set has no members.
  assert.equal(hooks, release.items.filter((entry) => entry.kind === "hook").length);
  assert.deepEqual(set("ecc.module.hooks-runtime").members, []);
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
  assert.equal(servers.length, 35);
  for (const server of servers) {
    assert.ok(server.dependencies.requires.some((ref) => ref.itemId === "ecc.notices"), `${server.id} lacks its notice`);
    assert.ok(contentOf(server).some((entry) => entry.relPath === "LICENSE"), `${server.id} lacks its licence`);
    assert.ok(server.supersedes.some((entry) => entry.itemId === `ecc.claude.mcp.${server.payload.key}`), server.id);
  }
  // The Codex copies had dropped the notice dependency; their survivors keep it.
  const dropped = earlier.release.items.filter((entry) => entry.id.startsWith("ecc.codex.mcp.") && !entry.dependencies.requires.some((ref) => ref.itemId === "ecc.notices"));
  assert.equal(dropped.length, 32);
  for (const copy of dropped) {
    const survivor = item(copy.id.replace("ecc.codex.mcp.", "ecc.mcp."));
    assert.deepEqual(Object.keys(survivor.recipes), ["claude-code", "codex"]);
    assert.deepEqual(survivor.scopes, ["project", "user"]);
    assert.ok(survivor.dependencies.requires.some((ref) => ref.itemId === "ecc.notices"));
  }
  const github = item("ecc.mcp.github");
  assert.deepEqual(github.payload.env, { GITHUB_PERSONAL_ACCESS_TOKEN: { input: "GITHUB_PERSONAL_ACCESS_TOKEN" } });
  assert.equal(github.requirements.inputs.GITHUB_PERSONAL_ACCESS_TOKEN.sensitive, true);
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
      const survivor = live.get(ref.itemId);
      assert.ok(survivor?.supersedes.some((record) => record.itemId === old.id), `${ref.itemId} does not supersede ${old.id}`);
    }
  }
  assert.equal(release.retired.length, 134);
  assert.deepEqual(retired.get("ecc.template.api-review").replacedBy, []);
  // Kiro-edition copies survive under their own namespace; the main grid sets never list them.
  const kiro = release.items.filter((entry) => entry.payload.namespace === "kiro");
  assert.equal(kiro.length, 65);
  const listed = new Set(release.sets.flatMap((entry) => entry.members.map((candidate) => candidate.item.itemId)));
  assert.ok(kiro.every((entry) => !listed.has(entry.id)));
});

await case_("the restructuring comparison against the amended expectation passes for ECC", () => {
  const result = compareRestructuring({ release, expectation: json("restructuring/expected-1.7.0.json") });
  assert.equal(result.status, "pass", JSON.stringify(result.rows.filter((row) => row.status === "fail").slice(0, 5)));
  assert.deepEqual(result.counts.item, { pass: 663, fail: 0 });
  assert.deepEqual(result.counts.hash, { pass: 663, fail: 0 });
  assert.deepEqual(result.counts["mcp-pair"], { pass: 32, fail: 0 });
  assert.deepEqual(result.counts.edits, { pass: 35, fail: 0 });
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
