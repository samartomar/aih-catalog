#!/usr/bin/env node
// ECC as release 1.7.0 content: one item per piece of content, ECC's own install
// modules as sets, its profiles as sets of those sets, and its languages and
// frameworks as one pick-several option. `rules/common` is always included and
// rules keep their language namespace. Per-tool copies (the Claude and Codex MCP
// registrations, the Copilot and Kiro skill copies) collapse into one item each,
// keeping the union of every copy's dependencies and licence material. ECC's Kiro
// edition is one set of its own, namespaced kiro, hinted for Kiro, its skills naming
// the main-edition skill they vary and its steering keeping its authored inclusion.
//
// The copies are the shipped release-ecc.json items restated as release 1.6 in
// memory, with item-relative paths (the install target without its tool prefix)
// and the executable state of the pinned tree's file modes. The install groups are
// the pinned upstream manifests, whose exact bytes are already committed and are
// checked here against the complete pinned tree ledger. No fetch, no execution, no
// Scan: the baseline binding is a separate preparation step (docs/SCAN-BASELINE.md).
// Run `npm run build:dist` first.
//
//   node tools/generate-ecc-release-17.mjs [--check]
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeBehaviourIdentity } from "../dist/release/document.js";
import { canonicalJson } from "../dist/release/json.js";
import { compileTransitionRelease, mcpEditsSha256 } from "../dist/release/producer.js";
import { createContentInventory, readRelease, readReleaseContent } from "../dist/release/reader.js";
import { sha256Hex } from "../dist/release/sha256.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const bytesOf = (value) => encoder.encode(`${canonicalJson(value)}\n`);
const json = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const FRAMEWORK_ID = "ecc";
export const SOURCE_RELEASE_PATH = "release/release-ecc.json";
export const CONTENT_PATH = "release/release-ecc.content.json";
export const INVENTORY_PATH = "release/baselines/ecc/content-inventory.json";
const MANIFESTS_PATH = "src/production/data/ecc-profile-sources-v1.json";
const MANIFEST = {
  modules: "manifests/install-modules.json",
  profiles: "manifests/install-profiles.json",
  components: "manifests/install-components.json",
};
const NPM_ACQUIRED_MCP = new Set(
  Object.keys(json("producer/ecc/mcp-acquisition.json").providers).map((key) => `ecc.mcp.${key}`),
);
/**
 * The reviewed readiness of every ECC MCP server. The Catalog has no structured field
 * that tells a server that runs as installed from one with an unverified provider, beta
 * consent, preprovisioning or a setup value, so only the servers this list names ready
 * may be set members.
 */
const MCP_READINESS = json("producer/ecc/mcp-starting-sets.json");
const MCP_READY = new Set(Object.keys(MCP_READINESS.ready));
/**
 * A required input with no default, secret or not: someone must supply it at install, so
 * a set cannot fill it. Both recipe configuration and the environment inputs an MCP server
 * introduces count.
 */
const needsCallerInput = (item) =>
  Object.values({ ...item.inputs, ...item.requirements?.inputs }).some(
    (spec) => spec.required && spec.default === undefined,
  );

/** The tool each per-tool copy was written for, as a recipe-map client id. */
const CLAUDE = "claude-code";
const CODEX = "codex";
const COPILOT = "copilot-vscode";
const KIRO = "kiro-ide";

/** The Kiro edition's display hint: written for Kiro. A hint never binds a tool. */
const KIRO_HINTS = Object.freeze({ tools: Object.freeze(["kiro"]) });
export const KIRO_SET_ID = "ecc.edition.kiro";

/**
 * ECC's language and framework component ids name their rule directory, except
 * where the two names differ: `lang:go` is ECC's `rules/golang`, and `lang:c`
 * uses the shared C/C++ standards in `rules/cpp`, as its own description says.
 */
const RULE_DIRECTORY_ALIASES = Object.freeze({ go: "golang", c: "cpp" });

/** Upstream install targets as recipe client ids where this release names that client. */
const TARGET_CLIENTS = Object.freeze({ claude: CLAUDE, "claude-project": CLAUDE, codex: CODEX });

/**
 * ECC modules that are not sets, each with the reason its pinned paths give no item:
 * a set is never offered empty. Every empty module needs a reason here, and every
 * reason here must name an empty module.
 */
export const OMITTED_MODULES = Object.freeze({
  "supply-chain-domain": "Its eight pinned skills each declare Apache-2.0 while ECC supplies only its MIT LICENSE, with no skill-specific licence or notice, so the Catalog does not redistribute them (producer/ecc/inventory.json).",
  ...Object.fromEntries(["docs-de-de", "docs-ja-jp", "docs-ko-kr", "docs-pt-br", "docs-ru", "docs-tr", "docs-uk-ua", "docs-vi-vn", "docs-zh-cn", "docs-zh-tw"].map((id) => [
    id,
    "Translated reference documentation of ECC's agents, commands, skills and rules: repository documentation, not installable content, so no item carries it (producer/ecc/inventory.json).",
  ])),
});

/** ECC's hook facts: the pinned registration bytes and the reviewed command translation. */
const HOOK_FACTS_PATH = "producer/ecc/hook-facts.json";

const SECRET_NAME = /token|secret|password|credential|auth|api[-_]?key|(?:^|_)key$/i;

/** The frontmatter block of a Markdown file, or undefined. */
function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? match[1] : undefined;
}

