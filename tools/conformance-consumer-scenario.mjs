// Copied into an outside consumer; only public package interfaces are imported.
// Contract conformance of the prepared release 1.7.0 contents (Extensions, ECC,
// Superpowers, Project basics): hook payloads Core renders verbatim and registration
// files kept out of hook materials, ECC's upstream hooks as optional never-pre-ticked
// items, no empty set, Matt's buckets, ECC's set words and pick-several option, the
// contract's behaviour-identity encoding, measured sizes, provenance hops and display
// hints. Every expectation is recomputed here from the installed bytes, independently
// of the Catalog's own build code. No Core, no execution, no Scan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readReleaseContent } from "@aihq/catalog/reader";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const exported = (name) => readFileSync(fileURLToPath(import.meta.resolve(`@aihq/catalog/${name}`)));
const member = (path) => readFileSync(join(root, path));
const results = [];
const case_ = async (name, fn) => {
  try {
    results.push({ ...((await fn()) ?? {}), name, status: "pass" });
  } catch (error) {
    results.push({ name, status: "fail", error: String(error?.stack ?? error) });
  }
};

const CONTENTS = {
  extensions: "release-extensions.content.json",
  ecc: "release-ecc.content.json",
  superpowers: "release-superpowers.content.json",
  "project-basics": "release-project-basics.content.json",
};
const releases = Object.fromEntries(Object.entries(CONTENTS).map(([id, name]) => [id, JSON.parse(exported(name).toString("utf8"))]));
const items = Object.values(releases).flatMap((release) => release.items.map((item) => ({ release, item })));
const hooks = items.filter(({ item }) => item.kind === "hook");
const contentOf = (item) => item.materials.filter((entry) => entry.role !== "behaviour");
const byId = (item, id) => item.materials.find((entry) => entry.id === id);

// The contract's canonical JSON: keys sorted, no whitespace.
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
      : JSON.stringify(value);
const bytewise = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const contentLines = (item) => contentOf(item).map((entry) => `${entry.relPath}\t${entry.sha256}\n`).sort(bytewise).join("");

/** Core's hook rule, as aih-core renders it: an interpreter runs the script, or a program gets it as a material argument. */
const coreRefusal = (item) => {
  const command = item.payload.command;
  if (command.interpreter !== undefined && command.program !== undefined) return "hook-command-ambiguous";
  if (command.interpreter === undefined && command.program === undefined) return "interpreter-required";
  if (command.program !== undefined && !(command.args ?? []).some((arg) => arg?.material === command.script)) return "hook-command-ambiguous";
  for (const text of [command.program, ...(command.args ?? [])].filter((arg) => typeof arg === "string"))
    for (const [, name] of text.matchAll(/\{([^{}]*)\}/g))
      if (!["projectDir", "homeDir", "itemDir", "pluginRoot"].includes(name)) return "unknown-placeholder";
  return undefined;
};
const registration = (relPath) => {
  const segments = relPath.split("/");
  return segments.at(-1) === "hooks.json" || segments.includes(".claude-plugin") || (segments.at(-2) === ".claude" && /^settings(\.local)?\.json$/.test(segments.at(-1)));
};

await case_("every hook renders as Core's rule requires: one runner, no placeholder outside Core's list", () => {
  assert.ok(hooks.length > 0);
  const refused = hooks.map(({ item }) => [item.id, coreRefusal(item)]).filter(([, reason]) => reason !== undefined);
  assert.deepEqual(refused, []);
  return { hooks: hooks.length };
});

await case_("no hook needs a command typed in: no required input without a default", () => {
  for (const { item } of hooks)
    for (const spec of [...Object.values(item.inputs ?? {}), ...Object.values(item.requirements?.inputs ?? {})])
      assert.ok(!(spec.required === true && spec.default === undefined), `${item.id} requires an input`);
});

await case_("no hook material is a hook registration file", () => {
  const found = hooks.flatMap(({ item }) => contentOf(item).filter((entry) => registration(entry.relPath)).map((entry) => `${item.id}:${entry.relPath}`));
  assert.deepEqual(found, []);
});

