// Copied into an outside consumer; only public package interfaces are imported.
// Superpowers: the prepared release 1.7.0 content of its 15 skills, the session
// bootstrap hook and its one-line fallback rule, the retired plugin bundles and
// duplicate library, display-only native routes, its set and the selection rules
// around the bootstrap. No Core, no execution, no Scan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preparedReleaseContent, releaseInventory } from "@aihq/catalog/contracts";
import { compareRestructuring } from "@aihq/catalog/producer";
import {
  configureItem,
  createContentInventory,
  readRelease,
  readReleaseContent,
  resolveSelections,
} from "@aihq/catalog/reader";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
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

const CONTENT = "release-superpowers.content.json";
const INVENTORY = "release/baselines/superpowers/content-inventory.json";
const contentBytes = exported(CONTENT);
const read = readReleaseContent(contentBytes, { expectedSha256: sha256(contentBytes) });
assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
const release = read.release;
const earlierBytes = exported("release-superpowers.json");
const earlier = readRelease(earlierBytes, { expectedSha256: sha256(earlierBytes) });
assert.equal(earlier.valid, true, JSON.stringify(earlier.diagnostics));
const item = (id) => release.items.find((entry) => entry.id === id);
// The 15 upstream skills, from the ticket's acceptance.
const SKILLS = [
  "brainstorming",
  "diagnosing-superpowers",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
];
const HOOK = "superpowers.hook.session-start";
const RULE = "superpowers.rule.session-bootstrap";
const BUNDLES = ["codex", "cursor", "devin", "gemini", "hermes", "kimi", "muse", "opencode", "pi"];
const LIBRARY = "superpowers.runtime-source.skill-library";
const UPSTREAM = "release/materials/github.com/obra/superpowers/5bf4e78011075bcfc0dc295f0724994cd123ee71";

await case_("a separate release 1.7.0 with the published framework identity", () => {
  assert.equal(release.schema, "urn:aihq:catalog:release:1.7.0");
  assert.deepEqual(Object.keys(release.framework).sort(), ["description", "id", "name", "version"]);
  assert.equal(release.framework.id, "superpowers");
  assert.equal(release.framework.name, "Superpowers");
  assert.match(release.framework.version, /^\d+\.\d+\.\d+$/);
  // Upstream's own published package description, never an invented one.
  const upstream = JSON.parse(member(`${UPSTREAM}/package.json`).toString("utf8"));
  assert.equal(release.framework.description, upstream.description);
  assert.equal(release.package.name, "@aihq/catalog");
});

await case_("the 15 skills are items, each with a typed payload, its invocation and basis", () => {
  const skills = release.items.filter((entry) => entry.kind === "skill");
  assert.deepEqual(skills.map((entry) => entry.id), SKILLS.map((name) => `superpowers.skill.${name}`));
  for (const name of SKILLS) {
    const got = item(`superpowers.skill.${name}`);
    assert.equal(got.role, "choosable", name);
    assert.equal(got.name, name);
    assert.equal(got.nameBasis, "authored", name);
    assert.deepEqual(Object.keys(got.payload).sort(), ["dirName", "invocation", "invocationBasis"], name);
    assert.equal(got.payload.dirName, name);
    // No upstream skill disables model invocation in its frontmatter.
    const skillMd = got.materials.find((entry) => entry.relPath === "SKILL.md");
    assert.doesNotMatch(member(skillMd.packagePath).toString("utf8").split("\n---")[0], /disable-model-invocation/);
    assert.equal(got.payload.invocation, "model-allowed", name);
    assert.match(got.payload.invocationBasis, /disable-model-invocation/, name);
    // One item per skill across tools: the three tool copies' recipes, one per client.
    assert.deepEqual(Object.keys(got.recipes), ["claude-code", "copilot-vscode", "kiro-ide"], name);
    assert.equal(got.recipe, undefined, name);
    assert.ok(got.hints.tools.includes("claude-code"), name);
    for (const material of got.materials) {
      const bytes = member(material.packagePath);
      assert.equal(sha256(bytes), material.sha256, `${name} ${material.relPath}`);
      assert.equal(bytes.byteLength, material.byteLength, `${name} ${material.relPath}`);
    }
  }
  assert.equal(new Set(release.items.map((entry) => entry.name)).size, release.items.length);
});

