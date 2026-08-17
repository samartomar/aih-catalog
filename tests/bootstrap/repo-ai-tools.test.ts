import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  it("pins the narrow public helper toolchain", () => {
    expect(commandJson("plan")).toMatchObject({
      pins: {
        ecc: { plugin: "ecc@ecc", version: "2.2.0" },
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
        },
      },
      runtime: {
        tokenOptimizer: { integration: "on-demand", commands: ["report", "coach"] },
        codeReviewGraph: { advisory: true },
        codebaseMemory: { advisory: true },
      },
    });
  });

  it("makes dry-run disclose every local mutation class", () => {
    expect(commandJson("setup-codex", "--dry-run")).toEqual({
      command: "setup-codex",
      dryRun: true,
      mutations: [
        "install pinned repo AI tools",
        "write ignored Codex project projection",
        "install or refresh ECC through the native Codex plugin lifecycle",
        "initialize project-scoped graph and memory indexes",
        "enable the repository pre-commit hook path",
      ],
    });
  });

  it("keeps local projections and caches out of Git", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      private: boolean;
      scripts: Record<string, string>;
    };
    expect(packageJson.private).toBe(true);
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
      index: ["cli", "index_repository", "--repo-path", root, "--name", "aih-supported", "--mode", "moderate"],
      list: ["cli", "list_projects"],
      status: ["cli", "index_status", "--project", "aih-supported"],
      search: ["cli", "search_code", "--project", "aih-supported", "--pattern", "export", "--file-pattern", "index.ts", "--mode", "files", "--limit", "1"],
    });
    expect(launcher.inspectCodebaseMemoryBootstrap(override)).toEqual(bootstrap);
  });

  it("rejects unsafe CBM overrides and foreign project responses", async () => {
    const launcher = await tools();
    const filesystemRoot = parse(root).root;
    for (const value of ["", "  ", "relative", "\u0000cache", filesystemRoot, root, join(root, "cache")])
      expect(() => launcher.resolveCodebaseMemoryCacheDir(value), JSON.stringify(value)).toThrow(/CBM_CACHE_DIR/i);

    const other = { name: "other", root_path: join(tmpdir(), "other"), nodes: 10, edges: 10 };
    const target = { name: "aih-supported", root_path: root, nodes: 10, edges: 10 };
    expect(launcher.findCodebaseMemoryProject([other, target])).toEqual(target);
    expect(() => launcher.findCodebaseMemoryProject([other])).toThrow(/aih-supported/i);
    expect(() => launcher.assertCodebaseMemoryScopedResponse({ project: "aih-supported", root_path: root }, "status")).not.toThrow();
    expect(() => launcher.assertCodebaseMemoryScopedResponse({ project: "other", root_path: root }, "status")).toThrow(/status/i);
    expect(() => launcher.assertCodebaseMemorySearchResponse({ files: ["src/index.ts"] })).not.toThrow();
    expect(() => launcher.assertCodebaseMemorySearchResponse({ files: ["../other/src/index.ts"] })).toThrow(/search/i);
  });

  it("does not commit an absolute override", () => {
    const override = resolve(tmpdir(), "aih-supported-uncommitted-cache");
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
      .filter((path) => existsSync(join(root, path)))
      .map((path) => readFileSync(join(root, path), "utf8"))
      .join("\n");
    expect(tracked).not.toContain(override);
  });
});
