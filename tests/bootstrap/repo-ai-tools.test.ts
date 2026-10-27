import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
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

  it("pins the narrow public helper toolchain", () => {
    expect(commandJson("plan")).toMatchObject({
      pins: {
        serena: {
          package: "serena-agent==1.7.0",
          securityOverrides: ["python-multipart==0.0.32", "starlette==1.3.1"],
        },
        tokenSavior: { package: "token-savior-recall[mcp]==4.21.0" },
        codeReviewGraph: { package: "code-review-graph==2.3.9" },
        codebaseMemory: { version: "0.12.1", distribution: "native" },
        tokenOptimizer: {
          tag: "v5.11.68",
          commit: "ffe3b8007542260b17648a2d9228c3dedda380ad",
          tree: "d044ba6038ac705e8d0da6a4b545cbee00abe7d5",
        },
      },
      runtime: {
        tokenOptimizer: { integration: "on-demand", commands: ["report", "coach"] },
        codeReviewGraph: { advisory: true },
        codebaseMemory: { advisory: true },
      },
    });
  });

  it("selects graph setup without indexing or Git policy writes in dry-run", () => {
    const result = commandJson("setup-codex", "--tool", "code-review-graph", "--dry-run");
    expect(result).toMatchObject({
      selected: ["code-review-graph"],
      indexing: "manual-only",
      gitHooks: "unchanged",
      mutations: ["acquire selected qualified tools", "write selected Codex projection"],
    });
    expect(JSON.stringify(result)).not.toContain("serena-agent");
    expect(JSON.stringify(result)).not.toContain("token-savior");
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

  it("projects only the selected graph with six read tools and no memory prerequisites", () => {
    const result = spawnSync(
      process.execPath,
      ["tools/repo-ai-tools.mjs", "projection-codex", "--tool", "code-review-graph"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CBM_CACHE_DIR: "invalid-relative" },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('[mcp_servers."code-review-graph"]');
    expect(result.stdout).not.toContain("codebase-memory");
    expect(result.stdout).not.toContain("build_or_update_graph_tool");
    expect(result.stdout).toContain("list_graph_stats_tool");
  });

  it("uses an account-wide canonical memory cache and independent project/root", async () => {
    const launcher = await tools();
    const bootstrap = launcher.inspectCodebaseMemoryBootstrap(join(tmpdir(), "catalog-cbm-test"));
    expect(bootstrap.cacheDir).toBe(join(tmpdir(), "catalog-cbm-test"));
    expect(bootstrap.allowedRoot).toBe(root);
    expect(bootstrap.project.rootPath).toBe(root);
    expect(bootstrap.project.name).toMatch(/^catalog-[a-f0-9]{16}$/);
    expect(bootstrap).not.toHaveProperty("markerPath");
    expect(bootstrap.environment).toMatchObject({
      CBM_ALLOWED_ROOT: root,
      CBM_DIAGNOSTICS: "false",
    });
    expect(bootstrap.commands.status).toContain("json");
    const project = { name: bootstrap.project.name, root_path: root, nodes: 0, edges: 0 };
    expect(launcher.findCodebaseMemoryProject([project])).toEqual(project);
    expect(() => launcher.findCodebaseMemoryProject([project, project])).toThrow(/unambiguous/);
    expect(() => launcher.findCodebaseMemoryProject([{ ...project, root_path: tmpdir() }])).toThrow(
      /root/,
    );
    expect(() =>
      launcher.assertCodebaseMemoryScopedResponse({ project: "other", root_path: root }, "status"),
    ).toThrow(/status/);
    expect(() => launcher.assertCodebaseMemorySearchResponse({ files: ["../outside.ts"] })).toThrow(
      /search/,
    );
    expect(() =>
      launcher.assertCodebaseMemorySearchResponse({ files: ["src/index.ts"] }),
    ).not.toThrow();
    for (const value of ["", "relative", parse(root).root, root, join(root, "cache")])
      expect(() => launcher.resolveCodebaseMemoryCacheDir(value)).toThrow(/CBM_CACHE_DIR/);
  });

  it.each([
    '[mcp_servers."code-review-graph"]',
    "[mcp_servers.'code-review-graph']",
    '[ mcp_servers . "code-review-graph" . env ]',
    '[mcp_servers."code-review-\\u0067raph"]',
    "[mcp_servers]",
  ])("refuses client collision %s before acquisition and preserves deliberate hook policy", (header) => {
    const fixture = mkdtempSync(join(tmpdir(), "catalog-bootstrap-"));
    try {
      mkdirSync(join(fixture, "tools"));
      cpSync(join(root, "tools/repo-ai-tools.mjs"), join(fixture, "tools/repo-ai-tools.mjs"));
      mkdirSync(join(fixture, ".codex"));
      const config = `${header}\ncommand = "owned-by-someone-else"\n`;
      writeFileSync(join(fixture, ".codex/config.toml"), config);
      execFileSync("git", ["init", "-q", fixture]);
      execFileSync("git", ["-C", fixture, "config", "core.hooksPath", "deliberate-hooks"]);
      const result = spawnSync(
        process.execPath,
        ["tools/repo-ai-tools.mjs", "setup-codex", "--tool", "code-review-graph"],
        {
          cwd: fixture,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: "",
            AIH_SUPPORTED_REPO_AI_TOOLS_HOME: join(fixture, "cache"),
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("already owns");
      expect(readFileSync(join(fixture, ".codex/config.toml"), "utf8")).toBe(config);
      expect(
        execFileSync("git", ["-C", fixture, "config", "core.hooksPath"], {
          encoding: "utf8",
        }).trim(),
      ).toBe("deliberate-hooks");
      expect(
        spawnSync("git", ["-C", fixture, "status", "--porcelain"], { encoding: "utf8" }).stdout,
      ).not.toContain("cache");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "sets up only graph projection with stand-in installers in a disposable repository",
    () => {
      const fixture = mkdtempSync(join(tmpdir(), "catalog-projection-"));
      try {
        mkdirSync(join(fixture, "tools"));
        cpSync(join(root, "tools/repo-ai-tools.mjs"), join(fixture, "tools/repo-ai-tools.mjs"));
        mkdirSync(join(fixture, "bin"));
        const log = join(fixture, "calls.jsonl");
        const uv = join(fixture, "bin/uv");
        const python = join(fixture, "bin/python");
        writeFileSync(
          uv,
          `#!${process.execPath}\nimport { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`,
        );
        writeFileSync(python, `#!${process.execPath}\nprocess.stdout.write('3.14.10\\n');\n`);
        chmodSync(uv, 0o755);
        chmodSync(python, 0o755);
        execFileSync("git", ["init", "-q", fixture]);
        execFileSync("git", ["-C", fixture, "config", "core.hooksPath", "deliberate-hooks"]);
        mkdirSync(join(fixture, ".codex"));
        const existing = '[mcp_servers.serena]\ncommand = "existing-serena"\n';
        writeFileSync(join(fixture, ".codex/config.toml"), existing);
        const result = spawnSync(
          process.execPath,
          ["tools/repo-ai-tools.mjs", "setup-codex", "--tool", "code-review-graph"],
          {
            cwd: fixture,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: join(fixture, "bin"),
              AIH_REPO_CRG_PYTHON: python,
              AIH_SUPPORTED_REPO_AI_TOOLS_HOME: join(fixture, "cache"),
            },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        const projection = readFileSync(join(fixture, ".codex/config.toml"), "utf8");
        expect(projection).toContain(existing);
        expect(projection).toContain('[mcp_servers."code-review-graph"]');
        expect(projection).not.toContain("codebase-memory");
        const repeated = spawnSync(
          process.execPath,
          ["tools/repo-ai-tools.mjs", "setup-codex", "--tool", "code-review-graph"],
          {
            cwd: fixture,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: join(fixture, "bin"),
              AIH_REPO_CRG_PYTHON: python,
              AIH_SUPPORTED_REPO_AI_TOOLS_HOME: join(fixture, "cache"),
            },
          },
        );
        expect(repeated.status, repeated.stderr).toBe(0);
        expect(readFileSync(join(fixture, ".codex/config.toml"), "utf8")).toBe(projection);
        const calls = readFileSync(log, "utf8");
        expect(calls).toContain('"venv"');
        expect(calls).toContain('"--require-hashes"');
        expect(calls).not.toMatch(/tool","install|serena|index_repository|build|hooks|git/);
        expect(
          execFileSync("git", ["-C", fixture, "config", "core.hooksPath"], {
            encoding: "utf8",
          }).trim(),
        ).toBe("deliberate-hooks");
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

  it("refuses implicit and unknown helper selection before any mutation", () => {
    for (const args of [
      ["setup-codex"],
      ["setup-codex", "--tool", "unknown"],
      ["setup-codex", "--tool", "code-review-graph", "--tool", "code-review-graph"],
    ]) {
      const result = spawnSync(process.execPath, ["tools/repo-ai-tools.mjs", ...args], {
        cwd: root,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/select|unknown|duplicate/);
    }
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
