import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pins = {
  serena: {
    package: "serena-agent==1.7.0",
    securityOverrides: ["python-multipart==0.0.32", "starlette==1.3.1"],
  },
  tokenSavior: { package: "token-savior-recall[mcp]==4.21.0" },
  codeReviewGraph: { package: "code-review-graph==2.3.9", python: "3.14.10", wheelSha256: "908500a23f23fe05566090a2e5fce95f7f177d054090a355b46367546db5d910" },
  codebaseMemory: { version: "0.12.1", distribution: "native", artifacts: {
    "linux-x64": {
      url: "https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.12.1/codebase-memory-mcp-linux-amd64-portable.tar.gz",
      archiveSha256: "8c3d0341064301e78ecc84cf7348d4e2c6562a0f57448243ea560aaa34de36c1",
      executableSha256: "77745491f0a9c346d6da23eed4d92b5feaa31a27a883c9faa4fa9f47c8183705",
      qualification: "pending isolated-account fixture",
    },
  } },
  tokenOptimizer: {
    tag: "v5.11.68",
    commit: "ffe3b8007542260b17648a2d9228c3dedda380ad",
    tree: "d044ba6038ac705e8d0da6a4b545cbee00abe7d5",
    source: "https://github.com/alexgreensh/token-optimizer",
  },
};

const serenaEnabledTools = [
  "get_symbols_overview",
  "find_symbol",
  "find_referencing_symbols",
  "find_implementations",
  "get_diagnostics_for_file",
  "search_for_pattern",
  "rename_symbol",
  "replace_symbol_body",
  "insert_before_symbol",
  "insert_after_symbol",
];
const serenaExcludedTools = [
  "create_text_file",
  "read_file",
  "execute_shell_command",
  "replace_content",
  "replace_in_files",
  "find_file",
  "list_dir",
];
const tokenSaviorEnabledTools = [
  "get_entry_points",
  "search_codebase",
  "find_symbol",
  "get_call_chain",
  "get_function_source",
  "get_full_context",
];
const codeReviewGraphEnabledTools = [
  "get_impact_radius_tool",
  "get_affected_flows_tool",
  "get_review_context_tool",
  "detect_changes_tool",
  "list_graph_stats_tool",
  "get_architecture_overview_tool",
];
const codebaseMemoryEnabledTools = [
  "index_repository",
  "search_graph",
  "query_graph",
  "trace_path",
  "get_code_snippet",
  "get_graph_schema",
  "get_architecture",
  "search_code",
  "list_projects",
  "index_status",
  "detect_changes",
  "manage_adr",
  "check_index_coverage",
];

const cacheGeneration = createHash("sha256").update(JSON.stringify(pins)).digest("hex").slice(0, 16);
// Preserve unrelated helper locations when only the graph/memory pins change.
const legacyPins = { ...pins, codeReviewGraph: { package: "code-review-graph==2.3.7" }, codebaseMemory: { package: "codebase-memory-mcp==0.10.5" } };
const legacyGeneration = createHash("sha256").update(JSON.stringify(legacyPins)).digest("hex").slice(0, 16);
const repoKey = createHash("sha256").update(`${repoRoot}\0${legacyGeneration}`).digest("hex").slice(0, 16);
const cacheRoot =
  process.env.AIH_SUPPORTED_REPO_AI_TOOLS_HOME ||
  (process.platform === "win32"
    ? join(process.env.LOCALAPPDATA || homedir(), "aih-supported-cache")
    : join(homedir(), ".cache", "aih-supported"));
const installRoot = join(cacheRoot, "repo-ai-tools", repoKey);
const uvToolRoot = join(installRoot, "uv");
const binRoot = join(installRoot, "bin");
const tokenOptimizerRoot = join(installRoot, "token-optimizer", pins.tokenOptimizer.tag);
const codeReviewGraphRoot = join(installRoot, "code-review-graph-2.3.9");
const defaultCodebaseMemoryRoot = resolve(homedir(), ".cache", "codebase-memory-mcp");
const codebaseMemoryProject = { name: `catalog-${createHash("sha256").update(repoRoot).digest("hex").slice(0, 16)}`, rootPath: repoRoot };

