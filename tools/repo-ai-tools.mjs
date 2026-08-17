import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pins = {
  ecc: { marketplace: "affaan-m/ECC", plugin: "ecc@ecc", version: "2.2.0" },
  serena: {
    package: "serena-agent==1.7.0",
    securityOverrides: ["python-multipart==0.0.32", "starlette==1.3.1"],
  },
  tokenSavior: { package: "token-savior-recall[mcp]==4.21.0" },
  codeReviewGraph: { package: "code-review-graph==2.3.7" },
  codebaseMemory: { package: "codebase-memory-mcp==0.10.5" },
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
  "build_or_update_graph_tool",
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
const repoKey = createHash("sha256").update(`${repoRoot}\0${cacheGeneration}`).digest("hex").slice(0, 16);
const cacheRoot =
  process.env.AIH_SUPPORTED_REPO_AI_TOOLS_HOME ||
  (process.platform === "win32"
    ? join(process.env.LOCALAPPDATA || homedir(), "aih-supported-cache")
    : join(homedir(), ".cache", "aih-supported"));
const installRoot = join(cacheRoot, "repo-ai-tools", repoKey);
const uvToolRoot = join(installRoot, "uv");
const binRoot = join(installRoot, "bin");
const tokenOptimizerRoot = join(installRoot, "token-optimizer", pins.tokenOptimizer.tag);
const codeReviewGraphRoot = join(installRoot, "code-review-graph");
const defaultCodebaseMemoryRoot = resolve(installRoot, "codebase-memory");
const codebaseMemoryProject = { name: "aih-supported", rootPath: repoRoot };
const codebaseMemoryMarkerName = `.${codebaseMemoryProject.name}-${createHash("sha256").update(repoRoot).digest("hex").slice(0, 16)}.indexed.json`;
const serenaOverridesPath = join(installRoot, "serena-security-overrides.txt");
const serenaContextPath = join(installRoot, "serena-codex-context.yml");
const codexConfigPath = join(repoRoot, ".codex", "config.toml");
const scriptPath = fileURLToPath(import.meta.url);
const codexCommand = process.platform === "win32" ? "codex.cmd" : "codex";
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
    codebaseMemory: { role: "find-trace-recall", advisory: true, enabledTools: codebaseMemoryEnabledTools },
  },
  bootstrap: {
    codex: {
      setupCommand: "setup-codex",
      doctorCommand: "doctor-codex",
      projection: ".codex/config.toml",
      ecc: { marketplace: pins.ecc.marketplace, plugin: pins.ecc.plugin, version: pins.ecc.version, lifecycle: "native-plugin" },
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
  if (override === undefined) return defaultCodebaseMemoryRoot;
  if (typeof override !== "string" || !override.trim() || override.includes("\0") || !isAbsolute(override))
    throw new Error("CBM_CACHE_DIR must be a nonempty absolute path");
  const resolved = resolve(override);
  if (resolved === parse(resolved).root || resolved === repoRoot || isInside(repoRoot, resolved))
    throw new Error("CBM_CACHE_DIR must be outside the repository and filesystem root");
  return resolved;
}

function codebaseMemoryConfiguration(override = process.env.CBM_CACHE_DIR) {
  const cacheDir = resolveCodebaseMemoryCacheDir(override);
  return { cacheDir, markerPath: join(cacheDir, codebaseMemoryMarkerName), allowedRoot: repoRoot, project: codebaseMemoryProject };
}

function codebaseMemoryEnvironment(override = process.env.CBM_CACHE_DIR) {
  const configuration = codebaseMemoryConfiguration(override);
  return { CBM_CACHE_DIR: configuration.cacheDir, CBM_ALLOWED_ROOT: configuration.allowedRoot, CBM_LOG_LEVEL: "warn" };
}

function codebaseMemoryCommands() {
  return {
    index: ["cli", "index_repository", "--repo-path", codebaseMemoryProject.rootPath, "--name", codebaseMemoryProject.name, "--mode", "moderate"],
    list: ["cli", "list_projects"],
    status: ["cli", "index_status", "--project", codebaseMemoryProject.name],
    search: ["cli", "search_code", "--project", codebaseMemoryProject.name, "--pattern", "export", "--file-pattern", "index.ts", "--mode", "files", "--limit", "1"],
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
  return { ...process.env, UV_TOOL_DIR: uvToolRoot, UV_TOOL_BIN_DIR: binRoot };
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

function installTools() {
  mkdirSync(binRoot, { recursive: true });
  installUvTool(pins.tokenSavior.package, "token-savior-recall v4.21.0");
  installUvTool(pins.codeReviewGraph.package, "code-review-graph v2.3.7");
  installUvTool(pins.codebaseMemory.package, "codebase-memory-mcp v0.10.5");
  writeFileSync(serenaOverridesPath, `${pins.serena.securityOverrides.join("\n")}\n`, "utf8");
  installUvTool(pins.serena.package, "serena-agent v1.7.0", { force: true, overrides: serenaOverridesPath });
  writeSerenaContext();
  if (existsSync(tokenOptimizerRoot)) {
    try {
      verifyTokenOptimizer();
    } catch {
      rmSync(tokenOptimizerRoot, { recursive: true, force: true });
    }
  }
  if (!existsSync(tokenOptimizerRoot)) {
    mkdirSync(dirname(tokenOptimizerRoot), { recursive: true });
    run("git", ["clone", "--depth", "1", "--branch", pins.tokenOptimizer.tag, pins.tokenOptimizer.source, tokenOptimizerRoot]);
  }
  verifyTokenOptimizer();
}

function renderCodexConfig(override = process.env.CBM_CACHE_DIR) {
  const memory = codebaseMemoryConfiguration(override);
  const lines = [blockBegin, "# Machine-local projection; ai-coding is authoritative.", ""];
  for (const [name, launcher, enabledTools, startupTimeout] of mcpServers) {
    lines.push(`[mcp_servers.${JSON.stringify(name)}]`, `command = ${JSON.stringify("node")}`, `args = ${JSON.stringify([scriptPath, launcher])}`, `cwd = ${JSON.stringify(repoRoot)}`, `enabled_tools = ${JSON.stringify(enabledTools)}`, `startup_timeout_sec = ${startupTimeout}`, "");
    if (name === "codebase-memory-mcp") lines.push(`[mcp_servers.${JSON.stringify(name)}.env]`, `CBM_CACHE_DIR = ${JSON.stringify(memory.cacheDir)}`, `CBM_ALLOWED_ROOT = ${JSON.stringify(memory.allowedRoot)}`, 'CBM_LOG_LEVEL = "warn"', "");
  }
  lines.push(blockEnd, "");
  return lines.join("\n");
}

function writeCodexProjection() {
  mkdirSync(dirname(codexConfigPath), { recursive: true });
  const expected = renderCodexConfig();
  if (!existsSync(codexConfigPath)) {
    writeFileSync(codexConfigPath, expected, "utf8");
    return;
  }
  const existing = readFileSync(codexConfigPath, "utf8");
  const begin = existing.indexOf(blockBegin);
  const end = existing.indexOf(blockEnd);
  if (begin >= 0 && end >= begin) {
    writeFileSync(codexConfigPath, `${existing.slice(0, begin)}${expected}${existing.slice(end + blockEnd.length)}`, "utf8");
    return;
  }
  if (begin >= 0 || end >= 0) throw new Error("malformed managed Codex projection block");
  for (const [name] of mcpServers)
    if (existing.includes(`[mcp_servers.${name}]`) || existing.includes(`[mcp_servers.${JSON.stringify(name)}]`))
      throw new Error(`existing Codex config already owns managed server: ${name}`);
  writeFileSync(codexConfigPath, `${existing.trimEnd()}\n\n${expected}`, "utf8");
}

function runCodex(args, options = {}) {
  if (process.platform === "win32") {
    if (args.some((arg) => typeof arg !== "string" || /[\u0000\r\n&|<>^]/.test(arg)))
      throw new Error("unsafe native Codex arguments");
    return run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `${codexCommand} ${args.join(" ")}`], options);
  }
  return run(codexCommand, args, options);
}

function verifyCommandEnvironment() {
  for (const command of ["node", "git", "uv", "rg", "fd", "tree"]) commandExists(command);
  runCodex(["--version"]);
}

function configureEcc() {
  const market = parseJson(runCodex(["plugin", "marketplace", "list", "--json"]), "Codex marketplace inventory");
  const marketplaces = Array.isArray(market.marketplaces) ? market.marketplaces : [];
  if (!marketplaces.some((entry) => entry?.name?.toLowerCase?.() === "ecc"))
    runCodex(["plugin", "marketplace", "add", pins.ecc.marketplace, "--json"]);
  const plugins = parseJson(runCodex(["plugin", "list", "--json"]), "Codex plugin inventory");
  const installed = Array.isArray(plugins.installed) ? plugins.installed : [];
  if (!installed.some((entry) => entry?.pluginId === pins.ecc.plugin))
    runCodex(["plugin", "add", pins.ecc.plugin, "--json"]);
}

function codeReviewGraphEnv() {
  return { ...localToolEnv(), CRG_DATA_DIR: codeReviewGraphRoot };
}

function codebaseMemoryEnv() {
  return { ...localToolEnv(), ...codebaseMemoryEnvironment() };
}

function hasPositiveMetric(value) {
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) =>
    (typeof entry === "number" && entry > 0 && /file|node/i.test(key)) || hasPositiveMetric(entry),
  );
}

