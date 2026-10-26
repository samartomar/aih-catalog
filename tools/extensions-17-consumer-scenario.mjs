// Copied into an outside consumer; only public package interfaces are imported.
// Extensions release 1.7.0 prepared content (samartomar/aih-catalog#145): one
// tool-neutral item per piece of content, true Matt provenance, Matt's buckets as
// sets, the 27 frozen-default copies superseded by name and source path, the hook
// sources folded into their hook items, set resolution through the public reader
// and the restructuring comparison. No Core, no execution, no Scan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contractSupport11,
  FROZEN_DEFAULT_RELEASE_SHA256,
  preparedReleaseContent,
  releaseInventory,
} from "@aihq/catalog/contracts";
import { compareRestructuring } from "@aihq/catalog/producer";
import {
  configureItem,
  createContentInventory,
  readRelease,
  readReleaseContent,
  resolveSelections,
  validateSelectionSet,
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

const CONTENT = "release-extensions.content.json";
const INVENTORY = "release/baselines/extensions/content-inventory.json";
const MATT = "https://github.com/mattpocock/skills";
const SELECTED_BY = "https://github.com/samartomar/aih-extensions";
const SETUP = "extensions.matt.setup-matt-pocock-skills";
const contentBytes = exported(CONTENT);
const read = readReleaseContent(contentBytes, { expectedSha256: sha256(contentBytes) });
assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
const release = read.release;
const item = (id) => release.items.find((entry) => entry.id === id);
const frozenBytes = exported("release.json");
const frozen = readRelease(frozenBytes, { expectedSha256: sha256(frozenBytes) });
assert.equal(frozen.valid, true, JSON.stringify(frozen.diagnostics));
const hookIds = release.items
  .filter((entry) => entry.kind === "hook")
  .map((entry) => entry.id)
  .sort();
const mattItems = release.items.filter((entry) => entry.id.startsWith("extensions.matt."));
const mattNames = mattItems.map((entry) => entry.id.slice("extensions.matt.".length));
const set = (id) => release.sets.find((entry) => entry.id === id);

await case_("a separate release 1.7.0 with a published framework identity and one item per content", () => {
  assert.equal(release.schema, "urn:aihq:catalog:release:1.7.0");
  assert.equal(release.framework.id, "extensions");
  assert.equal(release.framework.name, "Extensions");
  assert.equal(release.package.name, "@aihq/catalog");
  assert.equal(release.items.length, 57);
  assert.equal(release.sets.length, 8);
  assert.equal(release.retired.length, 118);
  // Matt's skills are found once, inside AIH-Extensions, never per tool.
  assert.equal(mattItems.length, 27);
  for (const name of mattNames) {
    assert.equal(item(`extensions.matt.${name}`) !== undefined, true, name);
    assert.equal(item(`extensions.kiro.matt.${name}`), undefined, name);
    assert.equal(item(`extensions.copilot.matt.${name}`), undefined, name);
  }
});

await case_("Matt's skills carry true provenance: his repository, selected by AIH-Extensions, no fork", () => {
  for (const entry of mattItems) {
    assert.equal(entry.source, MATT, entry.id);
    assert.equal(entry.selectedBy, SELECTED_BY, entry.id);
    assert.equal(entry.derivedFrom, undefined, entry.id);
  }
  // The per-tool copies are retired and name their survivor.
  for (const name of mattNames)
    for (const prefix of ["kiro.", "copilot."]) {
      const retired = release.retired.find((entry) => entry.id === `extensions.${prefix}matt.${name}`);
      assert.ok(retired, `extensions.${prefix}matt.${name}`);
      assert.deepEqual(retired.replacedBy, [{ framework: "extensions", itemId: `extensions.matt.${name}` }]);
    }
});

await case_("Matt's buckets are sets with the accepted offer levels and firstRun names the setup skill", () => {
  const offers = Object.fromEntries(release.sets.map((entry) => [entry.id, entry.offer]));
  assert.deepEqual(offers, {
    engineering: "pre-ticked",
    productivity: "pre-ticked",
    "in-progress": "listed",
    specialists: "listed",
    misc: "on-request",
    deprecated: "on-request",
    "extensions.template.specialists": "listed",
    "extensions.template.complete": "listed",
  });
  // The pinned revision carries the engineering and productivity skills; the other
  // buckets are declared empty at their offer level.
  const engineering = set("engineering");
  assert.equal(engineering.members.length, 20);
  assert.equal(engineering.firstRun.framework, "extensions");
  assert.equal(engineering.firstRun.itemId, SETUP);
  assert.equal(set("productivity").members.length, 7);
  for (const id of ["in-progress", "specialists", "misc", "deprecated"])
    assert.deepEqual(set(id).members, [], id);
  for (const memberEntry of set("engineering").members)
    assert.equal(memberEntry.item.itemId.startsWith("extensions.matt."), true);
  const complete = set("extensions.template.complete");
  assert.equal(complete.firstRun.itemId, SETUP);
  // The setup skill sits in engineering, so every set that names it carries it as a member.
  for (const entry of release.sets.filter((candidate) => candidate.firstRun !== undefined))
    assert.ok(
      entry.members.some((memberEntry) => memberEntry.item.itemId === SETUP),
      entry.id,
    );
});

await case_("the Specialists set has offer listed (fixture)", () => {
  assert.equal(set("specialists").offer, "listed");
  assert.equal(set("specialists").name, "Specialists");
});

await case_("every hook member of every Extensions set is optional", () => {
  assert.deepEqual(hookIds, [
    "extensions.hook.git-guard",
    "extensions.hook.lanes-card",
    "extensions.hook.skill-guard",
  ]);
  for (const entry of release.sets)
    for (const memberEntry of entry.members)
      if (hookIds.includes(memberEntry.item.itemId)) {
        assert.equal(memberEntry.optional, true, `${entry.id} / ${memberEntry.item.itemId}`);
        assert.equal(memberEntry.defaultOn, false, `${entry.id} / ${memberEntry.item.itemId}`);
      }
  // The complete template suggests the hooks; the specialists template leaves them out.
  const completeMembers = set("extensions.template.complete").members.map((memberEntry) => memberEntry.item.itemId);
  for (const hook of hookIds) assert.ok(completeMembers.includes(hook), hook);
  assert.ok(!set("extensions.template.specialists").members.some((memberEntry) => hookIds.includes(memberEntry.item.itemId)));
});

await case_("each of the 27 frozen-default copies is superseded by name and source path", () => {
  const frozenMatt = frozen.release.items.filter((entry) => entry.id.startsWith("mattpocock."));
  assert.equal(frozenMatt.length, 27);
  for (const old of frozenMatt) {
    const name = old.id.slice("mattpocock.".length);
    const survivor = item(`extensions.matt.${name}`);
    assert.ok(survivor, name);
    const supersession = (survivor.supersedes ?? []).find((entry) => entry.itemId === old.id);
    assert.ok(supersession, name);
    assert.equal(supersession.match, "name+sourcePath", name);
    assert.equal(supersession.releaseSha256, FROZEN_DEFAULT_RELEASE_SHA256, name);
    assert.equal(supersession.itemSha256, old.itemSha256, name);
    assert.equal(supersession.name, survivor.name, name);
    assert.ok(
      survivor.materials.some((material) => material.sourcePath === supersession.sourcePath),
      `${name}: ${supersession.sourcePath}`,
    );
    assert.equal(supersession.contentSha256, undefined, name);
    assert.equal(supersession.behaviourSha256, undefined, name);
  }
});

await case_("collapsed survivors keep the union of materials, dependencies and licences", () => {
  // grill-me's copies declared different requirements; the survivor keeps the union.
  const grill = item("extensions.matt.grill-me");
  assert.deepEqual(
    grill.dependencies.requires.map((ref) => ref.itemId).sort(),
    ["extensions.matt.grilling", "extensions.notices"],
  );
  // Every survivor carries its licence and support materials exactly once.
  for (const entry of release.items) {
    const relPaths = entry.materials.filter((material) => material.role !== "behaviour").map((material) => material.relPath);
    assert.equal(new Set(relPaths).size, relPaths.length, entry.id);
    assert.ok(relPaths.includes("LICENSE"), entry.id);
  }
  // The folded hooks keep the pinned scripts and the settings reference.
  const hook = item("extensions.hook.git-guard");
  const hookPaths = hook.materials.filter((material) => material.role !== "behaviour").map((material) => material.sourcePath).sort();
  assert.deepEqual(hookPaths, [
    "LICENSE",
    "hooks/git-guard.mjs",
    "hooks/hooks.json",
    "hooks/lib/git-context.mjs",
    "hooks/lib/git-policy.mjs",
    "hooks/lib/shell.mjs",
  ]);
  assert.equal(hook.payload.protocol, "claude-code-hooks");
  assert.equal(hook.payload.command.program, "node");
  assert.equal(hook.payload.timeoutSec, 10);
  assert.ok(hook.payload.command.script, "the command names a script material");
});

await case_("material and behaviour bytes are captured and agree with the package members", () => {
  for (const entry of release.items) {
    for (const material of entry.materials) {
      const bytes = member(material.packagePath);
      assert.equal(sha256(bytes), material.sha256, `${entry.id} ${material.packagePath}`);
      assert.equal(bytes.byteLength, material.byteLength, `${entry.id} ${material.packagePath}`);
    }
    const behaviour = entry.materials.find((material) => material.role === "behaviour");
    assert.equal(behaviour.relPath, "aih-behaviour.json", entry.id);
    const declared = JSON.parse(member(behaviour.packagePath).toString("utf8"));
    assert.equal(declared.kind, entry.kind, entry.id);
    assert.deepEqual(declared.payload, entry.payload, entry.id);
  }
});

await case_("per-tool delivery is a transition recipe map selected by clientId", () => {
  const grill = item("extensions.matt.grill-me");
  assert.deepEqual(Object.keys(grill.recipes).sort(), ["claude-code", "copilot-vscode", "kiro-ide"]);
  for (const [clientId, recipe] of Object.entries(grill.recipes))
    assert.ok(recipe.materials.every((id) => grill.materials.some((material) => material.id === id)), clientId);
  const unnamed = configureItem({
    release,
    itemId: "extensions.matt.grill-me",
    configuration: {},
    materialSource: { kind: "local", input: "catalog" },
  });
  assert.equal(unnamed.valid, false);
  assert.ok(unnamed.diagnostics.some((diagnostic) => diagnostic.reason === "client-id-required"));
  const unknown = configureItem({
    release,
    itemId: "extensions.matt.grill-me",
    clientId: "opencode",
    configuration: {},
    materialSource: { kind: "local", input: "catalog" },
  });
  assert.equal(unknown.valid, false);
  assert.ok(unknown.diagnostics.some((diagnostic) => diagnostic.reason === "client-unavailable"));
  const asClaude = configureItem({
    release,
    itemId: "extensions.matt.grill-me",
    clientId: "claude-code",
    configuration: {},
    materialSource: { kind: "local", input: "catalog" },
  });
  assert.equal(asClaude.valid, true, JSON.stringify(asClaude.diagnostics));
});

await case_("the folded hook configures through its reviewed command input", () => {
  const hook = item("extensions.hook.git-guard");
  assert.equal(typeof hook.inputs.hookCommand, "object");
  assert.equal(hook.inputs.hookCommand.required, true);
  const recipe = JSON.parse(member(hook.recipe.path).toString("utf8"));
  assert.equal(sha256(member(hook.recipe.path)), hook.recipe.sha256);
  assert.equal(recipe.schema, "urn:aihq:core:recipe:1.3.0");
  assert.ok(recipe.operations.some((operation) => operation.kind === "hook.group"));
  const configured = configureItem({
    release,
    itemId: hook.id,
    configuration: { hookCommand: 'node "$CLAUDE_PROJECT_DIR/.aih-extensions/source/hooks/git-guard.mjs"' },
    materialSource: { kind: "local", input: "catalog" },
  });
  assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
});

await case_("set resolution expands buckets and keeps qualified origins; an excluded hook stays out", () => {
  const engineering = set("engineering");
  const resolved = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [],
    skips: [],
    sets: [
      {
        release: { releaseSha256: release.sha256, scope: "project" },
        setId: "engineering",
        setSha256: engineering.setSha256,
      },
    ],
  });
  assert.equal(resolved.status, "ok", JSON.stringify(resolved.diagnostics));
  const ids = resolved.value.selections.map((selection) => selection.item.itemId);
  assert.ok(ids.includes("extensions.matt.setup-matt-pocock-skills"));
  const setup = resolved.value.selections.find((selection) => selection.item.itemId === SETUP);
  assert.ok(setup.origins.some((origin) => origin.reasonIncluded === "in-set" && origin.set.setId === "engineering"));
  const validated = validateSelectionSet({ releases: { [release.sha256]: release }, selections: resolved.value.selections });
  assert.equal(validated.valid, true, JSON.stringify(validated.diagnostics));
  // A wrong set digest is a refusal.
  const wrong = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [],
    skips: [],
    sets: [{ release: { releaseSha256: release.sha256, scope: "project" }, setId: "engineering", setSha256: "0".repeat(64) }],
  });
  assert.equal(wrong.status, "refused");
  // The complete template only suggests its hooks: optional members stay off unless
  // the request names them, and an excluded hook is never re-added.
  const complete = set("extensions.template.complete");
  const suggestedOnly = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [],
    skips: [],
    sets: [
      {
        release: { releaseSha256: release.sha256, scope: "project" },
        setId: "extensions.template.complete",
        setSha256: complete.setSha256,
      },
    ],
  });
  assert.equal(suggestedOnly.status, "ok", JSON.stringify(suggestedOnly.diagnostics));
  const suggested = suggestedOnly.value.selections.map((selection) => selection.item.itemId);
  for (const hook of hookIds) assert.ok(!suggested.includes(hook), `${hook} is suggested, not taken`);
  const withoutGuard = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [],
    skips: [],
    sets: [
      {
        release: { releaseSha256: release.sha256, scope: "project" },
        setId: "extensions.template.complete",
        setSha256: complete.setSha256,
        members: [{ item: { framework: "extensions", itemId: "extensions.hook.git-guard" }, include: false }],
      },
    ],
  });
  assert.equal(withoutGuard.status, "ok", JSON.stringify(withoutGuard.diagnostics));
  const chosen = withoutGuard.value.selections.map((selection) => selection.item.itemId);
  assert.ok(!chosen.includes("extensions.hook.git-guard"));
  for (const hook of hookIds) assert.ok(!chosen.includes(hook), `${hook} stays suggested only`);
  assert.ok(chosen.includes("extensions.matt.setup-matt-pocock-skills"));
});

