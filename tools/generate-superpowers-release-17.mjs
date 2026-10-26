#!/usr/bin/env node
// Superpowers as prepared release 1.7.0 content: its 15 skills, the session bootstrap
// hook and the hook's one-line fallback rule, one set in upstream's own grouping,
// upstream's plugin routes as display-only lines, and every earlier item accounted
// for. Built from the committed release-superpowers.json (itself generated from the
// pinned upstream snapshot) and reviewed ordinary data in
// producer/superpowers/release-1-7.json, through the public transition build.
// The baseline binding is a separate preparation step (docs/SCAN-BASELINE.md): this
// script freezes the content inventory an assessment must capture and binds nothing.
// Run `npm run build:dist` first. No acquisition, execution or Scan.
//
//   node tools/generate-superpowers-release-17.mjs [--check]
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeBehaviourIdentity } from "../dist/release/document.js";
import { canonicalJson } from "../dist/release/json.js";
import { compileTransitionRelease } from "../dist/release/producer.js";
import { createContentInventory, readRelease, readReleaseContent } from "../dist/release/reader.js";
import { sha256Hex } from "../dist/release/sha256.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const encoder = new TextEncoder();
const bytesOf = (value) => encoder.encode(`${canonicalJson(value)}\n`);
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const CONTENT_PATH = "release/release-superpowers.content.json";
export const INVENTORY_PATH = "release/baselines/superpowers/content-inventory.json";
const EARLIER_PATH = "release/release-superpowers.json";
const DATA_PATH = "producer/superpowers/release-1-7.json";
const UPSTREAM = "https://github.com/obra/superpowers";
const REPOSITORY = "https://github.com/samartomar/aih-catalog";
const AUTHORED = { id: "superpowers-catalog", origin: { kind: "authored" }, license: "Apache-2.0" };
/** The tool copies of each skill and the client whose recipe each carried. */
const TOOLS = [
  ["superpowers.skill.", "claude-code"],
  ["superpowers.kiro.skill.", "kiro-ide"],
  ["superpowers.copilot.skill.", "copilot-vscode"],
];
const recipePath = (id) => `release/recipes/${id}.json`;

/** The upstream source path a committed material carries, below its pinned revision. */
function sourcePathOf(member, revision) {
  const marker = `/${revision}/`;
  const at = member.path.indexOf(marker);
  assert(at > 0, `${member.path} is not a pinned upstream material`);
  return member.path.slice(at + marker.length);
}

/** Whether a SKILL.md frontmatter disables model invocation, and the basis recorded. */
export function skillInvocation(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  assert(frontmatter !== undefined, "A skill carries frontmatter");
  const line = /^disable-model-invocation:\s*(\S+)\s*$/m.exec(frontmatter);
  if (line === null)
    return { invocation: "model-allowed", invocationBasis: "frontmatter: disable-model-invocation absent" };
  assert(["true", "false"].includes(line[1]), `Unexpected disable-model-invocation ${line[1]}`);
  return line[1] === "true"
    ? { invocation: "user-only", invocationBasis: "frontmatter: disable-model-invocation: true" }
    : { invocation: "model-allowed", invocationBasis: "frontmatter: disable-model-invocation: false" };
}

/**
 * The hook payload from upstream's own hooks.json: the one SessionStart group, its
 * matcher, shell and the command `"${CLAUDE_PLUGIN_ROOT}/<script>" <args>`.
 */
export function hookPayload(settingsText, scriptId) {
  const groups = JSON.parse(settingsText).hooks;
  assert.deepEqual(Object.keys(groups), ["SessionStart"]);
  assert.equal(groups.SessionStart.length, 1);
  const [group] = groups.SessionStart;
  assert.equal(group.hooks.length, 1);
  const [handler] = group.hooks;
  assert.equal(handler.type, "command");
  const command = /^"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)" (.+)$/.exec(handler.command);
  assert(command, `Unexpected hook command ${handler.command}`);
  const script = scriptId(command[1]);
  return {
    event: "SessionStart",
    matcher: group.matcher,
    protocol: "claude-code-hooks",
    command: { interpreter: handler.shell, script, args: command[2].split(" ") },
  };
}

/** One route line per tool, each quoted verbatim from a line of upstream's README. */
export function nativeRoutes(routes, readme) {
  const lines = new Set(readme.split("\n").map((line) => line.trim()));
  return routes.map((route) => {
    assert(lines.has(route.line), `${route.tool} route is not an upstream README line: ${route.line}`);
    return `${route.tool}: ${route.line}`;
  });
}

