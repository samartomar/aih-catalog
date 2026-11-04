/**
 * The committed AI setup data: the code-review-graph, codebase-memory-mcp and Serena framework
 * content, their qualifications as the recorded runs gave them, and the trio combination recipe
 * drafted in the port report. Nothing here is network-bound; the plans need no bytes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Content,
  type PlanResult,
  planInstall,
  planRecipe,
  type Qualification,
  readContent,
  readQualification,
} from "../../src/catalog/reader.js";
import { profile } from "./helpers.js";

const root = join(import.meta.dirname, "..", "..");
const REPORT = JSON.parse(readFileSync(join(root, "port-report/ai-setup.json"), "utf8"));
const DATA = { repository: "https://github.com/samartomar/aih-catalog", commit: "d".repeat(40) };
const SOURCE = { repository: "https://example.invalid/recipes", commit: "e".repeat(40) };

function content(framework: string): Content {
  const read = readContent(readFileSync(join(root, "data", framework, "content.json")));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read.content;
}
const qualifications = readdirSync(join(root, "data/qualifications"))
  .sort()
  .map((name) => {
    const read = readQualification(readFileSync(join(root, "data/qualifications", name)));
    if (read.status !== "ok") throw new Error(`${name}: ${JSON.stringify(read)}`);
    return { name, ...read };
  });
const records = qualifications.map((entry) => entry.qualification as Qualification);
const contents = () => ["cbm", "crg", "serena"].map(content);
const planned = (result: PlanResult) => {
  if (result.status === "invalid" || result.status === "refused")
    throw new Error(JSON.stringify(result));
  return result;
};

describe("the committed qualifications", () => {
  it("are canonical, named by their sha256, and keep each run's actual result", () => {
    for (const entry of qualifications) expect(entry.name).toBe(`${entry.sha256}.json`);
    const statuses = qualifications
      .map(({ qualification }) => {
        const subject = qualification.subject as { aiSetup: string; cell: string };
        return `${subject.aiSetup} ${subject.cell} ${qualification.result.status}`;
      })
      .sort();
    expect(statuses).toEqual([
      "cbm.ai-setup.codebase-memory-mcp darwin-arm64 unknown",
      "cbm.ai-setup.codebase-memory-mcp darwin-x64 unknown",
      "cbm.ai-setup.codebase-memory-mcp linux-arm64 unknown",
      "cbm.ai-setup.codebase-memory-mcp linux-x64 qualified",
      "cbm.ai-setup.codebase-memory-mcp windows-arm64 unknown",
      "cbm.ai-setup.codebase-memory-mcp windows-x64 unknown",
      "crg.ai-setup.code-review-graph linux-x64 blocked",
      "crg.ai-setup.code-review-graph linux-x64 blocked",
      "serena.ai-setup.serena linux-x64 blocked",
    ]);
    expect(REPORT.combinationQualifications).toEqual([]);
  });

  it("are exactly the ones the AI setup items accept", () => {
    const accepted = contents()
      .flatMap((entry) => entry.items)
      .filter((item) => item.kind === "ai-setup")
      .flatMap((item) => (item.aiSetup as { qualifications: string[] }).qualifications)
      .sort();
    expect(accepted).toEqual(qualifications.map((entry) => entry.sha256).sort());
  });
});

describe("the trio on Linux x64", () => {
  const trio = { ...REPORT.recipes[0], data: DATA };
  const plan = () =>
    planned(
      planRecipe(
        trio,
        contents(),
        [profile("claude-code"), profile("codex")],
        {},
        {
          scope: "project",
          source: SOURCE,
          cell: "linux-x64",
          qualifications: records,
        },
      ),
    );

  it("stays incomplete with the real reasons until every qualification exists", () => {
    const result = plan();
    expect(result.status).toBe("incomplete");
    expect(
      result.unavailable.map((entry) => [
        entry.item ?? entry.recipe,
        entry.reason,
        entry.cause ?? "",
      ]),
    ).toEqual([
      ["code-intelligence-trio", "no-qualification", ""],
      ["crg.ai-setup.code-review-graph", "not-qualified", "blocked"],
      ["serena.ai-setup.serena", "not-qualified", "blocked"],
    ]);
    // code-review-graph's reason is its latest run's (CPython 3.15.2), not the older 3.14.10 one.
    expect(
      result.unavailable.find((entry) => entry.item === "crg.ai-setup.code-review-graph")?.detail,
    ).toMatch(/^no binary-only closure on CPython 3\.15\.2/);
  });

  it("acquires codebase-memory-mcp from its qualified record and applies its settings with readbacks", () => {
    const result = plan();
    const cbm = qualifications.find(
      (entry) =>
        entry.qualification.result.status === "qualified" &&
        (entry.qualification.subject as { cell: string }).cell === "linux-x64",
    );
    expect(result.plan.filter((step) => step.op === "acquire")).toEqual([
      expect.objectContaining({
        aiSetup: "cbm.ai-setup.codebase-memory-mcp",
        into: ".aihq/ai-setup/codebase-memory-mcp/0.12.1/linux-x64/",
        executable: ".aihq/ai-setup/codebase-memory-mcp/0.12.1/linux-x64/codebase-memory-mcp",
        qualification: cbm?.sha256,
      }),
    ]);
    expect(
      result.plan
        .filter((step) => step.op === "tool-command")
        .map((step) => [
          ...(step as { argv: readonly string[] }).argv,
          (step as { readback: { expected: string } }).readback.expected,
        ]),
    ).toEqual([
      ["config", "set", "watcher_enabled", "false", "false"],
      ["config", "set", "auto_watch", "false", "false"],
      ["config", "set", "auto_index", "false", "false"],
    ]);
  });

  it("configures each tool's server for each client with the trio's tool lists, and no installer", () => {
    const result = plan();
    const merges = result.plan.filter((step) => step.op === "merge") as {
      file: string;
      key: string;
      entry: Record<string, unknown>;
    }[];
    expect(merges.map((step) => `${step.file} ${step.key}`)).toEqual([
      ".codex/config.toml mcp_servers.code-review-graph",
      ".codex/config.toml mcp_servers.codebase-memory-mcp",
      ".codex/config.toml mcp_servers.serena",
      ".mcp.json /mcpServers/code-review-graph",
      ".mcp.json /mcpServers/codebase-memory-mcp",
      ".mcp.json /mcpServers/serena",
    ]);
    const codexCbm = merges[1]?.entry;
    expect(codexCbm).toMatchObject({
      command: ".aihq/ai-setup/codebase-memory-mcp/0.12.1/linux-x64/codebase-memory-mcp",
      args: ["--ui=false"],
      env: { CBM_DIAGNOSTICS: "false" },
    });
    expect(codexCbm?.disabled_tools).toContain("search_code");
    expect(codexCbm?.enabled_tools).toContain("manage_adr");
    expect(merges[5]?.entry.args).toContain("claude-code");
    expect(merges[2]?.entry.args).toContain("codex");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "mcp-tools-unrestricted", cli: "claude-code" }),
    );
    // No step runs an upstream installer, a package runner or a wrapper: an archive may contain
    // an installer file, which is acquired as a member and never run.
    expect(result.plan.some((step) => step.op === "upstream-installer")).toBe(false);
    const runs = result.plan.flatMap((step) => {
      const entry = (step as { entry?: Record<string, unknown> }).entry;
      const argv = (step as { argv?: string[] }).argv ?? [];
      return [
        String(entry?.command ?? ""),
        ...((entry?.args as string[] | undefined) ?? []),
        ...argv,
      ];
    });
    for (const forbidden of [
      "install",
      "uninstall",
      "setup",
      "install.sh",
      "install.ps1",
      "serena-hooks",
      "uvx",
      "npx",
    ])
      expect(runs).not.toContain(forbidden);
  });

  it("carries no secret in any server setting", () => {
    for (const item of contents().flatMap((entry) => entry.items)) {
      const inputs = Object.values(item.requirements?.inputs ?? {});
      expect(inputs.filter((input) => input.isSecret)).toEqual([]);
      for (const name of Object.keys((item.env as Record<string, string> | undefined) ?? {}))
        expect(name).not.toMatch(/key|token|secret|password/i);
    }
  });

  it("plans codebase-memory-mcp alone on its qualified cell as ok", () => {
    const result = planned(
      planInstall(["cbm.ai-setup.codebase-memory-mcp"], [content("cbm")], [profile("codex")], {
        scope: "user",
        data: DATA,
        cell: "linux-x64",
        qualifications: records,
      }),
    );
    expect(result.status).toBe("ok");
    const other = planned(
      planInstall(["cbm.ai-setup.codebase-memory-mcp"], [content("cbm")], [profile("codex")], {
        scope: "user",
        data: DATA,
        cell: "darwin-arm64",
        qualifications: records,
      }),
    );
    expect(other.unavailable).toMatchObject([{ reason: "not-qualified", cause: "unknown" }]);
  });
});