await case_("the shipped content inventory is the frozen inventory of this content", () => {
  const inventory = createContentInventory(contentBytes, { expectedSha256: sha256(contentBytes) });
  assert.equal(inventory.valid, true, JSON.stringify(inventory.diagnostics));
  assert.deepEqual(Buffer.from(inventory.bytes), exported(INVENTORY));
});

await case_("the restructuring comparison passes, including the 27 supersessions", () => {
  const result = compareRestructuring({ release, expectation: json("restructuring/expected-1.7.0.json") });
  assert.equal(result.status, "pass", JSON.stringify(result.rows.filter((row) => row.status === "fail")));
  assert.deepEqual(result.counts.item, { pass: 57, fail: 0 });
  assert.deepEqual(result.counts.hash, { pass: 57, fail: 0 });
  assert.deepEqual(result.counts.supersession, { pass: 133, fail: 0 });
  assert.deepEqual(result.counts.retired, { pass: 118, fail: 0 });
});

await case_("the content is not yet a qualified release: no baseline is bound or listed", () => {
  const unbound = readRelease(contentBytes, { expectedSha256: sha256(contentBytes) });
  assert.equal(unbound.valid, false);
  assert.ok(unbound.diagnostics.some((entry) => entry.reason === "baseline-invalid"));
  assert.ok(!releaseInventory.releases.some((entry) => entry.release.includes("extensions.content")));
  const [prepared] = preparedReleaseContent.filter((entry) => entry.frameworkId === "extensions");
  assert.equal(prepared.export, `@aihq/catalog/${CONTENT}`);
  assert.equal(prepared.inventory, INVENTORY);
  assert.equal(prepared.schema, release.schema);
  // The package support contract still lists exactly one 1.7.0 golden fixture pair.
  const contract = contractSupport11.contracts.find((entry) => entry.id === "urn:aihq:catalog:release:1.7.0");
  assert.ok(contract);
});

process.stdout.write(JSON.stringify({ results }));