await case_("the reader refuses a hook a program runs without its script argument, and one naming both runners", () => {
  const release = structuredClone(releases.extensions);
  const at = release.items.findIndex((item) => item.kind === "hook");
  // A consistent item with only the command changed: its behaviour file and identity follow.
  const refusal = (command) => {
    const copy = structuredClone(release);
    const item = copy.items[at];
    item.payload.command = command;
    const dependencies = { requires: item.dependencies.requires ?? [], optional: item.dependencies.optional ?? [], conflicts: item.dependencies.conflicts ?? [] };
    const behaviour = Buffer.from(`${canonical({ kind: item.kind, payload: item.payload, requirements: item.requirements, dependencies, executable: item.executable })}\n`);
    const file = item.materials.find((entry) => entry.role === "behaviour");
    Object.assign(file, { sha256: sha256(behaviour), byteLength: behaviour.length, size: { ...file.size, bytes: behaviour.length, chars: behaviour.length } });
    item.behaviourSha256 = sha256(Buffer.from(canonical({ kind: item.kind, payload: item.payload, requirements: item.requirements, dependencies, materials: contentLines(item), executable: item.executable })));
    const bytes = Buffer.from(`${canonical(copy)}\n`);
    return readReleaseContent(bytes, { expectedSha256: sha256(bytes) }).diagnostics.map((entry) => entry.reason);
  };
  const script = release.items[at].payload.command.script;
  assert.ok(refusal({ program: "node", script }).includes("hook-command-ambiguous"));
  assert.ok(refusal({ program: "node", interpreter: "node", script }).includes("hook-command-ambiguous"));
  assert.ok(refusal({ script }).includes("interpreter-required"));
});

await case_("ECC publishes each of its 24 upstream hooks once, optional and never pre-ticked, in its hooks-runtime set", () => {
  const ecc = releases.ecc;
  const eccHooks = ecc.items.filter((item) => item.kind === "hook");
  assert.equal(eccHooks.length, 24);
  assert.equal(new Set(eccHooks.map((item) => item.name)).size, 24);
  const runtime = ecc.sets.find((set) => set.id === "ecc.module.hooks-runtime");
  assert.deepEqual(runtime.members.map((entry) => entry.item.itemId).sort(), eccHooks.map((item) => item.id).sort());
  for (const set of Object.values(releases).flatMap((release) => release.sets ?? []))
    for (const entry of set.members) {
      const item = items.find(({ item: candidate }) => candidate.id === entry.item.itemId)?.item;
      if (item?.kind === "hook") assert.deepEqual([entry.optional, entry.defaultOn], [true, false], `${set.id}: ${item.id}`);
    }
  // Upstream registers seven groups async; each keeps it.
  const asynchronous = eccHooks.filter((item) => item.payload.async === true).map((item) => item.name).sort();
  assert.deepEqual(asynchronous, ["post:dispatcher:async", "pre:observe:continuous-learning", "session:end:marker", "stop:cost-tracker", "stop:desktop-notify", "stop:evaluate-session", "stop:session-end"]);
  return { asynchronous };
});

await case_("no set is empty", () => {
  const empty = Object.values(releases).flatMap((release) => (release.sets ?? []).filter((set) => set.members.length === 0 && !set.includes?.length && !set.requires?.length && !set.options?.length).map((set) => set.id));
  assert.deepEqual(empty, []);
});

await case_("Matt's buckets are sets of their pinned skills; only buckets with skills are offered", () => {
  const extensions = releases.extensions;
  const bucketOf = (item) => item.provenance?.source.sourceId === "matt" ? item.provenance.source.path.split("/")[1] : undefined;
  const offers = { engineering: "pre-ticked", productivity: "pre-ticked", "in-progress": "listed", misc: "on-request" };
  for (const [bucket, offer] of Object.entries(offers)) {
    const set = extensions.sets.find((entry) => entry.id === bucket);
    assert.equal(set?.offer, offer, bucket);
    const matt = extensions.items.filter((item) => bucketOf(item) === bucket).map((item) => item.id);
    const copied = extensions.items.filter((item) => item.provenance?.derivedFrom.some((hop) => hop.sourceId === "matt" && hop.path.split("/")[1] === bucket)).map((item) => item.id);
    assert.ok(matt.length > 0, bucket);
    assert.deepEqual(set.members.map((entry) => entry.item.itemId).sort(), [...matt, ...copied].sort(), bucket);
  }
  assert.ok(!extensions.sets.some((set) => ["specialists", "deprecated"].includes(set.id)));
  assert.ok(extensions.metadata.mattBuckets.notSets.specialists && extensions.metadata.mattBuckets.notSets.deprecated);
});

await case_("ECC sets carry upstream's own cost and stability words; languages is pick-several", () => {
  const ecc = releases.ecc;
  const modules = ecc.metadata.eccInstallGroups.modules;
  for (const set of ecc.sets.filter((entry) => entry.id.startsWith("ecc.module."))) {
    assert.equal(set.cost, modules[set.id].cost, set.id);
    assert.equal(set.stability, modules[set.id].stability, set.id);
  }
  const options = ecc.sets.flatMap((set) => set.options ?? []);
  assert.ok(options.length > 0 && options.every((option) => option.id !== "languages" || option.multiple === true));
  for (const omitted of Object.keys(ecc.metadata.eccInstallGroups.omittedModules)) assert.ok(!ecc.sets.some((set) => set.id === `ecc.module.${omitted}`));
});

