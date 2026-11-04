#!/usr/bin/env node
// Ports the maintained frameworks (ECC, Superpowers, Extensions and project-basics) through
// the ordinary producer: each upstream is fetched at its exact pin with `fetchSource` (no
// hooks, no lifecycle scripts, nothing executed), `findItems` proposes the items, the authored
// facts below add editions, cut-outs, references and bundles, and `buildContent` records the
// content. It writes `data/<framework>/content.json`, the generated cut-outs under
// `data/<framework>/generated/`, and the dispositions of these families' baseline items in
// `port-report/maintained.json`. Catalog's own authored files are read from
// `data/<framework>/authored/<source>/`. `--check` rebuilds and compares instead of writing.
//
// The result is candidate data: it is not accepted or trusted until the data-commit gate
// passes for every new scan key.
//
// usage: npm run port:maintained [-- --check]
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSource, readLocalSource } from "../dist/catalog/node.js";
import { buildContent, checkContent } from "../dist/catalog/producer.js";
import { findItems } from "../dist/catalog/source.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
for (const arg of process.argv.slice(2))
  if (arg !== "--check") {
    console.error(`port-maintained: unexpected argument ${arg}`);
    process.exit(2);
  }

/** The exact upstream pins. Extensions and Matt's skills are the pins aih-extensions declares. */
const PINS = {
  ecc: { repository: "https://github.com/affaan-m/ECC", commit: "5064474d4d762dc9640234a41617cccb79185cec" },
  superpowers: {
    repository: "https://github.com/obra/superpowers",
    commit: "5bf4e78011075bcfc0dc295f0724994cd123ee71",
  },
  extensions: {
    repository: "https://github.com/samartomar/aih-extensions",
    commit: "2481164a51ea7f9e480d51ef52f3d5cf15b017fa",
  },
  matt: { repository: "https://github.com/mattpocock/skills", commit: "59db609eb1e18aaf59b63284d0e52255aff0c63c" },
};

/**
 * Exact versions Catalog pins for ECC MCP packages the upstream config leaves unpinned.
 * They are the versions the previous Catalog release reviewed for the same upstream package.
 * A server the upstream starts some other way, or whose package has no reviewed pin, is not
 * cut out; `MCP_DROPPED` gives the reason.
 */
const MCP_VERSIONS = {
  codescene: "1.5.13",
  confluence: "1.3.3",
  context7: "4.4.4",
  "exa-web-search": "3.4.2",
  "fal-ai": "2.1.4",
  filesystem: "2.0.1",
  firecrawl: "3.35.0",
  magic: "2.0.0",
  memory: "2.0.0",
  "omega-memory": "1.5.20",
  playwright: "0.0.83",
  "sequential-thinking": "2.0.0",
  squish: "1.9.0",
  supabase: "0.14.0",
};
const MCP_INPUTS = { filesystem: { "/path/to/your/projects": "FILESYSTEM_ROOT" } };
const NO_VERSION =
  "no reviewed exact version for the package the upstream entry names; a maintainer can add one";
const LOCAL_BINARY =
  "the upstream entry starts a locally installed program, which a Registry server.json cannot describe";
const MCP_DROPPED = {
  github: `${NO_VERSION}: @modelcontextprotocol/server-github`,
  browserbase: `${NO_VERSION}: the reviewed pin was for a different package (@browserbasehq/mcp)`,
  railway: `${NO_VERSION}: the reviewed pin was for a different package (@railway/cli)`,
  "token-optimizer": `${NO_VERSION}: token-optimizer-mcp`,
  evalview: "the upstream entry runs python3 -m evalview, with no Registry package runner or version",
  nexus: LOCAL_BINARY,
  "ecc-memory-vault": LOCAL_BINARY,
  longhand: LOCAL_BINARY,
  "ito-compute": `${LOCAL_BINARY} (an absolute path to an unpublished build)`,
};