/** The steering inclusion modes the release rule payload names. */
const INCLUSION = Object.freeze(["always", "fileMatch", "manual"]);
/** Authored Kiro modes the release does not name, kept only in the basis; any other word fails. */
const UNNAMED_INCLUSION = Object.freeze(["auto"]);

/**
 * A Kiro steering file's file patterns and inclusion. A named inclusion mode is kept
 * as authored; `fileMatch` needs a `fileMatchPattern`, and only it may have one. An
 * authored mode the release does not name (the pinned edition's `auto`) leaves
 * `inclusion` unset rather than becoming another mode, and its basis says so.
 */
export function steeringPayload(text) {
  const head = frontmatter(text);
  const inclusion = head?.match(/^inclusion:\s*(\S+)\s*$/m)?.[1];
  assert(inclusion, "Kiro steering without an inclusion frontmatter");
  assert(INCLUSION.includes(inclusion) || UNNAMED_INCLUSION.includes(inclusion), `Unrecognised Kiro steering inclusion ${inclusion}`);
  const pattern = head.match(/^fileMatchPattern:\s*"([^"]+)"\s*$/m)?.[1];
  assert.equal(pattern !== undefined, inclusion === "fileMatch", `Kiro steering inclusion ${inclusion} and fileMatchPattern disagree`);
  const kept = INCLUSION.includes(inclusion);
  const basis = kept ? `authored: frontmatter inclusion ${inclusion}` : `authored: frontmatter inclusion ${inclusion}, a mode the release does not name, so inclusion is unset`;
  return {
    applyTo: pattern ? pattern.split(",").map((entry) => entry.trim()) : ["**"],
    applyToBasis: pattern ? `${basis} and fileMatchPattern` : `${basis}; no fileMatchPattern, so every file`,
    ...(kept ? { inclusion } : {}),
  };
}

/** A rule's file patterns: its authored `paths:` list, otherwise every file. */
function ruleApplyTo(text) {
  const head = frontmatter(text);
  if (head === undefined || !/^paths:/m.test(head))
    return { applyTo: ["**"], applyToBasis: "default: no paths frontmatter, so every file" };
  assert(/^paths:\n(  - "[^"]+"\n?)+$/.test(head), "Unrecognised rule frontmatter");
  return {
    applyTo: [...head.matchAll(/^ {2}- "([^"]+)"$/gm)].map((match) => match[1]),
    applyToBasis: "authored: frontmatter paths",
  };
}

/** `${NAME}` or `${NAME:-}` references in an offered server value. */
const references = (value) => [...JSON.stringify(value).matchAll(/\$\{([A-Z_][A-Z0-9_]*)(:-[^}]*)?\}/g)];

/**
 * The typed MCP payload and the inputs it introduces, from the offered server. An
 * environment or header value that is one reference becomes an input reference;
 * `Authorization: Bearer ${NAME}` names its token input, as the Codex translation does.
 */
export function mcpPayload(fact, sourceMaterial) {
  const offered = fact.offeredServer;
  const inputs = {};
  for (const [, name, fallback] of references(offered)) {
    inputs[name] = {
      type: "string",
      required: fallback === undefined,
      description: `Host environment value ${name}, which the ${fact.sourceKey} server reads.`,
      ...(SECRET_NAME.test(name) ? { sensitive: true } : {}),
    };
  }
  const entry = (key, value) => {
    const exact = value.match(/^\$\{([A-Z_][A-Z0-9_]*)(?::-[^}]*)?\}$/);
    if (exact) return { input: exact[1] };
    const bearer = key === "Authorization" ? value.match(/^Bearer \$\{([A-Z_][A-Z0-9_]*)\}$/) : null;
    if (bearer) {
      inputs[bearer[1]] = { ...inputs[bearer[1]], sensitive: true, description: `Bearer token for the ${fact.sourceKey} server's Authorization header, from host environment value ${bearer[1]}.` };
      return { input: bearer[1] };
    }
    assert(!value.includes("${"), `Unrepresentable MCP value ${fact.sourceKey}/${key}`);
    return { value };
  };
  const record = (values) =>
    values === undefined ? undefined : Object.fromEntries(Object.entries(values).map(([key, value]) => [key, entry(key, value)]));
  // The upstream definition without its display description, which is not server configuration.
  const { description: _display, ...upstream } = fact.rawServer;
  const transform = canonicalJson(upstream) === canonicalJson(offered) ? "identical" : "edited";
  const payload = {
    key: fact.sourceKey,
    transport: offered.type === "http" ? "http" : offered.type === "sse" ? "sse" : "stdio",
    ...(offered.command === undefined ? {} : { command: offered.command }),
    ...(offered.args === undefined ? {} : { args: offered.args }),
    ...(offered.url === undefined ? {} : { url: offered.url }),
    ...(offered.env === undefined ? {} : { env: record(offered.env) }),
    ...(offered.headers === undefined ? {} : { headers: record(offered.headers) }),
    derivation: {
      sourceMaterial,
      pointer: `/mcpServers/${fact.upstreamSourceKey ?? fact.sourceKey}`,
      transform,
      ...(transform === "edited" ? { editsSha256: mcpEditsSha256({ from: upstream, to: offered }) } : {}),
    },
  };
  return { payload, inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => compare(a, b))) };
}