await case_("behaviourSha256 is the contract's canonical-JSON encoding; contentSha256 its sorted lines", () => {
  for (const { item } of items) {
    const lines = contentLines(item);
    assert.equal(item.contentSha256, sha256(Buffer.from(lines)), item.id);
    const dependencies = { requires: item.dependencies.requires ?? [], optional: item.dependencies.optional ?? [], conflicts: item.dependencies.conflicts ?? [] };
    const value = { kind: item.kind, payload: item.payload ?? null, requirements: item.requirements, dependencies, materials: lines, executable: item.executable };
    assert.equal(item.behaviourSha256, sha256(Buffer.from(canonical(value))), item.id);
  }
  return { items: items.length };
});

await case_("every material and item carries its measured size, recomputable from the installed bytes", () => {
  const strict = new TextDecoder("utf-8", { fatal: true });
  const text = (bytes) => {
    if (bytes.includes(0)) return undefined;
    try { return strict.decode(bytes); } catch { return undefined; }
  };
  for (const { item } of items) {
    for (const entry of item.materials) {
      const bytes = member(entry.packagePath);
      const decoded = text(bytes);
      assert.deepEqual(entry.size, decoded === undefined
        ? { bytes: bytes.length, chars: null, tokens: [], status: "not-text" }
        : { bytes: bytes.length, chars: [...decoded].length, tokens: [], status: "measured" }, `${item.id}:${entry.relPath}`);
    }
    const parts = Object.fromEntries(item.size.parts.map((part) => [part.part, part]));
    assert.deepEqual(parts.name, { part: "name", bytes: Buffer.byteLength(item.name), chars: [...item.name].length }, item.id);
    // Files are every content material except a Markdown primary, whose frontmatter and
    // body are parts of their own (the --- delimiters belong to neither).
    const all = contentOf(item).reduce((total, entry) => total + entry.size.bytes, 0);
    const primary = parts.frontmatter ? all - parts.files.bytes : 0;
    assert.ok(primary >= 0 && (parts.frontmatter === undefined) === (parts.body === undefined), item.id);
    if (parts.frontmatter) assert.ok(parts.frontmatter.bytes + parts.body.bytes <= primary && contentOf(item).some((entry) => entry.size.bytes === primary), item.id);
    else assert.equal(parts.files.bytes, all, item.id);
    assert.deepEqual(item.size.tokens, []);
  }
});

await case_("provenance is hops at their source's pin and licence, never a bare URL", () => {
  for (const release of Object.values(releases)) {
    const sources = new Map(release.sources.map((source) => [source.id, source]));
    const pin = (sourceId) => {
      const source = sources.get(sourceId);
      assert.ok(source, sourceId);
      return source.origin.kind === "authored" ? release.framework.version : source.origin.revision;
    };
    for (const item of release.items) {
      const { source, selectedBy, derivedFrom } = item.provenance;
      for (const hop of [source, ...(selectedBy ? [selectedBy] : []), ...derivedFrom]) {
        assert.equal(hop.revision, pin(hop.sourceId), item.id);
        assert.ok(!/^[a-z]+:\/\//.test(hop.path), item.id);
      }
      for (const hop of [source, ...derivedFrom]) assert.equal(hop.license, sources.get(hop.sourceId).license, item.id);
      assert.ok(!Object.hasOwn(item, "selectedBy"), `${item.id} carries a URL selection`);
    }
  }
  const selected = releases.extensions.items.filter((item) => item.provenance.selectedBy?.sourceId === "extensions");
  assert.equal(selected.length, 27);
});

await case_("a skill's invocation is its author's disable-model-invocation flag", () => {
  const skills = items.filter(({ item }) => item.kind === "skill");
  for (const { item } of skills) {
    const text = member(contentOf(item).find((entry) => entry.relPath === "SKILL.md").packagePath).toString("utf8");
    const flag = /^disable-model-invocation:\s*(\S+)\s*$/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "")?.[1];
    assert.equal(item.payload.invocation, flag === "true" ? "user-only" : "model-allowed", item.id);
    assert.match(item.payload.invocationBasis, /disable-model-invocation/, item.id);
  }
  return { userOnly: skills.filter(({ item }) => item.payload.invocation === "user-only").length };
});

await case_("tool hints are display hints, never the recipe keys of tool-neutral content", () => {
  for (const { item } of items) {
    if (item.hints === undefined) continue;
    // A hook speaks Claude Code's hook protocol and the Kiro edition is written for Kiro;
    // any other content is tool-neutral, so its recipe keys are never shown as hints.
    if (item.kind === "hook") assert.deepEqual(item.hints.tools, ["claude-code"], item.id);
    else {
      assert.ok(item.hints.tools.includes("kiro"), `${item.id}: a hint on tool-neutral content`);
      if (item.recipes) assert.notDeepEqual(item.hints.tools, Object.keys(item.recipes).sort(), item.id);
    }
  }
});

process.stdout.write(JSON.stringify({ results }));