/** Upstream material these families hold that is not ported as items or editions, and why. */
const NOT_PORTED = [
  {
    family: "ecc",
    paths: [".agents/skills/"],
    reason:
      "ECC's Codex-style skill copies. ECC reaches Codex and the other .agents/skills clients by items rendered from the general skills (ECC's route is items everywhere, with editions only on Kiro); an edition for one client would clash with the others' renders in the shared folder",
  },
  {
    family: "ecc",
    paths: [".cursor/"],
    reason:
      "ECC's Cursor rule, skill and hook copies. Cursor gets items rendered from the general files, and its profile has no hook edition place",
  },
  {
    family: "ecc",
    paths: [".opencode/"],
    reason: "OpenCode commands, prompts and a JavaScript plugin; a skill edition is placed in a skill folder",
  },
  {
    family: "ecc",
    paths: [".codex/agents/"],
    reason: "ECC's three Codex-only agents have no neutral agent file, which an agent item needs",
  },
  {
    family: "ecc",
    paths: [".mcp.json", ".codex/config.toml", ".kiro/settings/mcp.json.example"],
    reason: "per-client MCP configs; the MCP items are cut out of mcp-configs/mcp-servers.json",
  },
  {
    family: "ecc",
    paths: [".kiro/README.md", ".kiro/docs/", ".kiro/hooks/README.md", ".kiro/install.sh", ".kiro/scripts/"],
    reason: "Kiro guides, ECC's Kiro installer and the scripts it copies; not items",
  },
  {
    family: "ecc",
    paths: [
      ".claude/",
      ".claude-plugin/",
      ".codex-plugin/",
      ".agents/plugins/",
      "docs/",
      "examples/",
      "hooks/memory-persistence/",
      "legacy-command-shims/",
      "manifests/",
      "plugins/",
      "scripts/",
      "tests/",
      "dot folders of clients Catalog does not profile",
    ],
    reason:
      "ECC's own plugin manifests, installers, runtime scripts, documentation, tests and repository configuration. The items route installs only chosen items; scripts that hook entries run are recorded as path references",
  },
  {
    family: "extensions",
    paths: ["guide/"],
    reason: "the AIH Guide is the guide framework's content, not Extensions'",
  },
  {
    family: "extensions",
    paths: ["docs/", "evals/", "hook-declarations/", "hooks/", "scripts/", "source-declarations/", "tests/"],
    reason:
      "aih-extensions' installer, evaluations and declarations, and the scripts its hook entries run (recorded as path references)",
  },
  {
    family: "extensions",
    paths: ["routes"],
    reason:
      "aih-extensions declares no per-client routes: source-declarations/v1.json reports installation not-declared. No Extensions base recipe is written, so whole-framework selection stays blocked until the package supplies its routes; individually chosen items use the items route",
  },
  {
    family: "superpowers",
    paths: ["hooks/hooks-cursor.json"],
    reason: "Superpowers' Cursor hook file; the Cursor profile has no hook edition place",
  },
];

/** ECC skills whose own frontmatter declares Apache-2.0 while the repository supplies only MIT. */
const UPSTREAM_ONLY_LICENCE =
  "the skill declares Apache-2.0 but the repository supplies only its MIT LICENSE, so Catalog does not ship a copy";

const out = { written: [], drift: [] };
const encoder = new TextEncoder();

function fail(message) {
  console.error(`port-maintained: ${message}`);
  process.exit(1);
}

async function fetchPinned(name, work) {
  const pin = PINS[name];
  const result = await fetchSource({ kind: "git", repository: pin.repository, ref: pin.commit }, { outDir: work });
  if (result.status !== "ok") fail(`fetching ${name}: ${JSON.stringify(result)}`);
  if (result.source.commit !== pin.commit) fail(`${name} resolved to ${result.source.commit}`);
  return result;
}

const fileMap = (files) => new Map(files.filter((file) => file.bytes).map((file) => [file.path, file]));
const textOf = (file) => new TextDecoder().decode(file.bytes);
const discoveredFile = (sourceId, file, extra = {}) => ({
  sourceId,
  sourcePath: file.path,
  sha256: file.sha256,
  executable: file.mode === "100755",
  role: "content",
  ...extra,
});
const under = (prefixes) => (file) => prefixes.some((prefix) => file.path === prefix || file.path.startsWith(prefix));