/** Strips the tool prefix from an install target, giving the item-relative path. */
export function itemRelativePath(target) {
  const path = target.join("/");
  for (const pattern of [
    /^\.aihq\/ecc\/source\/ecc\.[^/]+\/(.+)$/,
    /^\.aihq\/ecc\/source\/(.+)$/,
    /^\.aihq\/ecc\/(.+)$/,
    /^\.(?:claude|kiro|github)\/skills\/[^/]+\/(.+)$/,
    /^\.(?:claude|kiro|github)\/[^/]+\/(.+)$/,
  ]) {
    const match = path.match(pattern);
    if (match) return match[1];
  }
  throw new Error(`Unrecognised ECC install target ${path}`);
}

/**
 * ECC's 24 Claude Code hooks: event, matcher, timeout, async and description from the
 * exact pinned hooks/hooks.json bytes (checked against the tree ledger), and the reviewed
 * command each item runs once upstream's inline root resolver is dropped. Every string
 * argument and path the translation names appears in the registered command, except
 * where a recorded translation says why the item runs what the bootstrap would spawn.
 */
export function hookFacts(inventory = json("producer/ecc/inventory.json")) {
  const data = json(HOOK_FACTS_PATH);
  const row = inventory.entries.find((entry) => entry.path === data.registration.path);
  const bytes = encoder.encode(data.registration.text);
  assert(row && sha256Hex(bytes) === row.sha256 && bytes.byteLength === row.byteLength, "hooks/hooks.json differs from the pinned tree");
  assert.equal(row.disposition, "unsupported-installation", "The registration file is never delivered");
  const groups = Object.entries(JSON.parse(data.registration.text).hooks).flatMap(([event, list]) => list.map((group) => ({ event, group })));
  assert.deepEqual(data.hooks.map((hook) => hook.upstreamId), groups.map(({ group }) => group.id), "One item per upstream hook group, in upstream order");
  const hooks = data.hooks.map((hook, index) => {
    const { event, group } = groups[index];
    assert.equal(group.hooks.length, 1, `${hook.upstreamId}: one command per group`);
    const [handler] = group.hooks;
    assert.equal(handler.type, "command");
    assert.match(handler.command, /^node /, `${hook.upstreamId}: a node command`);
    const named = [hook.registeredScript ?? hook.script, ...(hook.registeredScript ? [] : hook.args.map((arg) => (typeof arg === "string" ? arg : arg.material)))];
    // A path appears as written or as the path.join of its segments the wrapper uses.
    const joined = (text) => `path.join(${text.split("/").map((segment) => `'${segment}'`).join(",")})`;
    for (const text of named) assert(handler.command.includes(text) || handler.command.includes(joined(text)), `${hook.upstreamId}: ${text} is not in the registered command`);
    assert(hook.registeredScript === undefined || hook.translation, `${hook.upstreamId}: a changed script needs its recorded translation`);
    assert(hook.closure.every((path) => path !== data.registration.path && !path.includes(".claude-plugin/")), `${hook.upstreamId}: registration file in its closure`);
    return {
      ...hook,
      event,
      ...(group.matcher === undefined ? {} : { matcher: group.matcher }),
      ...(handler.timeout === undefined ? {} : { timeoutSec: handler.timeout }),
      async: handler.async === true,
      description: group.description,
    };
  });
  return { ...data, hooks };
}

/** The pinned upstream install manifests, checked against the complete tree ledger. */
export function installManifests() {
  const data = json(MANIFESTS_PATH);
  const inventory = json("producer/ecc/inventory.json");
  assert.equal(data.repository, inventory.repository);
  assert.equal(data.commit, inventory.revision);
  const manifest = (path) => {
    const entry = data.manifests.find((candidate) => candidate.path === path);
    const row = inventory.entries.find((candidate) => candidate.path === path);
    assert(entry && row, `Missing pinned manifest ${path}`);
    const bytes = encoder.encode(entry.text);
    assert.equal(sha256Hex(bytes), row.sha256, `${path} differs from the pinned tree`);
    assert.equal(bytes.byteLength, row.byteLength);
    return { path, sha256: row.sha256, value: JSON.parse(entry.text) };
  };
  return {
    modules: manifest(MANIFEST.modules),
    profiles: manifest(MANIFEST.profiles),
    components: manifest(MANIFEST.components),
  };
}

const sourcePathOf = (packagePath, revision) =>
  packagePath.slice(`release/materials/github.com/affaan-m/ECC/${revision}/`.length);

/**
 * One shipped release-ecc.json item restated as a release 1.6 copy: typed payload,
 * captured materials with item-relative paths and executable state, behaviour file
 * and both identities. Display names are the authored name, else the file name.
 */
