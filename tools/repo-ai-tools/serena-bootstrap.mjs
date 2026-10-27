// Catalog-authored orchestration only. Serena is separately acquired, never bundled.
export const serenaCandidate = {
  package: "serena-agent==2.1.0",
  python: "3.13.18",
  mcp: "2.2.0",
  wheelSha256: "cc6ae542c39b4de5d98cdf35a4ceb0b551f316c5f22e9d0f0b0c5f35d6b95d87",
  source: "https://github.com/oraios/serena/releases/tag/v2.1.0",
  licence: "GPL-3.0-or-later (Serena); MIT (SolidLSP)",
  distribution: "separately acquired; no product code bundled",
  securityOverrides: ["python-multipart==0.0.32", "starlette==1.3.1"],
  agentInterface: "tools",
  singleProject: true,
};

export const serenaTools = [
  "get_symbols_overview",
  "find_symbol",
  "find_referencing_symbols",
  "find_implementations",
  "get_diagnostics_for_file",
];

export const serenaBlockers = [
  { code: "python-artifact", detail: "Exact Python 3.13.18 distribution is unqualified; selected uv 0.13.5 inventory has no candidate. No substitution or compilation." },
  { code: "proxy-tools", detail: "proxy-tools==0.1.0 is source-only; audited bounded artifact or upstream correction required. No automatic build." },
  { code: "multipart-override", detail: "Upstream python-multipart==0.0.31 conflicts with retained 0.0.32 override; compatibility/source disposition required, including retained Starlette 1.3.1." },
  { code: "dependency-closure", detail: "Full isolated Python 3.13.18/MCP 2.2.0 artifact closure is unqualified." },
  { code: "language-server", detail: "Explicit backend/runtime/artifact acquisition and offline query proof required before launch; no first-query download." },
  { code: "native-qualification", detail: "Initial session, symbols/references/diagnostics, untrusted TypeScript and outside-root/symlink refusal remain unqualified." },
];

export function serenaPreparation(repoRoot) {
  return {
    selected: ["serena"],
    ready: false,
    mutations: [],
    candidate: serenaCandidate,
    blockers: serenaBlockers,
    context: [
      "description: Single-project read-only symbol interface",
      "fixed_tools:",
      ...serenaTools.map((tool) => `  - ${tool}`),
      "single_project: true",
      "",
    ].join("\n"),
    configuration: "agent_interface: tools\ngui_log_window: false\nweb_dashboard: false\nweb_dashboard_open_on_launch: false\ntrusted_project_path_patterns: []\n",
    projectConfiguration: "read_only: true\n",
    environment: { SERENA_USAGE_REPORTING: "false" },
    // Inspection only. No command in this preparation executes these arguments.
    launchArguments: ["start-mcp-server", "--transport", "stdio", "--agent-interface", "tools", "--project", repoRoot, "--context", "<qualified-context-file>", "--mode", "no-memories", "--enable-web-dashboard=false", "--open-web-dashboard=false", "--enable-gui-log-window=false"],
    languageServerAcquisition: {
      automatic: false,
      command: ["download-ls-dependencies", "<explicit-qualified-backend>"],
      standardTypeScript: { typescript: "5.9.3", languageServer: "5.1.3", status: "unqualified" },
    },
    session: "Use the session from initial instructions; pass session on affected 2.1 tools. activate_project is intentionally absent in single-project mode.",
    platforms: Object.fromEntries(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64", "win32-arm64", "wsl2-x64"].map((cell) => [cell, { status: "blocked", native: "unverified" }])),
  };
}

export function refuseSerenaActivation() {
  throw new Error(`Serena activation blocked: ${serenaBlockers.map(({ code }) => code).join(", ")}. Use setup-codex --tool serena --dry-run for preparation; existing installations are untouched.`);
}

// Deliberately conservative: no TOML rewriting, and ambiguous ownership refuses.
function keyParts(text) {
  const parts = [];
  let rest = text.trim();
  while (rest) {
    const match = /^("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)/.exec(rest);
    if (!match) throw new Error("ambiguous Codex key ownership");
    const key = match[0];
    parts.push(key.startsWith('"') ? JSON.parse(key) : key.startsWith("'") ? key.slice(1, -1) : key);
    rest = rest.slice(key.length).trimStart();
    if (!rest) break;
    if (!rest.startsWith(".")) throw new Error("ambiguous Codex key ownership");
    rest = rest.slice(1).trimStart();
    if (!rest) throw new Error("ambiguous Codex key ownership");
  }
  return parts;
}

export function serenaProjection(repoRoot, scriptPath, existing) {
  if (/^# (?:BEGIN|END) (?:AIH-SUPPORTED REPO TOOLING|REPO HELPER serena)/m.test(existing))
    throw new Error("legacy or existing Serena block ownership; reconcile manually");
  let table = [];
  for (const line of existing.split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (line.includes('"""') || line.includes("'''")) throw new Error("ambiguous multiline Codex ownership");
    const header = /^\s*\[(.*)\]\s*(?:#.*)?$/.exec(line);
    let keys;
    if (header) {
      table = keyParts(header[1]);
      keys = table;
    } else {
      const assignment = /^\s*([^=]+)=/.exec(line);
      if (!assignment) throw new Error("ambiguous Codex ownership");
      keys = [...table, ...keyParts(assignment[1])];
    }
    if (keys[0] === "mcp_servers" && (keys.length === 1 || keys[1] === "serena"))
      throw new Error("Codex Serena server ownership collision");
  }
  return [
    "# BEGIN REPO HELPER serena",
    "# Preparation only: launcher refuses until exact closure and native qualification.",
    '[mcp_servers."serena"]',
    'command = "node"',
    `args = ${JSON.stringify([scriptPath, "serena-mcp"])}`,
    `cwd = ${JSON.stringify(repoRoot)}`,
    `enabled_tools = ${JSON.stringify(serenaTools)}`,
    "startup_timeout_sec = 60",
    '[mcp_servers."serena".env]',
    'SERENA_USAGE_REPORTING = "false"',
    "# END REPO HELPER serena",
    "",
  ].join("\n");
}