const serenaOverridesPath = join(installRoot, "serena-security-overrides.txt");
const serenaContextPath = join(installRoot, "serena-codex-context.yml");
const codexConfigPath = join(repoRoot, ".codex", "config.toml");
const scriptPath = fileURLToPath(import.meta.url);
const blockBegin = "# BEGIN AIH-SUPPORTED REPO TOOLING (managed by npm run repo:init)";
const blockEnd = "# END AIH-SUPPORTED REPO TOOLING";

const mcpServers = [
  ["serena", "serena-mcp", serenaEnabledTools, 60],
  ["token-savior", "token-savior-mcp", tokenSaviorEnabledTools, 45],
  ["code-review-graph", "code-review-graph-mcp", codeReviewGraphEnabledTools, 60],
  ["codebase-memory-mcp", "codebase-memory-mcp", codebaseMemoryEnabledTools, 90],
];

const plan = {
  pins,
  cache: { generation: cacheGeneration, keyInputs: ["repository-path", "tool-pins"] },
  installRoot: "project-and-toolset-keyed user cache",
  runtime: {
    serena: { context: "repo-symbols", mode: "no-memories", singleProject: true, excludedTools: serenaExcludedTools, enabledTools: serenaEnabledTools },
    tokenSavior: { profile: "optimized", memory: false, shellHooks: false, excludePatterns: [".token-savior-cache.json"], enabledTools: tokenSaviorEnabledTools },
    tokenOptimizer: { integration: "on-demand", commands: ["report", "coach"], clients: ["claude", "codex"] },
    codeReviewGraph: { role: "broad-impact-review", advisory: true, enabledTools: codeReviewGraphEnabledTools },
    codebaseMemory: { role: "find-trace-recall", advisory: true, cache: "canonical-per-account", settings: { auto_index: false, auto_watch: false, watcher_enabled: false, ui_enabled: false }, freshness: "native qualification pending", enabledTools: codebaseMemoryEnabledTools },
  },
  bootstrap: {
    codex: {
      setupCommand: "setup-codex",
      doctorCommand: "doctor-codex",
      projection: ".codex/config.toml",
      tokenOptimizer: { integration: "on-demand", commands: ["token-optimizer-report", "token-optimizer-coach"] },
      mcpServers: Object.fromEntries(mcpServers.map(([name, launcher, tools]) => [name, { launcher, enabledTools: tools }])),
    },
  },
};