function projectItem(item, { revision, modes, mcpFacts, files, hookFacts }) {
  const recipe = json(item.recipe.path);
  const writes = new Map(
    recipe.operations
      .filter((operation) => operation.kind === "file.write")
      .map((operation) => [operation.material, operation.target.segments.map((segment) => segment.literal)]),
  );
  const executable = {};
  const content = item.materials.map((member) => {
    const target = writes.get(member.id);
    assert(target?.every((segment) => typeof segment === "string"), `${item.id}: ${member.id} has no literal install target`);
    const relPath = itemRelativePath(target);
    const sourcePath = sourcePathOf(member.path, revision);
    const mode = modes.get(sourcePath);
    assert(mode, `${item.id}: ${sourcePath} is not in the pinned tree`);
    executable[relPath] = mode === "100755";
    return {
      id: member.id,
      relPath,
      sourcePath,
      packagePath: member.path,
      sha256: member.sha256,
      byteLength: member.byteLength,
      executable: mode === "100755",
      sourceId: FRAMEWORK_ID,
      role: "content",
    };
  });
  const primary = content[0];
  const text = () => decoder.decode(files.get(primary.sourcePath));
  const kiro = primary.sourcePath.startsWith(".kiro/");
  const sourceFacts = item.metadata?.sourceFacts;
  const stem = primary.sourcePath.split("/").at(-1).replace(/\.md$/, "");
  let kind = item.kind;
  let payload;
  let requirements = { inputs: {} };
  let name = sourceFacts?.name?.state === "authored" ? sourceFacts.name.value : stem;
  let nameBasis = sourceFacts?.name?.state === "authored" ? sourceFacts.name.basis : "file-name";
  if (item.kind === "skill") {
    const dirName = primary.sourcePath.split("/").at(-2);
    // No pinned ECC skill sets disable-model-invocation, so each may start when the model decides.
    assert(!/^disable-model-invocation:/m.test(frontmatter(text()) ?? ""), `${item.id}: invocation frontmatter`);
    payload = {
      dirName,
      ...(kiro ? { namespace: "kiro" } : {}),
      invocation: "model-allowed",
      invocationBasis: "default: no disable-model-invocation frontmatter",
    };
  } else if (item.kind === "instruction" && item.id === "ecc.notices") {
    kind = "document";
    payload = { files: content.map((member) => member.id) };
    name = "ECC notices";
    nameBasis = "publisher";
  } else if (item.kind === "instruction") {
    kind = "rule";
    // Rules keep their directory as their namespace; the Kiro edition's steering is "kiro".
    const parts = primary.sourcePath.split("/");
    const namespace = kiro ? "kiro" : parts.length > 2 ? parts[1] : undefined;
    payload = { ...(namespace ? { namespace } : {}), ...(kiro ? steeringPayload(text()) : ruleApplyTo(text())) };
    name = stem;
    nameBasis = "file-name";
  } else if (item.kind === "mcp") {
    kind = "mcp-server";
    const fact = mcpFacts[item.id];
    assert(fact, `${item.id}: no MCP facts`);
    const built = mcpPayload(fact, content.find((member) => member.sourcePath === fact.sourcePath).id);
    payload = built.payload;
    requirements = { inputs: built.inputs };
    name = fact.sourceKey;
    nameBasis = "key";
  } else if (item.kind === "agent" || item.kind === "command") {
    payload = { files: [primary.id] };
  } else if (item.kind === "hook") {
    // The copy carries no payload: release 1.6 has no async, so the item declares it.
    name = (hookFacts.get(item.id) ?? assert.fail(`${item.id}: no hook facts`)).upstreamId;
    nameBasis = "key";
  } else throw new Error(`${item.id}: kind ${item.kind} has no release 1.6 copy`);
  const projected = {
    id: item.id,
    label: item.label,
    ...(item.kind === "mcp" ? { description: mcpFacts[item.id].runtimePrerequisites } : item.description ? { description: item.description } : {}),
    ...(item.kind !== "mcp" && sourceFacts?.description?.state === "authored" ? { descriptionBasis: sourceFacts.description.basis } : {}),
    ...(item.kind === "hook" ? { descriptionBasis: "authored" } : {}),
    kind,
    name,
    nameBasis,
    source: "https://github.com/affaan-m/ECC",
    sourceIds: item.sourceIds,
    targets: item.targets,
    scopes: item.scopes,
    inputs: item.inputs,
    recipe: item.recipe,
    dependencies: item.dependencies,
    ...(payload === undefined ? {} : { payload }),
    requirements,
    executable: Object.fromEntries(Object.entries(executable).sort(([a], [b]) => compare(a, b))),
    materials: [...content, { id: "behaviour", relPath: "aih-behaviour.json", role: "behaviour", sha256: "" }],
  };
  const identity = computeBehaviourIdentity(projected);
  projected.materials[projected.materials.length - 1] = {
    id: "behaviour",
    relPath: "aih-behaviour.json",
    sourcePath: null,
    packagePath: `release/items/${item.id}/aih-behaviour.json`,
    sha256: sha256Hex(identity.behaviourBytes),
    byteLength: identity.behaviourBytes.byteLength,
    executable: false,
    sourceId: FRAMEWORK_ID,
    role: "behaviour",
  };
  projected.materials.sort((a, b) => compare(a.id, b.id));
  projected.contentSha256 = identity.contentSha256;
  projected.behaviourSha256 = computeBehaviourIdentity(projected).behaviourSha256;
  return projected;
}

/** A hook's typed payload: the upstream group's facts and the reviewed command, by material id. */
function hookPayload(copy, fact) {
  const content = copy.materials.filter((member) => member.role === "content");
  const idOf = (sourcePath) => content.find((member) => member.sourcePath === sourcePath)?.id ?? assert.fail(`${copy.id}: no material ${sourcePath}`);
  return {
    event: fact.event,
    ...(fact.matcher === undefined ? {} : { matcher: fact.matcher }),
    protocol: "claude-code-hooks",
    ...(fact.timeoutSec === undefined ? {} : { timeoutSec: fact.timeoutSec }),
    ...(fact.async ? { async: true } : {}),
    command: { interpreter: "node", script: idOf(fact.script), args: fact.args.map((arg) => (typeof arg === "string" ? arg : { material: idOf(arg.material) })) },
  };
}