/** Builds every output member from the committed Superpowers release and reviewed data. */
export function buildSuperpowers17() {
  const data = readJson(DATA_PATH);
  const earlierBytes = readFileSync(resolve(root, EARLIER_PATH));
  const earlier = readRelease(earlierBytes, { expectedSha256: sha256Hex(earlierBytes) });
  assert(earlier.valid, `Superpowers release unreadable: ${JSON.stringify(earlier.diagnostics)}`);
  const committed = JSON.parse(earlierBytes.toString("utf8"));
  const [source] = committed.sources;
  assert.equal(committed.sources.length, 1);
  assert.equal(source.origin.repository, UPSTREAM);
  const revision = source.origin.revision;
  const inventory = readJson("producer/superpowers/inventory.json");
  assert.equal(inventory.revision, revision);
  const modes = new Map(inventory.entries.map((row) => [row.path, row.mode]));
  const byId = new Map(committed.items.map((item) => [item.id, item]));
  const get = (id) => byId.get(id) ?? assert.fail(`The committed release carries no ${id}`);
  const upstreamBytes = (sourcePath) =>
    readFileSync(resolve(root, `release/materials/github.com/obra/superpowers/${revision}/${sourcePath}`));
  const outputs = new Map();

  // Each committed copy in the release 1.6 shape: content materials at item-relative
  // paths with their pinned executable state, the behaviour file and both identities.
  const project = (item, { id = item.id, relPath, materials = item.materials, dependencies = item.dependencies, recipe = item.recipe }) => {
    const content = materials.map((member) => {
      const sourcePath = sourcePathOf(member, revision);
      const mode = modes.get(sourcePath) ?? assert.fail(`No pinned mode for ${sourcePath}`);
      return {
        id: member.id,
        relPath: relPath(sourcePath),
        sourcePath,
        packagePath: member.path,
        sha256: member.sha256,
        byteLength: member.byteLength,
        executable: mode === "100755",
        sourceId: source.id,
        role: "content",
      };
    });
    return extend({
      id,
      label: item.label,
      ...(item.description ? { description: item.description } : {}),
      kind: item.kind,
      source: UPSTREAM,
      sourceIds: [source.id],
      targets: item.targets,
      scopes: item.scopes,
      inputs: item.inputs,
      recipe,
      dependencies,
      requirements: { inputs: {} },
    }, content);
  };
  const extend = (record, content) => {
    const executable = Object.fromEntries(content.map((member) => [member.relPath, member.executable]).sort(([a], [b]) => compare(a, b)));
    const item = { ...record, executable, materials: [...content, { id: "behaviour", relPath: "aih-behaviour.json", role: "behaviour", sha256: "" }] };
    const identity = computeBehaviourIdentity(item);
    item.materials[item.materials.length - 1] = {
      id: "behaviour",
      relPath: "aih-behaviour.json",
      sourcePath: null,
      packagePath: `release/items/${record.id}/aih-behaviour.json`,
      sha256: sha256Hex(identity.behaviourBytes),
      byteLength: identity.behaviourBytes.byteLength,
      executable: false,
      sourceId: "superpowers",
      role: "behaviour",
    };
    item.materials.sort((a, b) => compare(a.id, b.id));
    item.contentSha256 = identity.contentSha256;
    item.behaviourSha256 = computeBehaviourIdentity(item).behaviourSha256;
    return item;
  };

  const skills = committed.items
    .filter((item) => item.kind === "skill" && item.id.startsWith("superpowers.skill."))
    .map((item) => item.id.slice("superpowers.skill.".length));
  assert.equal(skills.length, 15);
  const copies = [];
  for (const name of skills)
    for (const [prefix] of TOOLS) {
      const item = get(`${prefix}${name}`);
      copies.push(project(item, { relPath: (path) => (path.startsWith(`skills/${name}/`) ? path.slice(`skills/${name}/`.length) : path) }));
    }
  copies.push(project(get(data.notices.id), { relPath: (path) => path }));

  // The hook folds its source item: the bootstrap's files become the hook's materials,
  // replacing the duplicate licence the group carried, and one recipe delivers both.
  const hookCopy = get(data.hook.copy);
  const folded = get(data.hook.folds);
  assert.deepEqual(hookCopy.dependencies.requires.map((ref) => ref.itemId), [folded.id]);
  const hookRecipe = readJson(hookCopy.recipe.path);
  const foldedRecipe = readJson(folded.recipe.path);
  const register = hookRecipe.operations.find((operation) => operation.kind === "hook.group");
  const writeOf = (sourcePath) => {
    const material = folded.materials.find((member) => sourcePathOf(member, revision) === sourcePath);
    return foldedRecipe.operations.find((operation) => operation.material === material.id).id;
  };
  const recipe = {
    ...hookRecipe,
    id: data.hook.id,
    description: "Deliver the pinned Superpowers bootstrap files and register its SessionStart group with a caller-reviewed command.",
    materials: foldedRecipe.materials,
    operations: [...foldedRecipe.operations, { ...register, requires: [writeOf("hooks/run-hook.cmd"), writeOf("hooks/session-start")] }],
    checks: foldedRecipe.checks,
  };
  const recipeBytes = bytesOf(recipe);
  outputs.set(recipePath(data.hook.id), { bytes: recipeBytes });
  const descriptor = (id, value, bytes) => ({ id, schema: value.schema, path: recipePath(id), sha256: sha256Hex(bytes), byteLength: bytes.byteLength });
  copies.push(project(hookCopy, {
    relPath: (path) => path,
    materials: folded.materials,
    dependencies: folded.dependencies,
    recipe: descriptor(data.hook.id, recipe, recipeBytes),
  }));

  // The fallback: one authored rule line, delivered as a file by its release 1.x recipe.
  const rule = data.fallback;
  assert.match(rule.text, /^[^\n]+\n$/, "The fallback rule is exactly one line");
  const ruleBytes = encoder.encode(rule.text);
  const rulePackagePath = `release/materials/superpowers/${rule.relPath}`;
  outputs.set(rulePackagePath, { bytes: ruleBytes });
  const ruleTarget = { root: "project", segments: [{ literal: ".superpowers-source" }, { literal: rule.relPath }] };
  const ruleRecipe = {
    schema: "urn:aihq:core:recipe:1.0.0",
    id: rule.id,
    description: "Deliver the Superpowers session bootstrap rule as a file.",
    targets: ["project"],
    inputs: {},
    prerequisites: [],
    materials: [{ id: "rule", sha256: sha256Hex(ruleBytes), byteLength: ruleBytes.byteLength }],
    operations: [{ id: "write-rule", kind: "file.write", purpose: `Deliver ${rule.relPath}`, scope: "project", material: "rule", target: ruleTarget, requires: [], checks: ["check-rule"] }],
    checks: [{ id: "check-rule", kind: "file.sha256", purpose: `Verify ${rule.relPath}`, sha256: sha256Hex(ruleBytes), target: ruleTarget }],
  };
  const ruleRecipeBytes = bytesOf(ruleRecipe);
  outputs.set(recipePath(rule.id), { bytes: ruleRecipeBytes });
  copies.push(extend({
    id: rule.id,
    label: rule.name,
    description: rule.description,
    kind: "rule",
    source: REPOSITORY,
    sourceIds: [AUTHORED.id],
    targets: [],
    scopes: ["project"],
    inputs: {},
    recipe: descriptor(rule.id, ruleRecipe, ruleRecipeBytes),
    dependencies: { requires: rule.requires.map((itemId) => ({ itemId })), optional: [], conflicts: [] },
    requirements: { inputs: {} },
  }, [{ id: "rule", relPath: rule.relPath, sourcePath: rule.relPath, packagePath: rulePackagePath, sha256: sha256Hex(ruleBytes), byteLength: ruleBytes.byteLength, executable: false, sourceId: AUTHORED.id, role: "content" }]));

  // Framework identity: upstream's name (README heading) and its published description.
  const readme = upstreamBytes("README.md").toString("utf8");
  assert.equal(/^# (.+)$/m.exec(readme)?.[1], data.framework.name);
  const framework = {
    id: data.framework.id,
    name: data.framework.name,
    version: data.framework.version,
    description: JSON.parse(upstreamBytes("package.json").toString("utf8")).description,
  };
  const package_ = { name: committed.package.name, version: readJson("package.json").version };
  // The copies as one release 1.6 input; it is never shipped.
  copies.sort((a, b) => compare(a.id, b.id));
  const input = { schema: "urn:aihq:catalog:release:1.6.0", package: package_, framework, sources: [{ ...source, license: "MIT" }, AUTHORED], items: copies };
  const inputBytes = bytesOf(input);
  const input16 = readReleaseContent(inputBytes, { expectedSha256: sha256Hex(inputBytes) });
  assert(input16.valid, `Release 1.6 input refused: ${JSON.stringify(input16.diagnostics)}`);
  const copyRelease = input16.release.sha256;

  const skillMd = (name) => upstreamBytes(`skills/${name}/SKILL.md`).toString("utf8");
  const factsOf = (item) => item.metadata.sourceFacts;
  const scriptOf = (relPath) => folded.materials.find((member) => sourcePathOf(member, revision) === relPath)?.id ?? assert.fail(`No hook material ${relPath}`);
  const hookSourcePath = "hooks/session-start";
  const items = [
    ...skills.map((name) => {
      const facts = factsOf(get(`superpowers.skill.${name}`));
      assert.equal(facts.name.value, name);
      return {
        id: `superpowers.skill.${name}`,
        kind: "skill",
        role: "choosable",
        name: facts.name.value,
        nameBasis: facts.name.basis,
        description: facts.description.value,
        descriptionBasis: facts.description.basis,
        payload: { dirName: name, ...skillInvocation(skillMd(name)) },
        copies: TOOLS.map(([prefix, clientId]) => ({ releaseSha256: copyRelease, itemId: `${prefix}${name}`, clientId })),
        hints: { tools: TOOLS.map(([, clientId]) => clientId).sort(compare) },
      };
    }),
    {
      id: data.notices.id,
      kind: "document",
      purpose: "notice",
      role: "supporting",
      name: data.notices.name,
      nameBasis: "publisher",
      description: data.notices.description,
      descriptionBasis: "publisher",
      copies: [{ releaseSha256: copyRelease, itemId: data.notices.id }],
    },
    {
      id: data.hook.id,
      kind: "hook",
      role: "choosable",
      name: data.hook.name,
      nameBasis: data.hook.nameBasis,
      description: data.hook.description,
      descriptionBasis: data.hook.descriptionBasis,
      payload: hookPayload(upstreamBytes(data.hook.settings).toString("utf8"), scriptOf),
      copies: [{ releaseSha256: copyRelease, itemId: data.hook.copy, clientId: "claude-code" }],
      // The folded source's bytes reappear in the hook, which names it by name and path.
      supersedes: [{ match: "name+sourcePath", releaseSha256: earlier.release.sha256, itemId: folded.id, itemSha256: earlier.release.items.find((entry) => entry.id === folded.id).itemSha256, name: data.hook.name, sourcePath: hookSourcePath }],
      fallback: { itemId: rule.id },
      hints: { tools: ["claude-code"] },
    },
    {
      id: rule.id,
      kind: "rule",
      role: "supporting",
      name: rule.name,
      nameBasis: "publisher",
      description: rule.description,
      descriptionBasis: "publisher",
      payload: { applyTo: ["**"], applyToBasis: "publisher", inclusion: "always", placement: "entry-block" },
      copies: [{ releaseSha256: copyRelease, itemId: rule.id }],
    },
  ];
  const retired = data.retired.map((entry) => ({
    id: entry.id,
    reason: entry.plugin
      ? `Upstream's ${entry.tool} plugin bundle: its manifest and adapter files for that tool. The Catalog never installs plugins; the tool's own install route is a nativeRoutes line, and the skills it bundles are items of this release.`
      : entry.reason,
    replacedBy: (entry.replacedBy ?? []).map((itemId) => ({ framework: framework.id, itemId })),
  }));
  for (const entry of retired) get(entry.id);
  const sets = [{
    id: data.set.id,
    name: data.set.name,
    description: data.set.description,
    offer: data.set.offer,
    // Upstream's plugin groups every skill with the bootstrap; each may be left out.
    // The bootstrap needs a caller-reviewed command, so it is offered and never pre-ticked.
    members: [
      ...skills.map((name) => ({ item: { framework: framework.id, itemId: `superpowers.skill.${name}` }, optional: true, defaultOn: true })),
      { item: { framework: framework.id, itemId: data.hook.id }, optional: true, defaultOn: false },
    ],
  }];
  const compiled = compileTransitionRelease({
    releases: { [input16.release.sha256]: input16.release, [earlier.release.sha256]: earlier.release },
    earlier: [earlier.release.sha256],
    framework,
    package: package_,
    items,
    retired,
    sets,
    nativeRoutes: nativeRoutes(data.nativeRoutes, readme),
  });
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
  for (const file of compiled.value.materials) outputs.set(file.path, { bytes: file.bytes });
  outputs.set(CONTENT_PATH, { bytes: compiled.value.releaseBytes });
  const frozen = createContentInventory(compiled.value.releaseBytes, { expectedSha256: compiled.value.releaseSha256 });
  assert(frozen.valid, JSON.stringify(frozen.diagnostics));
  outputs.set(INVENTORY_PATH, { bytes: frozen.bytes });
  return { release: compiled.value.release, releaseSha256: compiled.value.releaseSha256, inventorySha256: frozen.sha256, outputs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const built = buildSuperpowers17();
  const stale = [];
  for (const [path, { bytes }] of built.outputs) {
    const target = resolve(root, path);
    if (check) {
      let current;
      try {
        current = readFileSync(target);
      } catch {
        stale.push(`${path} (missing)`);
        continue;
      }
      if (!Buffer.from(bytes).equals(current)) stale.push(path);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
  }
  if (stale.length > 0) {
    console.error(`Stale Superpowers release 1.7.0 output; run node tools/generate-superpowers-release-17.mjs:\n  ${stale.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`${check ? "Checked" : "Generated"} Superpowers release 1.7.0 content ${built.releaseSha256} (${built.release.items.length} items, ${built.outputs.size} members, inventory ${built.inventorySha256})`);
  }
}