function fail(error) {
  process.stderr.write(`[repo-ai-tools] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  return (result.stdout || "").trim();
}

function probe(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
    ...options,
  });
  return { ok: result.error === undefined && result.status === 0, stdout: (result.stdout || "").trim() };
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`required command unavailable: ${command}`);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function isInside(parent, child) {
  const delta = relative(parent, child);
  return delta !== "" && !delta.startsWith("..") && !isAbsolute(delta);
}

export function resolveCodebaseMemoryCacheDir(override = process.env.CBM_CACHE_DIR) {
  if (override === undefined) override = defaultCodebaseMemoryRoot;
  if (typeof override !== "string" || !override.trim() || override.includes("\0") || !isAbsolute(override))
    throw new Error("CBM_CACHE_DIR must be a nonempty absolute path");
  const resolved = resolve(override);
  const canonical = canonicalPath(resolved);
  if (canonical === parse(canonical).root || canonical === canonicalPath(repoRoot) || isInside(canonicalPath(repoRoot), canonical))
    throw new Error("CBM_CACHE_DIR must be outside the repository and filesystem root");
  return canonical;
}

function canonicalPath(path) {
  if (existsSync(path)) return realpathSync(path);
  return join(canonicalPath(dirname(path)), path.slice(dirname(path).length + 1));
}

function codebaseMemoryConfiguration(override = process.env.CBM_CACHE_DIR) {
  const cacheDir = resolveCodebaseMemoryCacheDir(override);
  return { cacheDir, allowedRoot: repoRoot, project: codebaseMemoryProject };
}

function codebaseMemoryEnvironment(override = process.env.CBM_CACHE_DIR) {
  const configuration = codebaseMemoryConfiguration(override);
  return { CBM_CACHE_DIR: configuration.cacheDir, CBM_ALLOWED_ROOT: configuration.allowedRoot, CBM_LOG_LEVEL: "warn", CBM_DIAGNOSTICS: "false" };
}

function codebaseMemoryCommands() {
  return {
    index: ["cli", "index_repository", "--repo-path", codebaseMemoryProject.rootPath, "--name", codebaseMemoryProject.name, "--mode", "moderate"],
    list: ["cli", "list_projects", "--format", "json"],
    status: ["cli", "index_status", "--project", codebaseMemoryProject.name, "--format", "json", "--diagnostics", "summary"],
    search: ["cli", "search_code", "--project", codebaseMemoryProject.name, "--pattern", "export", "--file-pattern", "index.ts", "--mode", "files", "--limit", "1", "--format", "json"],
  };
}

export function inspectCodebaseMemoryBootstrap(override = process.env.CBM_CACHE_DIR) {
  const configuration = codebaseMemoryConfiguration(override);
  return {
    ...configuration,
    environment: codebaseMemoryEnvironment(override),
    projection: renderCodexConfig(override),
    commands: codebaseMemoryCommands(),
  };
}

function localToolEnv() {
  return { ...process.env, UV_CACHE_DIR: join(installRoot, "uv-cache"), UV_TOOL_DIR: uvToolRoot, UV_TOOL_BIN_DIR: binRoot };
}

function executable(name) {
  return join(binRoot, `${name}${process.platform === "win32" ? ".exe" : ""}`);
}

function toolPython(name) {
  return process.platform === "win32" ? join(uvToolRoot, name, "Scripts", "python.exe") : join(uvToolRoot, name, "bin", "python");
}

function installUvTool(packageSpec, listEntry, options = {}) {
  const installed = run("uv", ["tool", "list"], { env: localToolEnv() });
  if (!options.force && installed.includes(listEntry)) return;
  const args = ["tool", "install"];
  if (options.force) args.push("--force");
  args.push("--python", "3.13", "--no-python-downloads");
  if (options.overrides) args.push("--overrides", options.overrides);
  args.push(packageSpec);
  run("uv", args, { env: localToolEnv() });
}

function verifyTokenOptimizer() {
  const commit = run("git", ["-C", tokenOptimizerRoot, "rev-parse", "HEAD"]);
  const tree = run("git", ["-C", tokenOptimizerRoot, "rev-parse", "HEAD^{tree}"]);
  if (commit !== pins.tokenOptimizer.commit || tree !== pins.tokenOptimizer.tree)
    throw new Error("token-optimizer checkout does not match the accepted commit and tree");
}

function writeSerenaContext() {
  mkdirSync(dirname(serenaContextPath), { recursive: true });
  writeFileSync(serenaContextPath, [
    "description: aih-supported single-project symbolic lane for Codex",
    "excluded_tools:",
    ...serenaExcludedTools.map((tool) => `  - ${tool}`),
    "included_optional_tools: []",
    "single_project: true",
    "",
  ].join("\n"), "utf8");
}

function graphPython() {
  return process.platform === "win32" ? join(installRoot, "crg-2.3.9", "Scripts", "python.exe") : join(installRoot, "crg-2.3.9", "bin", "python");
}

function installGraph() {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("CRG Python 3.14 closure is unqualified for this platform");
  commandExists("uv");
  // An explicit pre-existing interpreter is required; no host interpreter acquisition.
  const python = process.env.AIH_REPO_CRG_PYTHON;
  if (!python || !isAbsolute(python) || run(python, ["-c", "import platform; print(platform.python_version())"]) !== pins.codeReviewGraph.python)
    throw new Error("provide AIH_REPO_CRG_PYTHON naming the separately qualified Python 3.14.10 interpreter");
  const env = { ...localToolEnv(), UV_CACHE_DIR: join(installRoot, "uv-cache") };
  run("uv", ["venv", "--python", python, "--no-python-downloads", join(installRoot, "crg-2.3.9")], { env });
  run("uv", ["pip", "sync", "--python", graphPython(), "--require-hashes", "--only-binary", ":all:", "--no-python-downloads", join(repoRoot, "tools", "repo-ai-tools", "crg-linux-x64-py314.lock")], { env });
}

function hashFile(path) {
  const descriptor = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let size;
    while ((size = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
    return hash.digest("hex");
  } finally { closeSync(descriptor); }
}

function memoryExecutable() {
  const artifact = pins.codebaseMemory.artifacts[`${process.platform}-${process.arch}`];
  if (!artifact) throw new Error("native CBM artifact is unqualified for this platform");
  const path = process.env.AIH_REPO_CBM_EXECUTABLE;
  if (!path || !isAbsolute(path) || !existsSync(path)) throw new Error("provide AIH_REPO_CBM_EXECUTABLE from the verified native archive; no wrapper/installer is used");
  if (hashFile(path) !== artifact.executableSha256)
    throw new Error("CBM executable differs from the exact selected native build");
  return realpathSync(path);
}

function verifyMemorySettings() {
  const command = memoryExecutable();
  // 0.12.1 may retire an older permanent daemon during normal CLI bootstrap.
  // Its status text exposes only a shortened fingerprint, so fail closed for
  // every active/unknown daemon rather than treating a version match as a build match.
  const daemon = probe(command, ["daemon", "status"], { env: codebaseMemoryEnv() });
  if (daemon.ok || !daemon.stdout.startsWith("daemon: not running\n"))
    throw new Error("CBM account is active or ambiguous; coordinate with the owning session, never replace its daemon");
  for (const key of ["auto_index", "auto_watch", "watcher_enabled", "ui_enabled"]) {
    if (run(command, ["config", "get", key], { env: codebaseMemoryEnv() }) !== "false")
      throw new Error(`CBM ${key} must already be false in the canonical account cache; coordinate configuration before starting a daemon`);
  }
}

function installTools(selected) {
  mkdirSync(binRoot, { recursive: true });
  for (const name of selected) {
    if (name === "token-optimizer") {
      if (!existsSync(tokenOptimizerRoot)) {
        mkdirSync(dirname(tokenOptimizerRoot), { recursive: true });
        run("git", ["clone", "--depth", "1", "--branch", pins.tokenOptimizer.tag, pins.tokenOptimizer.source, tokenOptimizerRoot]);
      }
      verifyTokenOptimizer();
    }
    else if (name === "code-review-graph") installGraph();
    else if (name === "codebase-memory-mcp") verifyMemorySettings();
    else if (name === "token-savior") installUvTool(pins.tokenSavior.package, "token-savior-recall v4.21.0");
    else if (name === "serena") {
      writeFileSync(serenaOverridesPath, `${pins.serena.securityOverrides.join("\n")}\n`, "utf8");
      installUvTool(pins.serena.package, "serena-agent v1.7.0", { force: true, overrides: serenaOverridesPath });
      writeSerenaContext();
    }
  }
}

function renderCodexConfig(override = process.env.CBM_CACHE_DIR, selected = mcpServers.map(([name]) => name)) {
  const memory = selected.includes("codebase-memory-mcp") ? codebaseMemoryConfiguration(override) : undefined;
  const lines = [blockBegin, "# Machine-local optional helper projection; AGENTS.md owns project instructions.", ""];
  for (const [name, launcher, enabledTools, startupTimeout] of mcpServers.filter(([name]) => selected.includes(name))) {
    lines.push(`[mcp_servers.${JSON.stringify(name)}]`, `command = ${JSON.stringify("node")}`, `args = ${JSON.stringify([scriptPath, launcher])}`, `cwd = ${JSON.stringify(repoRoot)}`, `enabled_tools = ${JSON.stringify(enabledTools)}`, `startup_timeout_sec = ${startupTimeout}`, "");
    if (name === "codebase-memory-mcp") lines.push(`[mcp_servers.${JSON.stringify(name)}.env]`, `CBM_CACHE_DIR = ${JSON.stringify(memory.cacheDir)}`, `CBM_ALLOWED_ROOT = ${JSON.stringify(memory.allowedRoot)}`, 'CBM_LOG_LEVEL = "warn"', 'CBM_DIAGNOSTICS = "false"', `AIH_REPO_CBM_EXECUTABLE = ${JSON.stringify(process.env.AIH_REPO_CBM_EXECUTABLE || "")}`,  "");
  }
  lines.push(blockEnd, "");
  return lines.join("\n");
}

function tomlKeys(text) {
  const keys = [];
  let remaining = text.trim();
  while (remaining) {
    const match = /^("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)/.exec(remaining);
    if (!match) throw new Error("ambiguous TOML key; reconcile Codex projection manually");
    const key = match[0];
    keys.push(key.startsWith('"') ? JSON.parse(key) : key.startsWith("'") ? key.slice(1, -1) : key);
    remaining = remaining.slice(key.length).trimStart();
    if (!remaining) break;
    if (!remaining.startsWith(".")) throw new Error("ambiguous TOML key; reconcile Codex projection manually");
    remaining = remaining.slice(1).trimStart();
    if (!remaining) throw new Error("ambiguous TOML key; reconcile Codex projection manually");
  }
  return keys;
}

function assertNoServerCollision(text, name) {
  for (const line of text.split(/\r?\n/)) {
    const header = line.trimStart().startsWith("[[")
      ? /^\s*\[\[(.*)\]\]\s*(?:#.*)?$/.exec(line)
      : /^\s*\[(.*)\]\s*(?:#.*)?$/.exec(line);
    // Parent tables and root inline/dotted assignments can also own a server.
    const assignment = /^\s*([^#=]+)=/.exec(line);
    const keys = header ? tomlKeys(header[1]) : assignment ? tomlKeys(assignment[1]) : [];
    if (keys[0] === "mcp_servers" && (keys.length === 1 || keys[1] === name))
      throw new Error(`existing Codex config already owns managed server: ${name}`);
  }
}

function projectionUpdate(existing, selected) {
  let result = existing;
  if (existing.includes(blockBegin) || existing.includes(blockEnd))
    throw new Error("legacy shared projection exists; review/remove it manually before selecting helpers");
  for (const name of selected.filter((entry) => entry !== "token-optimizer")) {
    const begin = `# BEGIN REPO HELPER ${name}`;
    const end = `# END REPO HELPER ${name}`;
    const start = result.indexOf(begin);
    const stop = result.indexOf(end);
    const rendered = renderCodexConfig(undefined, [name]).replace(blockBegin, begin).replace(blockEnd, end);
    if (start >= 0 && stop >= start) {
      if (result.indexOf(begin, start + begin.length) >= 0 || result.indexOf(end, stop + end.length) >= 0)
        throw new Error(`duplicate managed projection: ${name}`);
      assertNoServerCollision(result.slice(0, start) + result.slice(stop + end.length), name);
      result = result.slice(0, start) + rendered.trimEnd() + result.slice(stop + end.length);
    } else {
      if (start >= 0 || stop >= 0) throw new Error(`malformed managed projection: ${name}`);
      assertNoServerCollision(result, name);
      result = `${result.trimEnd()}\n\n${rendered}`;
    }
  }
  return result;
}