/** A checked release 1.6 of copies; never shipped, only collapsed. */
function copiesRelease(source, framework, items, context, overrides = {}) {
  const document = {
    schema: "urn:aihq:catalog:release:1.6.0",
    package: source.package,
    framework: { ...framework, description: `${framework.description} (per-tool copies)` },
    sources: [{ ...source.sources[0], license: "MIT" }],
    items: items.map((item) => ({ ...projectItem(item, context), ...overrides[item.id] })).sort((a, b) => compare(a.id, b.id)),
  };
  const bytes = bytesOf(document);
  const read = readReleaseContent(bytes, { expectedSha256: sha256Hex(bytes) });
  assert(read.valid, `Release 1.6 copies refused: ${JSON.stringify(read.diagnostics.slice(0, 5))}`);
  return read.release;
}

/** Where the user-scope notice recipe is written; the generator owns its bytes. */
export const USER_NOTICE_RECIPE_PATH = "release/recipes/ecc.notices.user.json";

/**
 * The shipped project notice recipe moved to the user home: the same materials, checks
 * and item-relative layout under `~/.aihq/ecc/`, in user scope, as the Codex MCP recipes
 * place their own copies. Every scope and root must be the project's, so nothing else moves.
 */
export function userScopeRecipe(recipe) {
  const home = (target) => {
    assert.equal(target.root, "project", "A notice target outside the project root");
    return { ...target, root: "userHome" };
  };
  assert.deepEqual(recipe.targets, ["project"], "The shipped notice recipe admits the project only");
  return {
    ...recipe,
    description: `${recipe.description} Delivered into the user home for user-scope items.`,
    targets: ["user"],
    operations: recipe.operations.map((operation) => {
      assert.equal(operation.scope, "project", `Notice operation ${operation.id} outside the project scope`);
      return { ...operation, scope: "user", target: home(operation.target) };
    }),
    checks: recipe.checks.map((check) => ({ ...check, target: home(check.target) })),
  };
}

const ref = (setId) => ({ framework: FRAMEWORK_ID, setId });
const moduleSet = (id) => `ecc.module.${id}`;
const profileSet = (id) => `ecc.profile.${id}`;
const rulesSet = (directory) => `ecc.rules.${directory}`;
const under = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * The sets: each ECC module with its members, upstream dependencies and targets;
 * each language rule directory; each profile including its modules; and the one
 * languages-and-frameworks option on every profile that includes the rules module,
 * which itself always includes the common rules.
 */