function discover(files, framework, sourceId, prefixes) {
  const found = findItems(files.filter(under(prefixes)), { framework, sourceId });
  if (found.status !== "ok") fail(`findItems ${sourceId}: ${JSON.stringify(found).slice(0, 2000)}`);
  return found;
}

/**
 * Namespaced names an item's files mention (`<ns>:<name>`, as a whole token) that name one of
 * the framework's own items, so the plan can list them as unresolved plugin references.
 */
function namespacedNames(item, files, namespace, names) {
  const token = new RegExp(`(?<![A-Za-z0-9_:-])${namespace}:([a-z0-9][a-z0-9-]*)(?![A-Za-z0-9_-])`, "g");
  const found = new Set();
  for (const file of item.files) {
    const source = files.get(file.sourcePath);
    if (!source) continue;
    for (const match of textOf(source).matchAll(token)) if (names.has(match[1])) found.add(`${namespace}:${match[1]}`);
  }
  return [...found].sort();
}

function withReferences(items, filesBySource, namespace) {
  const names = new Set(
    items.flatMap((item) => {
      const last = item.id.slice(item.id.lastIndexOf(".") + 1);
      return [last];
    }),
  );
  return items.map((item) => {
    const files = filesBySource.get(item.files[0]?.sourceId);
    if (!files) return item;
    const references = namespacedNames(item, files, namespace, names);
    return references.length > 0 ? { ...item, references } : item;
  });
}

async function build(source, files, items, options) {
  const built = await buildContent(source, files, items, options);
  if (built.status !== "ok") fail(`buildContent ${options.framework.id}: ${JSON.stringify(built).slice(0, 4000)}`);
  return built;
}

function authored(framework, sourceId) {
  const folder = join(root, "data", framework, "authored", sourceId);
  const read = readLocalSource(folder);
  if (read.status !== "ok") fail(`reading ${relative(root, folder)}: ${JSON.stringify(read)}`);
  return read.files;
}

// ---------------------------------------------------------------------------------------------
// ECC