function writeCodexProjection(selected) {
  const existing = existsSync(codexConfigPath) ? readFileSync(codexConfigPath, "utf8") : "";
  const updated = projectionUpdate(existing, selected);
  mkdirSync(dirname(codexConfigPath), { recursive: true });
  writeFileSync(codexConfigPath, updated, "utf8");
}

function codeReviewGraphEnv() {
  return { ...localToolEnv(), CRG_DATA_DIR: codeReviewGraphRoot };
}

function codebaseMemoryEnv() {
  return { ...localToolEnv(), ...codebaseMemoryEnvironment() };
}


export function findCodebaseMemoryProject(projects) {
  if (!Array.isArray(projects)) throw new Error("codebase-memory project inventory is not an array");
  const named = projects.filter((entry) => entry !== null && typeof entry === "object" && entry.name === codebaseMemoryProject.name);
  if (named.length !== 1) throw new Error("codebase-memory-mcp is missing an unambiguous repository project");
  const project = named[0];
  if (project === undefined || typeof project.root_path !== "string" || resolve(project.root_path) !== codebaseMemoryProject.rootPath)
    throw new Error("codebase-memory-mcp repository project root does not match this repository");
  return project;
}

export function assertCodebaseMemoryScopedResponse(response, label) {
  if (response === null || typeof response !== "object" || response.project !== codebaseMemoryProject.name || typeof response.root_path !== "string" || resolve(response.root_path) !== codebaseMemoryProject.rootPath)
    throw new Error(`codebase-memory ${label} response does not identify the selected project at this repository root`);
}