export function eccSets(items, manifests) {
  const { modules, profiles, components } = manifests;
  // The Kiro edition is its own set; no main set lists it.
  const kiroEdition = items.filter((item) => item.payload.namespace === "kiro");
  // Caller-owned acquisition paths, other caller-typed values and secrets keep these servers
  // as standalone explicit choices: a set or profile must install without supplied input.
  for (const id of NPM_ACQUIRED_MCP)
    assert(needsCallerInput(items.find((item) => item.id === id)), `${id}: npm paths are caller input`);
  // A server that does not run as installed is never pre-ticked or listed in a set; every
  // ECC MCP server must be reviewed, and a ready one must need no supplied input.
  const servers = items.filter((item) => item.kind === "mcp-server").map((item) => item.id).sort(compare);
  assert.deepEqual([...MCP_READY, ...Object.keys(MCP_READINESS.notReady)].sort(compare), servers, "every ECC MCP server is reviewed exactly once");
  for (const id of MCP_READY)
    assert(!needsCallerInput(items.find((item) => item.id === id)), `${id}: a ready server needs no supplied input`);
  const choosable = items.filter(
    (item) =>
      item.role === "choosable" &&
      !kiroEdition.includes(item) &&
      !needsCallerInput(item) &&
      (item.kind !== "mcp-server" || MCP_READY.has(item.id)) &&
      !["ecc.mcp.github-local", "ecc.mcp.railway-hosted"].includes(item.id),
  );
  const primaryPath = (item) => item.materials.find((member) => member.role === "content" && member.sourcePath !== "LICENSE").sourcePath;
  const member = (item, optional = false, defaultOn = true) => ({
    item: { framework: FRAMEWORK_ID, itemId: item.id },
    // Every hook member is optional and never pre-ticked, so a hook is always a choice.
    optional: optional || item.kind === "hook",
    defaultOn: defaultOn && item.kind !== "hook",
  });
  const rules = choosable.filter((item) => item.kind === "rule");
  const directories = [...new Set(rules.map((item) => item.payload.namespace).filter(Boolean))].sort(compare);
  assert(directories.includes("common"), "ECC rules/common is missing");
  const ruleSets = directories.map((directory) => ({
    id: rulesSet(directory),
    name: `rules (${directory})`,
    description: `The rule modules in ECC's rules/${directory} directory.`,
    members: rules.filter((item) => item.payload.namespace === directory).map((item) => member(item)),
    offer: directory === "common" ? "pre-ticked" : "listed",
  }));
  const languageComponents = components.value.components.filter((component) => component.family === "language" || component.family === "framework");
  const choices = new Map();
  for (const component of languageComponents) {
    const id = component.id.split(":")[1];
    const directory = RULE_DIRECTORY_ALIASES[id] ?? id;
    choices.set(id, {
      id,
      name: id,
      description: component.description,
      sets: [...(directories.includes(directory) ? [ref(rulesSet(directory))] : []), ...component.modules.map((module) => ref(moduleSet(module)))],
    });
  }
  const named = new Set([...choices.keys()].map((id) => RULE_DIRECTORY_ALIASES[id] ?? id));
  for (const directory of directories) {
    if (directory === "common" || named.has(directory)) continue;
    choices.set(directory, { id: directory, name: directory, description: `The rule modules in ECC's rules/${directory} directory.`, sets: [ref(rulesSet(directory))] });
  }
  const languages = {
    id: "languages",
    name: "Languages and frameworks",
    multiple: true,
    description: "Pick several: each adds its ECC rule modules and the ECC modules its component lists. The common rules come with the rules module, with no choice made.",
    choices: [...choices.values()].sort((a, b) => compare(a.id, b.id)),
  };
  const targets = (list) => [...new Set(list.map((target) => TARGET_CLIENTS[target] ?? target))].sort(compare);
  const moduleSets = modules.value.modules.map((module) => {
    const rulesModule = module.id === "rules-core";
    const members = rulesModule
      // The rules module always brings the common rules and its README on request.
      ? rules.filter((item) => !item.payload.namespace).map((item) => member(item, true, false))
      : choosable.filter((item) => item.kind !== "rule" && module.paths.some((path) => under(primaryPath(item), path))).map((item) => member(item));
    return {
      id: moduleSet(module.id),
      name: module.id,
      description: module.description,
      members,
      ...(rulesModule ? { includes: [ref(rulesSet("common"))] } : {}),
      ...(module.dependencies.length ? { requires: module.dependencies.map((dependency) => ref(moduleSet(dependency))) } : {}),
      targets: targets(module.targets),
      offer: module.defaultInstall ? "pre-ticked" : "listed",
      // The upstream's own words, copied.
      cost: module.cost,
      stability: module.stability,
    };
  });
  // A module with no item is not a set; each has a recorded reason, and nothing refers to it.
  const empty = new Set(moduleSets.filter((set) => set.members.length === 0 && !set.includes).map((set) => set.id));
  assert.deepEqual([...empty].sort(compare), Object.keys(OMITTED_MODULES).map(moduleSet).sort(compare), "Every empty ECC module needs exactly one recorded reason");
  const kept = (refs) => refs.filter((ref) => !empty.has(ref.setId));
  for (const set of moduleSets) if (set.requires) set.requires = kept(set.requires);
  for (const choice of choices.values()) choice.sets = kept(choice.sets);
  for (const [id, choice] of choices) if (choice.sets.length === 0) choices.delete(id);
  languages.choices = [...choices.values()].sort((a, b) => compare(a.id, b.id));
  const profileSets = Object.entries(profiles.value.profiles).map(([id, profile]) => ({
    id: profileSet(id),
    name: id,
    description: profile.description,
    members: [],
    includes: kept(profile.modules.map((module) => ref(moduleSet(module)))),
    offer: "listed",
    ...(profile.modules.includes("rules-core") ? { options: [languages] } : {}),
  }));
  // Built bottom-up: rule directories, then modules in dependency order, then profiles.
  const byId = new Map(moduleSets.map((set) => [set.id, set]));
  const ordered = [];
  const visit = (set, stack = []) => {
    if (ordered.includes(set)) return;
    assert(!stack.includes(set.id), `ECC module cycle at ${set.id}`);
    for (const dependency of set.requires ?? []) visit(byId.get(dependency.setId), [...stack, set.id]);
    ordered.push(set);
  };
  for (const set of moduleSets) if (!empty.has(set.id)) visit(set);
  // ECC's separate Kiro edition: its skills and steering, one set of its own. The
  // upstream manifests name no Kiro module or target, so the set narrows no targets.
  assert(kiroEdition.length > 0 && kiroEdition.every((item) => item.role === "choosable" && item.hints?.tools?.includes("kiro")), "Unhinted Kiro edition item");
  const kiroSet = {
    id: KIRO_SET_ID,
    name: "ECC for Kiro",
    description: "ECC's separate Kiro edition: its skills and steering, written for Kiro.",
    members: kiroEdition.map((item) => member(item)),
    offer: "listed",
  };
  return [...ruleSets, ...ordered, ...profileSets, kiroSet];
}

/** The upstream's own words for each set's default, cost, stability and targets. */
function installMetadata(manifests, hookFacts) {
  return {
    eccInstallGroups: {
      manifests: Object.values(manifests).map(({ path, sha256 }) => ({ path, sha256 })),
      modules: Object.fromEntries(
        manifests.modules.value.modules.map((module) => [
          moduleSet(module.id),
          { id: module.id, kind: module.kind, defaultInstall: module.defaultInstall, cost: module.cost, stability: module.stability, targets: module.targets, dependencies: module.dependencies },
        ]),
      ),
      profiles: Object.fromEntries(Object.entries(manifests.profiles.value.profiles).map(([id, profile]) => [profileSet(id), { id, modules: profile.modules }])),
      ruleDirectoryAliases: RULE_DIRECTORY_ALIASES,
      omittedModules: OMITTED_MODULES,
    },
    eccHooks: { registration: { path: hookFacts.registration.path, sha256: hookFacts.registration.sha256 }, bootstrap: hookFacts.bootstrap, translations: hookFacts.hooks.filter((hook) => hook.translation).map(({ upstreamId, registeredScript, translation }) => ({ upstreamId, registeredScript, translation })) },
  };
}

