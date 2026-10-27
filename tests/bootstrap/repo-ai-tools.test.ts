import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function commandJson(...args: string[]): Record<string, unknown> {
  return JSON.parse(
    execFileSync(process.execPath, ["tools/repo-ai-tools.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
    }),
  ) as Record<string, unknown>;
}

type Bootstrap = {
  cacheDir: string;
  markerPath: string;
  allowedRoot: string;
  environment: Record<string, string>;
  project: { name: string; rootPath: string };
  projection: string;
  commands: Record<string, string[]>;
};

type Tools = {
  inspectCodebaseMemoryBootstrap(override?: string): Bootstrap;
  resolveCodebaseMemoryCacheDir(override?: string): string;
  findCodebaseMemoryProject(projects: unknown[]): unknown;
  assertCodebaseMemoryScopedResponse(response: unknown, label: string): void;
  assertCodebaseMemorySearchResponse(response: unknown): void;
};

async function tools(): Promise<Tools> {
  // @ts-expect-error The launcher is intentionally plain ESM JavaScript.
  return (await import("../../tools/repo-ai-tools.mjs")) as Tools;
}

function ignored(path: string): boolean {
  return spawnSync("git", ["check-ignore", "-q", path], { cwd: root }).status === 0;
}

describe("aih-supported repository AI bootstrap", () => {
  it("keeps CI read-only, credential-free, and action-pinned", () => {
    const workflow = readFileSync(join(root, ".github/workflows/verify.yml"), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    expect(workflow).toContain("permissions:\n  contents: read\n");
    expect(workflow).toContain(
      "- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false",
    );
    expect(workflow).toContain("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
    expect(workflow).not.toContain("repo:init");
  });

  it("tracks the local verification hook as executable", () => {
    const stage = execFileSync("git", ["ls-files", "--stage", ".githooks/pre-commit"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(stage).toMatch(/^100755\s/);
  });

  it("plans Serena alone with explicit blockers and no mutations", () => {
    expect(commandJson("setup-codex", "--tool", "serena", "--dry-run")).toMatchObject({
      selected: ["serena"],
      ready: false,
      mutations: [],
      candidate: {
        package: "serena-agent==2.1.0",
        python: "3.13.18",
        mcp: "2.2.0",
        agentInterface: "tools",
        singleProject: true,
      },
    });
  });

  it("refuses selected setup and launch before touching unrelated state or executing repository code", () => {
    const fixture = mkdtempSync(join(tmpdir(), "catalog-serena-"));
    try {
      mkdirSync(join(fixture, "tools"));
      cpSync(join(root, "tools/repo-ai-tools.mjs"), join(fixture, "tools/repo-ai-tools.mjs"));
      cpSync(join(root, "tools/repo-ai-tools"), join(fixture, "tools/repo-ai-tools"), {
        recursive: true,
      });
      const preserved = [
        ".codex/config.toml",
        ".serena/project.yml",
        ".githooks/pre-commit",
        ".code-review-graph/index",
        ".codebase-memory/index",
        "node_modules/typescript/index.js",
      ];
      for (const path of preserved) {
        mkdirSync(resolve(fixture, path, ".."), { recursive: true });
        writeFileSync(
          join(fixture, path),
          path === ".codex/config.toml"
            ? '[mcp_servers.other]\ncommand = "untouched"\n'
            : "untrusted fixture; never execute\n",
        );
      }
      execFileSync("git", ["init", "-q", fixture]);
      execFileSync("git", ["-C", fixture, "add", "--all"]);
      symlinkSync(join(fixture, ".."), join(fixture, "outside"), "dir");
      const before = preserved.map((path) => readFileSync(join(fixture, path), "utf8"));
      for (const args of [
        ["setup-codex", "--tool", "serena"],
        ["serena-mcp"],
        ["doctor-codex", "--tool", "serena"],
      ]) {
        const result = spawnSync(process.execPath, ["tools/repo-ai-tools.mjs", ...args], {
          cwd: fixture,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: "",
            AIH_SUPPORTED_REPO_AI_TOOLS_HOME: join(fixture, "cache"),
          },
          timeout: 5000,
        });
        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toContain("Serena activation blocked:");
        expect(result.stderr).toContain("proxy-tools");
        expect(result.stderr).toContain("multipart-override");
      }
      expect(preserved.map((path) => readFileSync(join(fixture, path), "utf8"))).toEqual(before);
      expect(existsSync(join(fixture, "cache"))).toBe(false);
      expect(readdirSync(join(fixture, ".git", "hooks"))).not.toContain("pre-commit");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("projects only the fixed Serena tools and refuses ambiguous client ownership", () => {
    const fixture = mkdtempSync(join(tmpdir(), "catalog-serena-client-"));
    try {
      mkdirSync(join(fixture, "tools"));
      mkdirSync(join(fixture, ".codex"));
      cpSync(join(root, "tools/repo-ai-tools.mjs"), join(fixture, "tools/repo-ai-tools.mjs"));
      cpSync(join(root, "tools/repo-ai-tools"), join(fixture, "tools/repo-ai-tools"), {
        recursive: true,
      });
      const config = join(fixture, ".codex/config.toml");
      const invoke = () =>
        spawnSync(
          process.execPath,
          ["tools/repo-ai-tools.mjs", "projection-codex", "--tool", "serena"],
          { cwd: fixture, encoding: "utf8", timeout: 5000 },
        );
      const sibling = '[mcp_servers.other]\ncommand = "untouched"\n';
      writeFileSync(config, sibling);
      const result = invoke();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('[mcp_servers."serena"]');
      expect(result.stdout).toContain(
        'enabled_tools = ["get_symbols_overview","find_symbol","find_referencing_symbols","find_implementations","get_diagnostics_for_file"]',
      );
      expect(result.stdout).not.toMatch(
        /serena_repl|activate_project|execute_shell_command|replace_symbol_body|rename_symbol/,
      );
      expect(readFileSync(config, "utf8")).toBe(sibling);
      for (const collision of [
        '[mcp_servers.serena]\ncommand = "other"',
        "[mcp_servers.'serena'.env]\nX = 'other'",
        '["mcp_servers"."serena"]\ncommand = "other"',
        '[mcp_servers."s\\u0065rena"]\ncommand = "other"',
        '[mcp_servers]\nserena = {command = "other"}',
        'mcp_servers.serena.command = "other"',
        'mcp_servers = {serena = {command = "other"}}',
        "# BEGIN AIH-SUPPORTED REPO TOOLING (managed by npm run repo:init)",
      ]) {
        writeFileSync(config, collision);
        const refused = invoke();
        expect(refused.status, collision).toBe(1);
        expect(refused.stderr, collision).toMatch(/collision|ownership|legacy/i);
        expect(readFileSync(config, "utf8")).toBe(collision);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("pins the narrow public helper toolchain", () => {
    expect(commandJson("plan")).toMatchObject({
      pins: {
        serena: {
          package: "serena-agent==2.1.0",
          securityOverrides: ["python-multipart==0.0.32", "starlette==1.3.1"],
        },
        tokenSavior: { package: "token-savior-recall[mcp]==4.21.0" },
        codeReviewGraph: { package: "code-review-graph==2.3.7" },
        codebaseMemory: { package: "codebase-memory-mcp==0.10.5" },
        tokenOptimizer: {
          tag: "v5.11.68",
          commit: "ffe3b8007542260b17648a2d9228c3dedda380ad",
          tree: "d044ba6038ac705e8d0da6a4b545cbee00abe7d5",
        },
      },
      cache: { generation: "966a8a0ef8c0552c" },
      runtime: {
        tokenOptimizer: { integration: "on-demand", commands: ["report", "coach"] },
        codeReviewGraph: { advisory: true },
        codebaseMemory: { advisory: true },
      },
    });
  });

  it("makes combined dry-run report that Serena blocks all mutations", () => {
    expect(commandJson("setup-codex", "--dry-run")).toMatchObject({
      command: "setup-codex",
      dryRun: true,
      ready: false,
      mutations: [],
      selectionRequired:
        "use --tool serena for independent preparation; legacy combined setup is blocked",
    });
  });

  it("keeps optional helper setup independent of engineering workflow plugins", () => {
    const plan = commandJson("plan");
    expect(plan.pins).not.toHaveProperty("ecc");
    expect(JSON.stringify(plan)).not.toContain("native-plugin");
    const launcher = readFileSync(join(root, "tools/repo-ai-tools.mjs"), "utf8");
    expect(launcher).not.toMatch(/configureEcc|verifyEcc|runCodex|ecc@ecc/u);
  });

  it("keeps local projections and caches out of Git", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      private?: boolean;
      publishConfig?: { access?: string };
      scripts: Record<string, string>;
    };
    // Publication is a separately authorized effect; bootstrap exposes no publication route.
    expect(packageJson.private).toBe(true);
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.scripts).not.toHaveProperty("publish");
    expect(packageJson.scripts["repo:init"]).toBe("node tools/repo-ai-tools.mjs setup-codex");
    expect(packageJson.scripts["repo:doctor"]).toBe("node tools/repo-ai-tools.mjs doctor-codex");
    for (const path of [
      ".codex/config.toml",
      ".codex/hooks.json",
      ".serena/",
      ".code-review-graph/",
      ".codebase-memory/",
      ".token-savior-cache.json",
      "node_modules/",
      "dist/",
      "coverage/",
    ])
      expect(ignored(path), path).toBe(true);
  });

  it("uses one explicit aih-supported project/root for CBM", async () => {
    const launcher = await tools();
    const override = join(tmpdir(), "aih-supported-cbm-cache");
    const bootstrap = launcher.inspectCodebaseMemoryBootstrap(override);
    expect(isAbsolute(bootstrap.cacheDir)).toBe(true);
    expect(bootstrap.cacheDir).toBe(resolve(override));
    expect(bootstrap.allowedRoot).toBe(root);
    expect(bootstrap.project).toEqual({ name: "aih-supported", rootPath: root });
    expect(bootstrap.environment).toEqual({
      CBM_CACHE_DIR: resolve(override),
      CBM_ALLOWED_ROOT: root,
      CBM_LOG_LEVEL: "warn",
    });
    expect(bootstrap.projection).toContain(`CBM_CACHE_DIR = ${JSON.stringify(resolve(override))}`);
    expect(bootstrap.projection).toContain(`CBM_ALLOWED_ROOT = ${JSON.stringify(root)}`);
    expect(bootstrap.commands).toEqual({
      index: [
        "cli",
        "index_repository",
        "--repo-path",
        root,
        "--name",
        "aih-supported",
        "--mode",
        "moderate",
      ],
      list: ["cli", "list_projects"],
      status: ["cli", "index_status", "--project", "aih-supported"],
      search: [
        "cli",
        "search_code",
        "--project",
        "aih-supported",
        "--pattern",
        "export",
        "--file-pattern",
        "index.ts",
        "--mode",
        "files",
        "--limit",
        "1",
      ],
    });
    expect(launcher.inspectCodebaseMemoryBootstrap(override)).toEqual(bootstrap);
  });

  it("rejects unsafe CBM overrides and foreign project responses", async () => {
    const launcher = await tools();
    const filesystemRoot = parse(root).root;
    for (const value of [
      "",
      "  ",
      "relative",
      "\u0000cache",
      filesystemRoot,
      root,
      join(root, "cache"),
    ])
      expect(() => launcher.resolveCodebaseMemoryCacheDir(value), JSON.stringify(value)).toThrow(
        /CBM_CACHE_DIR/i,
      );

    const other = { name: "other", root_path: join(tmpdir(), "other"), nodes: 10, edges: 10 };
    const target = { name: "aih-supported", root_path: root, nodes: 10, edges: 10 };
    expect(launcher.findCodebaseMemoryProject([other, target])).toEqual(target);
    expect(() => launcher.findCodebaseMemoryProject([other])).toThrow(/aih-supported/i);
    expect(() =>
      launcher.assertCodebaseMemoryScopedResponse(
        { project: "aih-supported", root_path: root },
        "status",
      ),
    ).not.toThrow();
    expect(() =>
      launcher.assertCodebaseMemoryScopedResponse({ project: "other", root_path: root }, "status"),
    ).toThrow(/status/i);
    expect(() =>
      launcher.assertCodebaseMemorySearchResponse({ files: ["src/index.ts"] }),
    ).not.toThrow();
    expect(() =>
      launcher.assertCodebaseMemorySearchResponse({ files: ["../other/src/index.ts"] }),
    ).toThrow(/search/i);
  });

  it("does not commit an absolute override", () => {
    const override = resolve(tmpdir(), "aih-supported-uncommitted-cache");
    const tracked = spawnSync(
      "git",
      ["grep", "--fixed-strings", "--quiet", "--no-textconv", "-e", override, "--"],
      { cwd: root, encoding: "utf8" },
    );
    expect(tracked.status, tracked.stderr).toBe(1);
  });
});