export function assertCodebaseMemorySearchResponse(response) {
  if (response === null || typeof response !== "object") throw new Error("codebase-memory search response is not an object");
  const files = response.files;
  if (!Array.isArray(files) || files.some((path) => typeof path !== "string"))
    throw new Error("codebase-memory search response is malformed");
  for (const path of files) {
    const resolved = canonicalPath(resolve(repoRoot, path));
    if (resolved !== canonicalPath(repoRoot) && !isInside(canonicalPath(repoRoot), resolved))
      throw new Error("codebase-memory search response contains a path outside this repository root");
  }
}

function codebaseMemoryStatus() {
  const commands = codebaseMemoryCommands();
  const status = parseJson(run(memoryExecutable(), commands.status, { env: codebaseMemoryEnv() }), "codebase-memory status");
  assertCodebaseMemoryScopedResponse(status, "status");
  if (status.status !== "ready") throw new Error("CBM native index status is not ready");
  if (status.watch?.watched !== false || status.watch?.reason !== "watcher_disabled")
    throw new Error("CBM effective daemon watcher is not proven disabled; coordinate with its owner, never stop it here");
  return { project: status.project, native: status, freshness: "unverified", qualification: "pending isolated-account manual query/hash fixture" };
}

function launch(name, args, env) {
  const command = executable(name);
  if (!existsSync(command)) throw new Error(`missing ${name}; run npm run repo:init`);
  const child = spawn(command, args, { cwd: repoRoot, env, stdio: "inherit", windowsHide: true });
  child.on("error", fail);
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}