await case_("the session bootstrap is a hook with a typed payload and a one-line rule fallback", () => {
  const hook = item(HOOK);
  assert.equal(hook.kind, "hook");
  assert.equal(hook.role, "choosable");
  // The payload is upstream's own hook declaration, read from its hooks.json.
  const settings = JSON.parse(member(`${UPSTREAM}/hooks/hooks.json`).toString("utf8")).hooks.SessionStart[0];
  assert.equal(hook.payload.event, "SessionStart");
  assert.equal(hook.payload.matcher, settings.matcher);
  assert.equal(hook.payload.protocol, "claude-code-hooks");
  assert.equal(hook.payload.command.interpreter, settings.hooks[0].shell);
  const script = hook.materials.find((entry) => entry.id === hook.payload.command.script);
  assert.equal(script.relPath, "hooks/run-hook.cmd");
  assert.deepEqual(hook.payload.command.args, ["session-start"]);
  assert.ok(hook.materials.some((entry) => entry.relPath === "hooks/session-start" && entry.executable === true));
  assert.ok(hook.materials.some((entry) => entry.relPath === "skills/using-superpowers/SKILL.md"));
  // The fallback names a same-release rule of exactly one line.
  assert.deepEqual(hook.fallback, { itemId: RULE });
  const rule = item(RULE);
  assert.equal(rule.kind, "rule");
  assert.equal(rule.role, "supporting");
  assert.ok(Array.isArray(rule.payload.applyTo) && rule.payload.applyToBasis);
  const [text] = rule.materials.filter((entry) => entry.role === "content");
  const line = member(text.packagePath).toString("utf8");
  assert.match(line, /^[^\n]+\n$/);
  assert.match(line, /using-superpowers/);
  assert.deepEqual(rule.dependencies.requires.map((ref) => ref.itemId), ["superpowers.skill.using-superpowers"]);
});

await case_("a fallback never stands in for an agent or command", () => {
  for (const entry of release.items)
    if (entry.fallback !== undefined) assert.ok(!["agent", "command"].includes(entry.kind), entry.id);
  assert.ok(!["agent", "command"].includes(item(item(HOOK).fallback.itemId).kind));
  // A release giving an agent or a command a fallback is refused as a whole.
  for (const kind of ["agent", "command"]) {
    const document = JSON.parse(contentBytes.toString("utf8"));
    const target = document.items.find((entry) => entry.id === "superpowers.skill.brainstorming");
    target.kind = kind;
    target.fallback = { itemId: RULE };
    const bytes = Buffer.from(`${canonical(document)}\n`);
    const refused = readReleaseContent(bytes, { expectedSha256: sha256(bytes) });
    assert.equal(refused.valid, false, kind);
    assert.ok(refused.diagnostics.some((entry) => entry.reason === "fallback-native-only"), kind);
  }
});

await case_("the 9 plugin bundles and the duplicate library are retired with reasons", () => {
  const retired = new Map(release.retired.map((entry) => [entry.id, entry]));
  for (const id of [...BUNDLES.map((tool) => `superpowers.runtime-source.${tool}`), LIBRARY]) {
    const entry = retired.get(id);
    assert.ok(entry, id);
    assert.ok(entry.reason.length > 20, id);
    assert.deepEqual(entry.replacedBy, [], id);
    assert.equal(item(id), undefined, id);
  }
  for (const tool of BUNDLES) assert.match(retired.get(`superpowers.runtime-source.${tool}`).reason, /plugin/);
});