function graphStatus() {
  const status = probe(executable("code-review-graph"), ["status", "--repo", repoRoot, "--data-dir", codeReviewGraphRoot, "--json"], { env: codeReviewGraphEnv() });
  if (!status.ok) return undefined;
  try {
    return JSON.parse(status.stdout);
  } catch {
    return undefined;
  }
}

function initializeIndexes() {
  mkdirSync(codeReviewGraphRoot, { recursive: true });
  if (!hasPositiveMetric(graphStatus()))
    run(executable("code-review-graph"), ["build", "--repo", repoRoot, "--data-dir", codeReviewGraphRoot, "--quiet"], { env: codeReviewGraphEnv() });
  const memory = codebaseMemoryConfiguration();
  mkdirSync(memory.cacheDir, { recursive: true });
  run(executable("codebase-memory-mcp"), codebaseMemoryCommands().index, { env: codebaseMemoryEnv() });
  writeFileSync(memory.markerPath, `${JSON.stringify({ repository: repoRoot, generation: cacheGeneration })}\n`, "utf8");
}

function verifyTools() {
  const installed = run("uv", ["tool", "list"], { env: localToolEnv() });
  for (const expected of ["serena-agent v1.7.0", "token-savior-recall v4.21.0", "code-review-graph v2.3.7", "codebase-memory-mcp v0.10.5"])
    if (!installed.includes(expected)) throw new Error(`missing repo-local tool: ${expected}`);
  for (const name of ["serena", "token-savior", "code-review-graph", "codebase-memory-mcp"])
    if (!existsSync(executable(name))) throw new Error(`missing repo-local executable: ${name}`);
  const overrides = run(toolPython("serena-agent"), ["-c", "import importlib.metadata as m; print('|'.join(m.version(n) for n in ('python-multipart','starlette')))"]);
  if (overrides !== "0.0.32|1.3.1") throw new Error(`Serena security override mismatch: ${overrides}`);
  verifyTokenOptimizer();
}