function verifySelectedProjection(selected) {
  if (selected.every((name) => name === "token-optimizer")) return;
  if (!existsSync(codexConfigPath)) throw new Error("selected Codex projection is missing");
  const existing = readFileSync(codexConfigPath, "utf8");
  if (projectionUpdate(existing, selected) !== existing) throw new Error("selected Codex projection differs from the pinned plan");
}

function verifyOtherHelper(name) {
  if (name === "token-optimizer") {
    verifyTokenOptimizer();
    return { configuration: "verified", freshness: "not-applicable", integration: "on-demand" };
  }
  const expected = name === "serena" ? "serena-agent v1.7.0" : "token-savior-recall v4.21.0";
  const installed = run("uv", ["tool", "list"], { env: localToolEnv() });
  if (!installed.split(/\r?\n/).includes(expected) || !existsSync(executable(name)))
    throw new Error(`missing selected pinned helper: ${expected}`);
  if (name === "serena") {
    const overrides = run(toolPython("serena-agent"), ["-c", "import importlib.metadata as m; print('|'.join(m.version(n) for n in ('python-multipart','starlette')))"]);
    if (overrides !== "0.0.32|1.3.1") throw new Error(`Serena security override mismatch: ${overrides}`);
  }
  return { configuration: "verified", freshness: "not-applicable" };
}

function doctor() {
  const selected = selectedTools();
  verifySelectedProjection(selected);
  const statuses = {};
  for (const name of selected) {
    if (name === "code-review-graph") statuses[name] = graphStatus();
    else if (name === "codebase-memory-mcp") {
      verifyMemorySettings();
      statuses[name] = codebaseMemoryStatus();
    } else statuses[name] = verifyOtherHelper(name);
  }
  const ok = Object.values(statuses).every((status) => status.freshness === "current" || status.freshness === "not-applicable");
  if (!ok) process.exitCode = 1;
  // Reporting a usable launch projection does not qualify a graph or native session.
  process.stdout.write(`${JSON.stringify({ ok, repository: repoRoot, statuses }, null, 2)}\n`);
}