await case_("every earlier Superpowers id is live or retired with its replacements", () => {
  const retired = new Map(release.retired.map((entry) => [entry.id, entry]));
  assert.equal(earlier.release.items.length, 59);
  for (const old of earlier.release.items) {
    if (item(old.id)) continue;
    const entry = retired.get(old.id);
    assert.ok(entry, `${old.id} is unmapped`);
    for (const ref of entry.replacedBy) assert.ok(item(ref.itemId), `${old.id} -> ${ref.itemId}`);
  }
  for (const tool of ["kiro", "copilot"])
    for (const name of SKILLS)
      assert.deepEqual(retired.get(`superpowers.${tool}.skill.${name}`).replacedBy, [
        { framework: "superpowers", itemId: `superpowers.skill.${name}` },
      ]);
  assert.deepEqual(retired.get("superpowers.claude.hook.session-start").replacedBy, [{ framework: "superpowers", itemId: HOOK }]);
  assert.deepEqual(retired.get("superpowers.runtime-source.claude-bootstrap").replacedBy, [{ framework: "superpowers", itemId: HOOK }]);
});

await case_("upstream plugin routes are display-only lines quoted from upstream's README", () => {
  const readme = member(`${UPSTREAM}/README.md`).toString("utf8");
  assert.ok(release.nativeRoutes.length > 0);
  for (const route of release.nativeRoutes) {
    const command = route.slice(route.indexOf(": ") + 2);
    assert.ok(readme.split("\n").some((line) => line.trim() === command), route);
  }
  // Nothing the Catalog delivers runs them: no recipe names a route.
  for (const entry of release.items)
    for (const recipe of entry.recipes ? Object.values(entry.recipes) : [entry.recipe]) {
      const text = member(recipe.path).toString("utf8");
      for (const route of release.nativeRoutes) assert.ok(!text.includes(route.slice(route.indexOf(": ") + 2)), entry.id);
    }
});

await case_("every hook member of every set is optional", () => {
  assert.ok(release.sets.length > 0);
  for (const set of release.sets)
    for (const entry of set.members)
      if (item(entry.item.itemId)?.kind === "hook") assert.equal(entry.optional, true, `${set.id} ${entry.item.itemId}`);
  const [plugin] = release.sets;
  assert.deepEqual(
    plugin.members.map((entry) => entry.item.itemId).sort(),
    [HOOK, ...SKILLS.map((name) => `superpowers.skill.${name}`)].sort(),
  );
  assert.ok(!plugin.members.some((entry) => entry.item.itemId === RULE));
});

const HOOK_COMMAND = "bash .superpowers-source/hooks/run-hook.cmd session-start";
const setChoice = (members) => ({
  release: { releaseSha256: release.sha256, scope: "project" },
  setId: release.sets[0].id,
  setSha256: release.sets[0].setSha256,
  ...(members ? { members } : {}),
});
const resolve = ({ roots = [], skips = [], members } = {}) =>
  resolveSelections({ releases: { [release.sha256]: release }, roots, skips, sets: [setChoice(members)] });
const selected = (result) => result.value.selections.map((selection) => selection.item.itemId);
const hookRoot = { releaseSha256: release.sha256, itemId: HOOK, scope: "project", configuration: { hookCommand: HOOK_COMMAND } };
const ok = (result) => assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));