function verifyEcc() {
  const plugins = parseJson(runCodex(["plugin", "list", "--json"]), "Codex plugin inventory");
  const installed = Array.isArray(plugins.installed) ? plugins.installed : [];
  const ecc = installed.find((entry) => entry?.pluginId === pins.ecc.plugin);
  if (!ecc?.installed || !ecc?.enabled || ecc.version !== pins.ecc.version)
    throw new Error("ECC 2.2.0 is not installed and enabled in Codex");
  return { pluginId: ecc.pluginId, version: ecc.version };
}

function verifyProjection() {
  if (!existsSync(codexConfigPath) || !readFileSync(codexConfigPath, "utf8").includes(renderCodexConfig()))
    throw new Error("project-local Codex projection differs from the pinned plan");
}

export function findCodebaseMemoryProject(projects) {
  if (!Array.isArray(projects)) throw new Error("codebase-memory project inventory is not an array");
  const named = projects.filter((entry) => entry !== null && typeof entry === "object" && entry.name === codebaseMemoryProject.name);
  if (named.length !== 1) throw new Error("codebase-memory-mcp is missing an unambiguous aih-supported project");
  const project = named[0];
  if (project === undefined || typeof project.root_path !== "string" || resolve(project.root_path) !== codebaseMemoryProject.rootPath)
    throw new Error("codebase-memory-mcp aih-supported project root does not match this repository");
  if (typeof project.nodes !== "number" || project.nodes <= 0 || typeof project.edges !== "number" || project.edges <= 0)
    throw new Error("codebase-memory-mcp aih-supported project is unpopulated");
  return project;
}