/** Builds the ECC release 1.7.0 content, its behaviour files and its frozen inventory. */
export function buildEcc17() {
  const sourceBytes = readFileSync(resolve(root, SOURCE_RELEASE_PATH));
  const shipped = readRelease(sourceBytes, { expectedSha256: sha256Hex(sourceBytes) });
  assert(shipped.valid, `release-ecc.json unreadable: ${JSON.stringify(shipped.diagnostics)}`);
  const source = shipped.release;
  const inventory = json("producer/ecc/inventory.json");
  const snapshot = json("producer/ecc/snapshot.json");
  const revision = inventory.revision;
  const modes = new Map(inventory.entries.map((row) => [row.path, row.mode]));
  const files = new Map(snapshot.sources[0].files.map((file) => [file.path, Buffer.from(file.base64, "base64")]));
  const hookFactsData = hookFacts(inventory);
  const context = { revision, modes, mcpFacts: inventory.itemFacts, files, hookFacts: new Map(hookFactsData.hooks.map((hook) => [hook.itemId, hook])) };
  // Published framework identity: the repository name and the pinned plugin manifest.
  const plugin = JSON.parse(decoder.decode(files.get(".claude-plugin/plugin.json")));
  const framework = { id: FRAMEWORK_ID, name: inventory.repository.split("/")[1], version: plugin.version, description: plugin.description };
  const isTemplate = (item) => item.kind === "template";
  const isToolCopy = (item) => item.id.startsWith("ecc.codex.") || item.id.startsWith("ecc.copilot.");
  // Per-tool copies share names, which one release 1.6 allows once, so they are two releases.
  const main = copiesRelease(source, framework, source.items.filter((item) => !isTemplate(item) && !isToolCopy(item)), context);
  const tools = copiesRelease(source, framework, source.items.filter((item) => isToolCopy(item) || item.id === "ecc.notices"), context);
  // The notice every item requires, per client: the shipped project recipe for the project
  // clients, and the same delivery in the user home for Codex, whose MCP servers are user
  // scope. One notice admitting both scopes keeps every server's dependency closure.
  const noticeItem = source.items.find((item) => item.id === "ecc.notices");
  const userRecipeBytes = bytesOf(userScopeRecipe(json(noticeItem.recipe.path)));
  const userRecipe = { ...noticeItem.recipe, path: USER_NOTICE_RECIPE_PATH, sha256: sha256Hex(userRecipeBytes), byteLength: userRecipeBytes.byteLength };
  const kiroNotice = copiesRelease(source, framework, [noticeItem], context);
  const codexNotice = copiesRelease(source, framework, [noticeItem], context, { "ecc.notices": { scopes: ["user"], recipe: userRecipe } });
  const copy = (release, itemId, clientId) => ({ releaseSha256: release.sha256, itemId, ...(clientId ? { clientId } : {}) });
  const has = (release, itemId) => release.items.some((item) => item.id === itemId);
  const declarations = [];
  for (const item of main.items) {
    const id = item.id;
    if (id.startsWith("ecc.claude.mcp.")) {
      const key = id.slice("ecc.claude.mcp.".length);
      const codex = `ecc.codex.mcp.${key}`;
      declarations.push({
        id: `ecc.mcp.${key}`,
        kind: "mcp-server",
        role: "choosable",
        copies: has(tools, codex) ? [copy(main, id, CLAUDE), copy(tools, codex, CODEX)] : [copy(main, id)],
        ...(inventory.itemFacts[id].variantOf ? { variantOf: { itemId: `ecc.mcp.${inventory.itemFacts[id].variantOf}` } } : {}),
      });
    } else if (id.startsWith("ecc.kiro.skill.")) {
      // A Kiro skill names the main-edition skill of the same name that it varies.
      const variantOf = main.items.find((candidate) => candidate.kind === "skill" && !candidate.payload.namespace && candidate.name === item.name);
      assert(variantOf, `${id}: no main-edition skill named ${item.name}`);
      declarations.push({
        id: `ecc.skill.${id.slice("ecc.kiro.skill.".length)}.kiro-variant`,
        kind: "skill",
        role: "choosable",
        copies: [copy(main, id)],
        variantOf: { itemId: variantOf.id },
        hints: KIRO_HINTS,
      });
    } else if (id.startsWith("ecc.kiro.steering.")) {
      declarations.push({ id: `ecc.steering.${id.slice("ecc.kiro.steering.".length)}`, kind: "rule", role: "choosable", copies: [copy(main, id)], hints: KIRO_HINTS });
    } else if (id === "ecc.notices") {
      declarations.push({
        id,
        kind: "document",
        purpose: "notice",
        role: "supporting",
        copies: [copy(main, id, CLAUDE), copy(codexNotice, id, CODEX), copy(tools, id, COPILOT), copy(kiroNotice, id, KIRO)],
      });
    } else {
      const copilot = id.replace(/^ecc\.skill\./, "ecc.copilot.skill.");
      declarations.push({
        id,
        kind: item.kind,
        role: "choosable",
        copies: id.startsWith("ecc.skill.") && has(tools, copilot) ? [copy(main, id, CLAUDE), copy(tools, copilot, COPILOT)] : [copy(main, id)],
        // A hook speaks Claude Code's hook protocol: written for Claude Code, a display hint only.
        ...(item.kind === "hook" ? { hints: { tools: [CLAUDE] }, payload: hookPayload(item, context.hookFacts.get(id)) } : {}),
      });
    }
  }
  // A renamed copy is also superseded in the shipped release-ecc.json, whose digest an
  // installed copy records; its legacy items carry no identities, so the match is by
  // the survivor's name and the source path both carry.
  const copyItem = (entry) => [main, tools, kiroNotice, codexNotice].find((release) => release.sha256 === entry.releaseSha256).items.find((candidate) => candidate.id === entry.itemId);
  for (const declaration of declarations) {
    const name = copyItem(declaration.copies[0]).name;
    const supersedes = declaration.copies
      .filter((entry) => entry.itemId !== declaration.id)
      .map((entry) => {
        const old = source.items.find((candidate) => candidate.id === entry.itemId);
        const sourcePath = copyItem(entry).materials.find((material) => material.role === "content" && material.sourcePath !== "LICENSE").sourcePath;
        return { match: "name+sourcePath", releaseSha256: source.sha256, itemId: old.id, itemSha256: old.itemSha256, name, sourcePath };
      });
    if (supersedes.length > 0) declaration.supersedes = supersedes;
  }
  // The Kiro edition's items keep their content under a new id; nothing collapses.
  const renamed = declarations
    .filter((declaration) => declaration.id.endsWith(".kiro-variant") || declaration.id.startsWith("ecc.steering."))
    .map((declaration) => ({
      id: declaration.copies[0].itemId,
      reason: "Renamed: the Kiro edition's item keeps its content under a new id, namespaced kiro.",
      replacedBy: [{ framework: FRAMEWORK_ID, itemId: declaration.id }],
    }));
  const template = source.items.find(isTemplate);
  const draft = (sets, items = declarations) =>
    compileTransitionRelease({
      releases: { [main.sha256]: main, [tools.sha256]: tools, [kiroNotice.sha256]: kiroNotice, [codexNotice.sha256]: codexNotice, [source.sha256]: source },
      earlier: [source.sha256, main.sha256, tools.sha256],
      framework,
      package: source.package,
      items,
      retired: [
        ...renamed,
        {
          id: template.id,
          reason: "A Catalog-authored starting choice, not one of ECC's own install groups. ECC's sets are its upstream modules and profiles, so this template has no successor.",
          replacedBy: [],
        },
      ],
      ...(sets ? { sets } : {}),
      metadata: installMetadata(manifests, hookFactsData),
      readMaterial: (packagePath) => new Uint8Array(readFileSync(resolve(root, packagePath))),
    });
  const manifests = installManifests();
  const unset = draft();
  assert.equal(unset.status, "ok", JSON.stringify(unset.diagnostics.slice(0, 5)));
  // Variants and hints are declarations only: without them every item keeps both
  // identities, its recipe and its scopes.
  const undeclared = draft(undefined, declarations.map(({ variantOf: _variant, hints: _hints, ...rest }) => rest));
  assert.equal(undeclared.status, "ok", JSON.stringify(undeclared.diagnostics.slice(0, 5)));
  undeclared.value.release.items.forEach((plain, index) => {
    const declared = unset.value.release.items[index];
    for (const field of ["id", "contentSha256", "behaviourSha256", "recipe", "recipes", "scopes", "targets"])
      assert.deepEqual(declared[field], plain[field], `${plain.id}: variantOf or hints changed ${field}`);
  });
  const compiled = draft(eccSets(unset.value.release.items, manifests));
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics.slice(0, 5)));
  const release = compiled.value.release;
  // Every earlier ECC item id is a survivor or retired with a reason.
  const live = new Set(release.items.map((item) => item.id));
  const retired = new Map((release.retired ?? []).map((entry) => [entry.id, entry]));
  for (const item of source.items)
    assert(live.has(item.id) || retired.get(item.id)?.reason, `${item.id} is neither a survivor nor retired`);
  // Kiro-edition items are members of the Kiro set only, and it holds nothing else.
  for (const set of release.sets)
    for (const entry of set.members) {
      const kiro = release.items.find((item) => item.id === entry.item.itemId).payload.namespace === "kiro";
      assert.equal(kiro, set.id === KIRO_SET_ID, `${set.id}: ${entry.item.itemId}`);
    }
  const outputs = new Map();
  for (const file of compiled.value.materials) outputs.set(file.path, file.bytes);
  outputs.set(USER_NOTICE_RECIPE_PATH, userRecipeBytes);
  outputs.set(CONTENT_PATH, compiled.value.releaseBytes);
  const frozen = createContentInventory(compiled.value.releaseBytes, { expectedSha256: compiled.value.releaseSha256 });
  assert(frozen.valid, JSON.stringify(frozen.diagnostics));
  outputs.set(INVENTORY_PATH, frozen.bytes);
  return { release, releaseSha256: compiled.value.releaseSha256, inventorySha256: frozen.sha256, outputs, copies: [main, tools] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  assert.equal(process.argv.length, check ? 3 : 2, "Usage: node tools/generate-ecc-release-17.mjs [--check]");
  const built = buildEcc17();
  const stale = [];
  for (const [path, bytes] of built.outputs) {
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
    console.error(`Stale ECC release 1.7.0 output; run node tools/generate-ecc-release-17.mjs:\n  ${stale.slice(0, 20).join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`${check ? "Checked" : "Generated"} ECC release 1.7.0 content ${built.releaseSha256} (${built.release.items.length} items, ${built.release.sets.length} sets, ${built.outputs.size} members, inventory ${built.inventorySha256})`);
  }
}