function graphStatus() {
  return parseJson(run(graphPython(), [join(repoRoot, "tools", "repo-ai-tools", "crg-status.py"), repoRoot, codeReviewGraphRoot], { env: codeReviewGraphEnv() }), "CRG status");
}

function selectedTools() {
  const selected = [];
  const args = process.argv.slice(3);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") continue;
    if (args[i] !== "--tool" || !args[i + 1]) throw new Error("use --tool <server-name> for each selected helper");
    const name = args[++i];
    if (name !== "token-optimizer" && !mcpServers.some(([server]) => server === name)) throw new Error(`unknown helper: ${name}`);
    if (selected.includes(name)) throw new Error(`duplicate helper: ${name}`);
    selected.push(name);
  }
  if (!selected.length) throw new Error("select at least one helper with --tool; setup never selects unrelated tools implicitly");
  return selected;
}

function setup({ dryRun = false } = {}) {
  const selected = selectedTools();
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ command: "setup-codex", dryRun: true, selected, indexing: "manual-only", gitHooks: "unchanged", mutations: ["acquire selected qualified tools", "write selected Codex projection"] }, null, 2)}\n`);
    return;
  }
  projectionUpdate(existsSync(codexConfigPath) ? readFileSync(codexConfigPath, "utf8") : "", selected);
  installTools(selected);
  writeCodexProjection(selected);
}

function runTokenOptimizer(action) {
  const script = join(tokenOptimizerRoot, "skills", "token-optimizer", "scripts", "measure.py");
  if (!existsSync(script)) throw new Error("token-optimizer is missing; run npm run repo:init");
  const python = process.platform === "win32" ? "py" : "python3";
  const args = process.platform === "win32" ? ["-3", script, action] : [script, action];
  run(python, args, { env: { ...process.env, TOKEN_OPTIMIZER_RUNTIME: "codex" } });
}

function main() {
  const command = process.argv[2];
  if (command === "plan") process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else if (command === "setup-codex") setup({ dryRun: process.argv.includes("--dry-run") });
  else if (command === "doctor-codex") doctor();
  else if (command === "projection-codex") process.stdout.write(renderCodexConfig(undefined, selectedTools()));
  else if (command === "serena-mcp") launch("serena", ["start-mcp-server", "--context", serenaContextPath, "--project", repoRoot, "--mode", "no-memories", "--enable-web-dashboard=false", "--enable-gui-log-window=false"], localToolEnv());
  else if (command === "token-savior-mcp") launch("token-savior", [], { ...localToolEnv(), TOKEN_SAVIOR_PROFILE: "optimized", TOKEN_SAVIOR_EXCLUDE_PATTERNS: ".token-savior-cache.json", TS_CAPTURE_DISABLED: "1", TS_MEMORY_DISABLE: "1", WORKSPACE_ROOTS: repoRoot });
  else if (command === "code-review-graph-mcp") {
    const status = graphStatus();
    if (status.freshness !== "current") throw new Error(`CRG freshness is ${status.freshness}; explicit fixture qualification/rebuild required`);
    const child = spawn(graphPython(), ["-c", "from code_review_graph.cli import main; main()", "serve", "--repo", repoRoot, "--tools", codeReviewGraphEnabledTools.join(",")], { cwd: repoRoot, env: codeReviewGraphEnv(), stdio: "inherit", windowsHide: true });
    child.on("error", fail);
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
  }
  else if (command === "codebase-memory-mcp") {
    verifyMemorySettings();
    const status = codebaseMemoryStatus();
    if (status.freshness !== "current") throw new Error("CBM freshness is unverified; account-isolated native qualification required before launch");
    const child = spawn(memoryExecutable(), [], { cwd: repoRoot, env: codebaseMemoryEnv(), stdio: "inherit", windowsHide: true });
    child.on("error", fail);
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
  }
  else if (command === "token-optimizer-report") runTokenOptimizer("report");
  else if (command === "token-optimizer-coach") runTokenOptimizer("coach");
  else throw new Error("usage: repo-ai-tools.mjs <plan|setup-codex|doctor-codex|serena-mcp|token-savior-mcp|codebase-memory-mcp|token-optimizer-report|token-optimizer-coach>");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    fail(error);
  }
}