async function ecc(work) {
  const fetched = await fetchPinned("ecc", work);
  const files = fetched.files;
  const byPath = fileMap(files);
  const found = discover(files, "ecc", "ecc", ["skills/", "agents/", "commands/", "rules/", "LICENSE"]);
  const dropped = new Map([["ecc.rule.README", "rules/README.md describes the rules folder; it is not a rule"]]);
  let items = found.items.filter((item) => !dropped.has(item.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  const kiro = (path) => byPath.get(path) ?? fail(`missing ${path}`);

  // Kiro editions: ECC's hand-made Kiro agents (a JSON file and its Markdown prompt) and its
  // Kiro skill copies.
  for (const file of files.filter((entry) => /^\.kiro\/agents\/[^/]+\.json$/.test(entry.path))) {
    const name = file.path.slice(".kiro/agents/".length, -".json".length);
    const id = `ecc.agent.${name}`;
    const item = byId.get(id) ?? fail(`no agent for ${file.path}`);
    byId.set(id, {
      ...item,
      editions: { kiro: { files: [file, kiro(`.kiro/agents/${name}.md`)].map((entry) => discoveredFile("ecc", entry)) } },
    });
  }
  const kiroSkills = [...new Set(files.filter((entry) => entry.path.startsWith(".kiro/skills/")).map((entry) => entry.path.split("/")[2]))];
  for (const name of kiroSkills) {
    const id = `ecc.skill.${name}`;
    const item = byId.get(id) ?? fail(`no skill for .kiro/skills/${name}`);
    const editionFiles = files.filter((entry) => entry.path.startsWith(`.kiro/skills/${name}/`));
    byId.set(id, { ...item, editions: { kiro: { files: editionFiles.map((entry) => discoveredFile("ecc", entry)) } } });
  }
  // Kiro steering becomes rule items whose Kiro edition is the steering file itself, and
  // Kiro's own hook files hook items placed only from that edition.
  for (const file of files.filter((entry) => /^\.kiro\/steering\/[^/]+\.md$/.test(entry.path))) {
    const name = file.path.slice(".kiro/steering/".length, -".md".length);
    const edition = [discoveredFile("ecc", file)];
    byId.set(`ecc.rule.steering.${name}`, { id: `ecc.rule.steering.${name}`, kind: "rule", files: edition, editions: { kiro: { files: edition } } });
  }
  for (const file of files.filter((entry) => /^\.kiro\/hooks\/[^/]+\.kiro\.hook$/.test(entry.path))) {
    const name = file.path.slice(".kiro/hooks/".length, -".kiro.hook".length);
    const edition = [discoveredFile("ecc", file)];
    byId.set(`ecc.hook.${name}`, { id: `ecc.hook.${name}`, kind: "hook", files: edition, editions: { kiro: { files: edition } } });
  }
  // The skills that declare their own Apache-2.0 licence are recorded upstream-only.
  for (const [id, item] of byId) {
    if (item.kind !== "skill") continue;
    const skill = item.files.find((file) => file.sourcePath.endsWith("/SKILL.md"));
    if (skill && /^license:\s*Apache-2\.0\s*$/m.test(textOf(byPath.get(skill.sourcePath)).split(/\n---/)[0]))
      byId.set(id, { ...item, fetch: "upstream" });
  }

  // Claude hooks: each group of ECC's hooks/hooks.json, cut out as its own one-entry file, with
  // Claude's edition the same entry; ECC's Codex hook is the Codex edition of session-start.
  const hooks = JSON.parse(textOf(kiro("hooks/hooks.json"))).hooks;
  const shared = kiro("hooks/hooks.json");
  const cut = (file, pointer, as, extra = {}) => discoveredFile("ecc", file, { cut: { pointer, as, ...extra } });
  for (const [event, groups] of Object.entries(hooks))
    groups.forEach((group, index) => {
      const name = String(group.id).replaceAll(":", "-");
      const pointer = `/hooks/${event}/${index}`;
      byId.set(`ecc.hook.${name}`, {
        id: `ecc.hook.${name}`,
        kind: "hook",
        files: [cut(shared, pointer, "hook")],
        editions: { "claude-code": { files: [cut(shared, pointer, "hook")] } },
      });
    });
  const codexHooks = JSON.parse(textOf(kiro("hooks/codex-hooks.json"))).hooks;
  codexHooks.SessionStart.forEach((group, index) => {
    const id = `ecc.hook.${String(group.id).replaceAll(":", "-")}`;
    const item = byId.get(id) ?? fail(`no Claude hook for the Codex ${group.id}`);
    byId.set(id, {
      ...item,
      editions: { ...item.editions, codex: { files: [cut(kiro("hooks/codex-hooks.json"), `/hooks/SessionStart/${index}`, "hook")] } },
    });
  });

  // MCP servers: each entry of mcp-configs/mcp-servers.json as its own Registry server.json.
  const mcpFile = kiro("mcp-configs/mcp-servers.json");
  const servers = JSON.parse(textOf(mcpFile)).mcpServers;
  const mcpDropped = new Map();
  for (const name of Object.keys(servers)) {
    if (MCP_DROPPED[name]) {
      mcpDropped.set(name, MCP_DROPPED[name]);
      continue;
    }
    const extra = {
      ...(MCP_VERSIONS[name] ? { version: MCP_VERSIONS[name] } : {}),
      ...(MCP_INPUTS[name] ? { inputs: MCP_INPUTS[name] } : {}),
    };
    byId.set(`ecc.mcp.${name}`, { id: `ecc.mcp.${name}`, kind: "mcp", files: [cut(mcpFile, `/mcpServers/${name}`, "mcp", extra)] });
  }
  for (const name of [...Object.keys(MCP_DROPPED)]) if (!(name in servers)) fail(`MCP ${name} is not upstream`);

  items = withReferences([...byId.values()], new Map([["ecc", byPath]]), "ecc");
  const built = await build({ kind: "git", ...PINS.ecc }, files, items, { framework: { id: "ecc", name: "ECC" } });
  return { built, found, dropped, mcpDropped, files, extraFiles: [] };
}

// ---------------------------------------------------------------------------------------------
// Superpowers

async function superpowers(work) {
  const fetched = await fetchPinned("superpowers", work);
  const files = fetched.files;
  const byPath = fileMap(files);
  const found = discover(files, "superpowers", "superpowers", ["skills/", "LICENSE"]);
  const catalogFiles = authored("superpowers", "superpowers-catalog");
  const bootstrap = catalogFiles.find((file) => file.path === "session-bootstrap.md") ?? fail("no session-bootstrap.md");
  const hooksFile = byPath.get("hooks/hooks.json");
  const cut = { cut: { pointer: "/hooks/SessionStart/0", as: "hook" } };
  const items = withReferences(
    [
      ...found.items,
      {
        id: "superpowers.hook.session-start",
        kind: "hook",
        files: [discoveredFile("superpowers", hooksFile, cut)],
        editions: { "claude-code": { files: [discoveredFile("superpowers", hooksFile, cut)] } },
      },
      { id: "superpowers.rule.session-bootstrap", kind: "rule", files: [discoveredFile("superpowers-catalog", bootstrap)] },
    ],
    new Map([["superpowers", byPath]]),
    "superpowers",
  );
  const built = await build({ kind: "git", ...PINS.superpowers }, files, items, {
    framework: { id: "superpowers", name: "Superpowers" },
    plugins: ["/"],
    sources: [{ id: "superpowers-catalog", source: { kind: "authored" }, files: catalogFiles }],
  });
  return { built, found, files, extraFiles: catalogFiles.map((file) => ({ ...file, sourceId: "superpowers-catalog" })) };
}

// ---------------------------------------------------------------------------------------------
// Extensions (aih-extensions with the Matt Pocock skills it installs from their own repository)

async function extensions(work) {
  const own = await fetchPinned("extensions", work);
  const matt = await fetchPinned("matt", work);
  const ownPaths = fileMap(own.files);
  const found = discover(own.files, "extensions", "extensions", ["skills/", "agents/", "commands/", "LICENSE", "NOTICE.md", "licenses/"]);
  const mattFound = discover(matt.files, "extensions", "matt", ["skills/", "LICENSE"]);
  // aih-extensions vendors Matt's setup-pre-commit skill itself; its copy is the item.
  const mattDropped = new Map([
    ["extensions.skill.misc.setup-pre-commit", "aih-extensions vendors this skill; its copy is extensions.skill.setup-pre-commit"],
  ]);
  const hooksFile = ownPaths.get("hooks/hooks.json");
  const hookCut = (pointer) => discoveredFile("extensions", hooksFile, { cut: { pointer, as: "hook" } });
  const hookItems = [
    ["git-guard", "/hooks/PreToolUse/0"],
    ["skill-guard", "/hooks/PreToolUse/1"],
    ["lanes-card", "/hooks/SessionStart/0"],
  ].map(([name, pointer]) => ({
    id: `extensions.hook.${name}`,
    kind: "hook",
    files: [hookCut(pointer)],
    editions: { "claude-code": { files: [hookCut(pointer)] } },
  }));
  const proposed = [...found.items, ...mattFound.items.filter((item) => !mattDropped.has(item.id)), ...hookItems];
  const sources = [{ id: "matt", source: { kind: "git", ...PINS.matt }, files: matt.files }];
  const options = { framework: { id: "extensions", name: "AIH Extensions" }, sources };
  // The checklists in references/ are read by skills at ../../references/: a runtime bundle.
  const first = await build({ kind: "git", ...PINS.extensions }, own.files, proposed, options);
  const readers = new Set(
    first.content.items
      .filter((item) => item.kind === "skill" && (item.pathReferences ?? []).some((reference) => reference.path.startsWith("references/")))
      .map((item) => item.id),
  );
  const items = proposed.map((item) => (readers.has(item.id) ? { ...item, bundle: "extensions.references" } : item));
  const built = await build({ kind: "git", ...PINS.extensions }, own.files, items, {
    ...options,
    bundles: [{ id: "extensions.references", layout: "skills/<name>/", include: ["references/*.md"] }],
  });
  return {
    built,
    found,
    mattFound,
    mattDropped,
    files: own.files,
    extraFiles: matt.files.map((file) => ({ ...file, sourceId: "matt" })),
  };
}

// ---------------------------------------------------------------------------------------------
// project-basics (Catalog's own authored rules)

async function projectBasics() {
  const files = authored("project-basics", "project-basics");
  const found = discover(files, "project-basics", "project-basics", ["rules/"]);
  const byPath = fileMap(files);
  const file = (path) => discoveredFile("project-basics", byPath.get(path) ?? fail(`no ${path}`));
  const items = [
    ...found.items,
    { id: "project-basics.rule.shared-block", kind: "rule", files: [file("shared-block.md")] },
    { id: "project-basics.document.rule-router", kind: "document", purpose: "guide", files: [file("RULE_ROUTER.md")] },
  ];
  const built = await build({ kind: "authored" }, files, items, {
    framework: { id: "project-basics", name: "Project basics" },
  });
  return { built, found, files, extraFiles: [] };
}

// ---------------------------------------------------------------------------------------------
// Dispositions of the measured baseline

const BASELINE = ["ecc", "extensions", "project-basics", "superpowers"];

/** The measured baseline: the earlier release's items, as the committed report records them. */
function baseline() {
  const committed = join(root, "port-report", "maintained.json");
  return JSON.parse(readFileSync(committed, "utf8")).dispositions.map((entry) => entry.baseline);
}

function dispositions(results, items) {
  const ids = new Set(items.map((item) => item.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  const entries = [];
  const mapped = (entry, item, extra = {}) => {
    if (!ids.has(item)) fail(`${entry.id} maps to ${item}, which is not in the content`);
    return { baseline: entry, disposition: "mapped", item, ...extra };
  };
  const dropped = (entry, reason, note) => ({ baseline: entry, disposition: "dropped", reason, note });
  for (const entry of baseline()) {
    const [family, kind, ...rest] = entry.id.split(".");
    const path = rest.join(".");
    let result;
    if (entry.id.endsWith(".notices"))
      result = { baseline: entry, disposition: "notice", note: "the source's licence and notice files are source notices, copied once with any chosen item" };
    else if (entry.id === "extensions.references")
      result = { baseline: entry, disposition: "bundle", bundle: "extensions.references", note: "the checklists skills read at ../../references/ are the runtime bundle placed beside them" };
    else if (entry.id === "ecc.rule.README") result = dropped(entry, "not-an-item", results.ecc.dropped.get(entry.id));
    else if (family === "ecc" && kind === "skill" && path.endsWith(".kiro-variant"))
      result = mapped(entry, entry.variantOf, { edition: "kiro", note: "an upstream Kiro copy is the item's Kiro edition, not a second item" });
    else if (kind === "command") {
      const skill = `${family}.skill.${path}`;
      const shadow = results[family].found.leftOver.find((left) => left.path === `commands/${path}.md` && left.reason === "shadowed-by-skill");
      result = shadow
        ? dropped(entry, "command-shadowed-by-skill", `a skill of the same name exists (${skill}); the skill wins`)
        : mapped(entry, skill, { note: "a command becomes a user-only skill" });
    } else if (family === "ecc" && kind === "steering") result = mapped(entry, `ecc.rule.steering.${path}`, { edition: "kiro" });
    else if (family === "ecc" && kind === "mcp") {
      if (entry.variantOf) result = dropped(entry, "catalog-variant", `a variant the previous Catalog release made of ${entry.variantOf}; content keeps only the upstream entry`);
      else if (results.ecc.mcpDropped.has(path)) result = dropped(entry, "mcp-not-representable", results.ecc.mcpDropped.get(path));
      else result = mapped(entry, `ecc.mcp.${path}`, { note: "cut out of mcp-configs/mcp-servers.json as its own server.json" });
    } else if (family === "extensions" && kind === "matt") {
      const source = entry.paths.find((sourcePath) => sourcePath.endsWith("/SKILL.md"));
      const category = source?.split("/")[1];
      result = mapped(entry, `extensions.skill.${category}.${path}`);
    } else if (family === "project-basics") {
      const map = {
        "project-basics.router": "project-basics.document.rule-router",
        "project-basics.shared-block": "project-basics.rule.shared-block",
        "project-basics.working-rules": "project-basics.rule.agent-behavior-core",
      };
      result = mapped(entry, map[entry.id]);
    } else result = mapped(entry, entry.id);
    if (result.disposition === "mapped" && byId.get(result.item)?.fetch === "upstream") result.fetch = "upstream";
    entries.push(result);
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------

function writeOrCompare(path, bytes) {
  const target = join(root, path);
  if (check) {
    if (!existsSync(target) || !Buffer.from(readFileSync(target)).equals(Buffer.from(bytes))) out.drift.push(path);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  out.written.push(path);
}

function listFiles(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

const canonical = (value) => `${JSON.stringify(sortKeys(value), null, 2)}\n`;
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  return value;
}

const work = mkdtempSync(join(tmpdir(), "aih-catalog-port-"));
try {
  const results = {
    ecc: await ecc(work),
    superpowers: await superpowers(work),
    extensions: await extensions(work),
    "project-basics": await projectBasics(),
  };
  const items = [];
  for (const [family, result] of Object.entries(results)) {
    const { built } = result;
    // Every recorded file checks against the fetched bytes and the committed copies.
    const generatedFiles = built.generated.map((file) => ({
      sourceId: `${family}-generated`,
      path: file.path,
      mode: "100644",
      sha256: file.sha256,
      bytes: file.bytes,
    }));
    const checked = await checkContent(built.content, [...result.files, ...result.extraFiles, ...generatedFiles]);
    if (checked.status !== "ok") fail(`checkContent ${family}: ${JSON.stringify(checked).slice(0, 2000)}`);
    writeOrCompare(`data/${family}/content.json`, built.bytes);
    const generatedFolder = join(root, "data", family, "generated");
    const expected = new Set(built.generated.map((file) => `data/${family}/generated/${file.path}`));
    for (const stale of listFiles(generatedFolder))
      if (!expected.has(stale)) {
        if (check) out.drift.push(stale);
        else rmSync(join(root, stale));
      }
    for (const file of built.generated) writeOrCompare(`data/${family}/generated/${file.path}`, file.bytes);
    items.push(...built.content.items);
  }
  const entries = dispositions(results, items);
  const count = (predicate) => entries.filter(predicate).length;
  const byKind = {};
  for (const entry of entries) byKind[entry.baseline.kind] = (byKind[entry.baseline.kind] ?? 0) + 1;
  const baselineIds = new Set(entries.map((entry) => entry.baseline.id));
  const mappedIds = new Set(entries.flatMap((entry) => (entry.disposition === "mapped" ? [entry.item] : [])));
  const added = items
    .filter((item) => !mappedIds.has(item.id))
    .map((item) => ({ item: item.id, kind: item.kind, ...(item.fetch ? { fetch: item.fetch } : {}) }));
  const report = {
    families: BASELINE,
    baseline: {
      release: "urn:aihq:catalog:release:1.7.0",
      items: entries.length,
      byKind,
    },
    counts: {
      mapped: count((entry) => entry.disposition === "mapped" && !entry.edition),
      edition: count((entry) => entry.disposition === "mapped" && entry.edition !== undefined && !entry.baseline.id.startsWith("ecc.steering.")),
      steering: count((entry) => entry.baseline.id.startsWith("ecc.steering.")),
      notice: count((entry) => entry.disposition === "notice"),
      bundle: count((entry) => entry.disposition === "bundle"),
      dropped: count((entry) => entry.disposition === "dropped"),
      newItems: added.length,
      contentItems: items.length,
    },
    pins: Object.fromEntries(Object.entries(PINS).map(([name, pin]) => [name, pin])),
    dispositions: entries.sort((left, right) => (left.baseline.id < right.baseline.id ? -1 : 1)),
    added,
    notPorted: NOT_PORTED,
    upstreamOnlyLicence: UPSTREAM_ONLY_LICENCE,
  };
  if (baselineIds.size !== entries.length) fail("a baseline id has two dispositions");
  writeOrCompare("port-report/maintained.json", encoder.encode(canonical(report)));
  if (check) {
    if (out.drift.length > 0) fail(`drift in ${out.drift.join(", ")}`);
    console.log(`port-maintained: data and report match (${entries.length} baseline items, ${items.length} content items)`);
  } else console.log(`port-maintained: wrote ${out.written.length} files (${entries.length} baseline items, ${items.length} content items)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