await case_("excluding the bootstrap hook never re-adds it, nor its fallback in its place", () => {
  // The bootstrap is opt-in: choosing the set takes every skill and leaves the hook out.
  const chosen = resolve();
  ok(chosen);
  assert.equal(selected(chosen).filter((id) => id.startsWith("superpowers.skill.")).length, 15);
  assert.ok(!selected(chosen).includes(HOOK));
  assert.ok(!selected(chosen).includes(RULE));
  // Chosen with its reviewed command, the hook is taken and its fallback still is not.
  const withHook = resolve({ roots: [hookRoot] });
  ok(withHook);
  assert.ok(selected(withHook).includes(HOOK));
  assert.ok(!selected(withHook).includes(RULE));
  // Chosen and excluded at once, the exclusion is refused as excluding a chosen item:
  // the hook is not re-added and the fallback is not put in its place.
  for (const conflicting of [
    resolve({ roots: [hookRoot], members: [{ item: { framework: "superpowers", itemId: HOOK }, include: false }] }),
    resolve({ roots: [hookRoot], skips: [{ releaseSha256: release.sha256, itemId: HOOK, scope: "project" }] }),
  ]) {
    assert.equal(conflicting.status, "refused");
    assert.ok(conflicting.diagnostics.some((entry) => entry.reason === "required-excluded"), JSON.stringify(conflicting.diagnostics));
    assert.ok(!JSON.stringify(conflicting).includes(RULE));
  }
  // Excluded, it is never re-added, and its fallback never takes its place.
  for (const excluded of [
    resolve({ members: [{ item: { framework: "superpowers", itemId: HOOK }, include: false }] }),
    resolve({ skips: [{ releaseSha256: release.sha256, itemId: HOOK, scope: "project" }] }),
  ]) {
    ok(excluded);
    assert.ok(!selected(excluded).includes(HOOK));
    assert.ok(!selected(excluded).includes(RULE));
    assert.deepEqual(selected(excluded), selected(chosen));
  }
});

await case_("items configure through the public reader with their client recipe", () => {
  const source = { kind: "local", input: "catalog" };
  const skill = configureItem({ release, itemId: "superpowers.skill.brainstorming", clientId: "kiro-ide", configuration: {}, materialSource: source });
  assert.equal(skill.valid, true, JSON.stringify(skill.diagnostics));
  const missing = configureItem({ release, itemId: "superpowers.skill.brainstorming", configuration: {}, materialSource: source });
  assert.equal(missing.valid, false);
  const hook = configureItem({ release, itemId: HOOK, clientId: "claude-code", configuration: { hookCommand: HOOK_COMMAND }, materialSource: source });
  assert.equal(hook.valid, true, JSON.stringify(hook.diagnostics));
  const rule = configureItem({ release, itemId: RULE, configuration: {}, materialSource: source });
  assert.equal(rule.valid, true, JSON.stringify(rule.diagnostics));
});

await case_("the restructuring comparison passes for Superpowers", () => {
  const result = compareRestructuring({ release, expectation: json("restructuring/expected-1.7.0.json") });
  assert.equal(result.status, "pass", JSON.stringify(result.rows.filter((row) => row.status === "fail")));
  assert.deepEqual(result.counts.item, { pass: 18, fail: 0 });
  assert.deepEqual(result.counts.hash, { pass: 18, fail: 0 });
  assert.deepEqual(result.counts.supersession, { pass: 30, fail: 0 });
  assert.deepEqual(result.counts.retired, { pass: 43, fail: 0 });
  assert.deepEqual(result.counts["unexpected-item"], { pass: 0, fail: 0 });
});

await case_("the shipped content inventory is the frozen inventory of this content", () => {
  const inventory = createContentInventory(contentBytes, { expectedSha256: sha256(contentBytes) });
  assert.equal(inventory.valid, true, JSON.stringify(inventory.diagnostics));
  assert.deepEqual(Buffer.from(inventory.bytes), exported(INVENTORY));
});

await case_("the content is not yet a qualified release: no baseline is bound or listed", () => {
  const unbound = readRelease(contentBytes, { expectedSha256: sha256(contentBytes) });
  assert.equal(unbound.valid, false);
  assert.ok(unbound.diagnostics.some((entry) => entry.reason === "baseline-invalid"));
  assert.ok(!releaseInventory.releases.some((entry) => entry.release.includes("superpowers.content")));
  const [prepared] = preparedReleaseContent.filter((entry) => entry.frameworkId === "superpowers");
  assert.equal(prepared.export, `@aihq/catalog/${CONTENT}`);
  assert.equal(prepared.inventory, INVENTORY);
});

process.stdout.write(JSON.stringify({ results }));