export function assertCodebaseMemoryScopedResponse(response, label) {
  if (response === null || typeof response !== "object" || response.project !== codebaseMemoryProject.name || typeof response.root_path !== "string" || resolve(response.root_path) !== codebaseMemoryProject.rootPath)
    throw new Error(`codebase-memory ${label} response does not identify aih-supported at this repository root`);
}

export function assertCodebaseMemorySearchResponse(response) {
  if (response === null || typeof response !== "object") throw new Error("codebase-memory search response is not an object");
  const files = response.files;
  if (!Array.isArray(files) || files.some((path) => typeof path !== "string"))
    throw new Error("codebase-memory search response is malformed");
  for (const path of files) {
    const resolved = resolve(repoRoot, path);
    if (resolved !== repoRoot && !isInside(repoRoot, resolved))
      throw new Error("codebase-memory search response contains a path outside this repository root");
  }
}

function codebaseMemoryStatus() {
  const commands = codebaseMemoryCommands();
  const inventory = parseJson(run(executable("codebase-memory-mcp"), commands.list, { env: codebaseMemoryEnv() }), "codebase-memory inventory");
  const project = findCodebaseMemoryProject(inventory.projects);
  const status = parseJson(run(executable("codebase-memory-mcp"), commands.status, { env: codebaseMemoryEnv() }), "codebase-memory status");
  assertCodebaseMemoryScopedResponse(status, "status");
  const search = parseJson(run(executable("codebase-memory-mcp"), commands.search, { env: codebaseMemoryEnv() }), "codebase-memory search");
  assertCodebaseMemorySearchResponse(search);
  return { nodes: project.nodes, edges: project.edges };
}

function launch(name, args, env) {
  const command = executable(name);
  if (!existsSync(command)) throw new Error(`missing ${name}; run npm run repo:init`);
  const child = spawn(command, args, { cwd: repoRoot, env, stdio: "inherit", windowsHide: true });
  child.on("error", fail);
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}

function doctor() {
  verifyCommandEnvironment();
  verifyTools();
  verifyProjection();
  if (!hasPositiveMetric(graphStatus())) throw new Error("code-review-graph has no populated repository index");
  const memory = codebaseMemoryStatus();
  const ecc = verifyEcc();
  process.stdout.write(`${JSON.stringify({ ok: true, repository: repoRoot, cacheGeneration, projection: ".codex/config.toml", ecc, indexes: { codeReviewGraph: "populated", codebaseMemory: memory }, tokenOptimizer: { integration: "on-demand", pin: { tag: pins.tokenOptimizer.tag, commit: pins.tokenOptimizer.commit, tree: pins.tokenOptimizer.tree } } }, null, 2)}\n`);
}

function setup({ dryRun = false } = {}) {
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ command: "setup-codex", dryRun: true, mutations: ["install pinned repo AI tools", "write ignored Codex project projection", "install or refresh ECC through the native Codex plugin lifecycle", "initialize project-scoped graph and memory indexes", "enable the repository pre-commit hook path"] }, null, 2)}\n`);
    return;
  }
  verifyCommandEnvironment();
  run("git", ["config", "core.hooksPath", ".githooks"]);
  installTools();
  writeCodexProjection();
  configureEcc();
  initializeIndexes();
  doctor();
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
  else if (command === "serena-mcp") launch("serena", ["start-mcp-server", "--context", serenaContextPath, "--project", repoRoot, "--mode", "no-memories", "--enable-web-dashboard=false", "--enable-gui-log-window=false"], localToolEnv());
  else if (command === "token-savior-mcp") launch("token-savior", [], { ...localToolEnv(), TOKEN_SAVIOR_PROFILE: "optimized", TOKEN_SAVIOR_EXCLUDE_PATTERNS: ".token-savior-cache.json", TS_CAPTURE_DISABLED: "1", TS_MEMORY_DISABLE: "1", WORKSPACE_ROOTS: repoRoot });
  else if (command === "code-review-graph-mcp") launch("code-review-graph", ["serve", "--repo", repoRoot, "--tools", codeReviewGraphEnabledTools.join(",")], codeReviewGraphEnv());
  else if (command === "codebase-memory-mcp") launch("codebase-memory-mcp", [], codebaseMemoryEnv());
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
