/**
 * AI setup: a tool's executable pinned per platform cell, its qualifications, and how plans
 * acquire it, configure it and start its MCP server. The tool here is an ordinary synthetic
 * framework (`kit`); every qualification is supplied by the test and names its own run hash.
 * A fixture's `qualified` record proves planning behaviour only, never a real qualification.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent } from "../../src/catalog/producer.js";
import {
  getItem,
  type PlanResult,
  planInstall,
  planRecipe,
  type Qualification,
  readQualification,
} from "../../src/catalog/reader.js";
import { folder, profile, sha, sortKeys } from "./helpers.js";

const COMMIT = "3".repeat(40);
const h = (char: string) => char.repeat(64);
/** The MCP item of an AI setup the plan does not acquire: it never names the missing program. */
const UNACQUIRED_MCP = expect.objectContaining({
  item: "kit.mcp.kit-graph",
  cli: "codex",
  reason: "no-qualification",
});

const SERVER = JSON.stringify({
  name: "io.example/kit-graph",
  description: "Kit's code graph server.",
  version: "1.2.3",
  packages: [
    {
      registryType: "pypi",
      identifier: "kit-graph",
      version: "1.2.3",
      transport: { type: "stdio" },
      packageArguments: [{ type: "positional", value: "serve" }],
    },
  ],
});

/** A Python tool: one universal wheel for every cell but Windows arm64. */
const KIT_SETUP = {
  version: "1.2.3",
  distributions: [
    {
      cells: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-x64"],
      kind: "pypi-wheel",
      file: "kit_graph-1.2.3-py3-none-any.whl",
      sha256: h("a"),
      bytes: 1000,
    },
  ],
  runtime: { python: ">=3.10", closure: "uv-lock" },
  executable: "kit-graph",
  launch: { args: ["serve"] },
  mcpItem: "kit.mcp.kit-graph",
  settings: {
    commands: [
      {
        argv: ["config", "set", "watch", "false"],
        readback: { argv: ["config", "get", "watch"], expected: "false" },
        restore: { argv: ["config", "set", "watch", "<prior>"] },
      },
    ],
    files: [],
  },
  doNotRun: [["kit-graph", "install"]],
  qualifications: [] as string[],
};

async function kitContent(
  setup: Record<string, unknown> = KIT_SETUP,
  mcp: Record<string, unknown> = {},
  fw = "kit",
) {
  const server = SERVER.replaceAll("kit", fw);
  const read = readLocalSource(folder({ "server.json": server, LICENSE: "MIT\n" }, fw));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  const file = read.files.find((entry) => entry.path === "server.json");
  const built = await buildContent(
    { kind: "git", repository: `https://example.invalid/${fw}`, commit: COMMIT },
    read.files,
    [
      {
        id: `${fw}.ai-setup.${fw}-graph`,
        kind: "ai-setup",
        name: `${fw}-graph`,
        description: "Kit's code graph, as a pinned executable.",
        aiSetup: setup,
        files: [],
      },
      {
        id: `${fw}.mcp.${fw}-graph`,
        kind: "mcp",
        files: [
          {
            sourceId: fw,
            sourcePath: "server.json",
            sha256: file?.sha256 as string,
            executable: false,
            role: "content",
          },
        ],
        dependencies: [`${fw}.ai-setup.${fw}-graph`],
        env: { KIT_TELEMETRY: "off" },
        ...mcp,
      },
    ],
    { framework: fw },
  );
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  return built.content;
}

describe("an AI setup item", () => {
  it("is built from its authored record and keeps its identity when qualifications are added", async () => {
    const before = await kitContent();
    const after = await kitContent({ ...KIT_SETUP, qualifications: [h("b"), h("c")] });
    const item = getItem(before, "kit.ai-setup.kit-graph");
    if (item.status !== "ok") throw new Error("missing");
    expect(item.item).toMatchObject({
      kind: "ai-setup",
      name: "kit-graph",
      files: [],
      aiSetup: { version: "1.2.3", mcpItem: "kit.mcp.kit-graph" },
    });
    expect(item.item.scanKey).toBeUndefined();
    const added = getItem(after, "kit.ai-setup.kit-graph");
    if (added.status !== "ok") throw new Error("missing");
    expect((added.item.aiSetup as { qualifications: string[] }).qualifications).toEqual([
      h("b"),
      h("c"),
    ]);
    expect(added.item.contentSha256).toBe(item.item.contentSha256);
    expect(added.item.behaviourSha256).toBe(item.item.behaviourSha256);
  });

  it("requires each settings command to restore the earlier value through <prior> exactly once", async () => {
    const [command] = KIT_SETUP.settings.commands;
    const { restore: _restore, ...unrestored } = command as (typeof KIT_SETUP.settings.commands)[0];
    for (const bad of [
      unrestored,
      { ...command, restore: { argv: ["config", "set", "watch", "false"] } },
      { ...command, restore: { argv: ["config", "set", "<prior>", "<prior>"] } },
      { ...command, restore: { argv: ["config", "set", "watch=<prior>"] } },
    ])
      await expect(
        kitContent({ ...KIT_SETUP, settings: { ...KIT_SETUP.settings, commands: [bad] } }),
        JSON.stringify(bad),
      ).rejects.toThrow("restore: { argv } }, with <prior> once in restore");
  });
});

const QUALIFICATION = "urn:aihq:catalog:qualification:0.1.0";
const canonical = (value: unknown) => `${JSON.stringify(sortKeys(value), null, 2)}\n`;
const bytes = (value: unknown) => new TextEncoder().encode(canonical(value));
const WHEEL = {
  name: "kit-graph",
  version: "1.2.3",
  file: "kit_graph-1.2.3-py3-none-any.whl",
  sha256: h("a"),
};
const PYTHON = {
  version: "3.14.5",
  file: "cpython-3.14.5-x86_64-unknown-linux-gnu.tar.gz",
  sha256: h("e"),
  bytes: 30,
};
const BUILT_WHEEL = {
  ...WHEEL,
  build: {
    source: {
      file: "kit_graph-1.2.3.tar.gz",
      url: "https://files.pythonhosted.org/packages/example/kit_graph-1.2.3.tar.gz",
      sha256: h("b"),
      bytes: 500,
    },
    interpreter: PYTHON,
    dependencies: [
      {
        name: "setuptools",
        version: "84.2.1",
        file: "setuptools-84.2.1-py3-none-any.whl",
        sha256: h("c"),
      },
    ],
    tools: [{ name: "gcc", version: "13.3.0", sha256: h("d") }],
    isolated: true,
  },
};

/** A supplied qualification record for the kit tool on one cell. */
function kitQualification(
  overrides: {
    cell?: string;
    status?: "qualified" | "blocked" | "unknown";
    reason?: string;
    date?: string;
    artifact?: string;
    closure?: unknown;
    interpreter?: unknown;
    run?: string;
  } = {},
) {
  const status = overrides.status ?? "qualified";
  return {
    schema: QUALIFICATION,
    subject: {
      aiSetup: "kit.ai-setup.kit-graph",
      version: "1.2.3",
      cell: overrides.cell ?? "linux-x64",
    },
    observed: {
      artifact: {
        file: "kit_graph-1.2.3-py3-none-any.whl",
        sha256: overrides.artifact ?? h("a"),
        bytes: 1000,
      },
      closure: overrides.closure === undefined ? [WHEEL] : overrides.closure,
      interpreter: overrides.interpreter === undefined ? PYTHON : overrides.interpreter,
    },
    result: {
      status,
      ...(overrides.reason
        ? { reason: overrides.reason }
        : status === "blocked"
          ? { reason: "the closure fails" }
          : {}),
      run: overrides.run ?? h("9"),
      date: overrides.date ?? "2026-11-01",
    },
  };
}

describe("readQualification", () => {
  it("reads a canonical record and gives the sha256 an item references", () => {
    const record = kitQualification();
    const read = readQualification(bytes(record));
    expect(read).toEqual({ status: "ok", qualification: record, sha256: sha(canonical(record)) });
  });

  it("reads the exact inputs of an isolated source-built wheel", () => {
    const record = kitQualification({ closure: [BUILT_WHEEL] });
    expect(readQualification(bytes(record))).toEqual({
      status: "ok",
      qualification: record,
      sha256: sha(canonical(record)),
    });
  });

  it("rejects incomplete, unpinned or non-isolated source-build evidence", () => {
    const { source: _source, ...missingSource } = BUILT_WHEEL.build;
    for (const build of [
      missingSource,
      { ...BUILT_WHEEL.build, isolated: false },
      {
        ...BUILT_WHEEL.build,
        source: { ...BUILT_WHEEL.build.source, url: "file:///tmp/source.tar.gz" },
      },
      { ...BUILT_WHEEL.build, dependencies: [{ ...WHEEL, version: ">=1.0" }] },
      { ...BUILT_WHEEL.build, interpreter: null },
      { ...BUILT_WHEEL.build, tools: [{ name: "gcc", version: "13.3.0", sha256: "unknown" }] },
      { ...BUILT_WHEEL.build, hook: "install" },
    ]) {
      expect(
        readQualification(bytes(kitQualification({ closure: [{ ...WHEEL, build }] }))),
      ).toMatchObject({ status: "invalid" });
    }
  });

  it("never puts a source archive directly in the runtime wheel closure", () => {
    const sdist = { ...WHEEL, name: "pyyaml", version: "6.0.2", file: "pyyaml-6.0.2.tar.gz" };
    for (const status of ["qualified", "blocked"] as const) {
      const read = readQualification(bytes(kitQualification({ status, closure: [WHEEL, sdist] })));
      expect(read).toMatchObject({
        status: "invalid",
        problems: [{ path: "/observed/closure/1/file" }],
      });
    }
  });

  it("requires a qualified closure to name its interpreter and a blocked result its reason", () => {
    expect(readQualification(bytes(kitQualification({ interpreter: null })))).toMatchObject({
      status: "invalid",
      problems: [{ path: "/observed/interpreter" }],
    });
    const blocked = kitQualification({ status: "blocked" });
    const { reason: _reason, ...result } = blocked.result as { reason?: string };
    expect(readQualification(bytes({ ...blocked, result }))).toMatchObject({
      status: "invalid",
      problems: [{ path: "/result/reason" }],
    });
  });

  it("refuses bytes that are not canonical, and names another version's schema", () => {
    expect(
      readQualification(new TextEncoder().encode(JSON.stringify(kitQualification()))),
    ).toMatchObject({
      status: "invalid",
    });
    expect(
      readQualification(
        bytes({ ...kitQualification(), schema: "urn:aihq:catalog:qualification:0.2.0" }),
      ),
    ).toEqual({ status: "unsupported-version", schema: "urn:aihq:catalog:qualification:0.2.0" });
  });
});

const shaOf = (record: unknown) => sha(canonical(record));
const planned = (result: PlanResult) => {
  if (result.status === "invalid" || result.status === "refused")
    throw new Error(JSON.stringify(result));
  return result;
};
/** The kit content accepting the given qualification records. */
const accepting = (...records: unknown[]) =>
  kitContent({ ...KIT_SETUP, qualifications: records.map(shaOf).sort() });
const INTO = ".aihq/ai-setup/kit-graph/1.2.3/linux-x64/";

describe("planning an AI setup on its own", () => {
  it("preserves source-built wheel custody and provenance in the acquisition plan", async () => {
    const record = kitQualification({ closure: [BUILT_WHEEL] });
    const content = await accepting(record);
    const plan = planned(
      planInstall(["kit.ai-setup.kit-graph"], [content], [profile("codex")], {
        scope: "project",
        data: null,
        cell: "linux-x64",
        qualifications: [record as Qualification],
      }),
    );
    expect(plan.status).toBe("ok");
    expect(plan.plan[0]).toMatchObject({
      op: "acquire",
      closure: [BUILT_WHEEL],
      interpreter: { prefer: "installed", range: ">=3.10", fallback: PYTHON },
    });
  });

  it("acquires the qualified artifact, starts its server from there and applies its settings", async () => {
    const record = kitQualification();
    const content = await accepting(record);
    const plan = planned(
      planInstall(
        ["kit.ai-setup.kit-graph"],
        [content],
        [profile("claude-code"), profile("codex")],
        {
          scope: "project",
          data: null,
          cell: "linux-x64",
          qualifications: [record as Qualification],
        },
      ),
    );
    expect(plan.unavailable).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.status).toBe("ok");
    expect(plan.plan.map((step) => step.op)).toEqual([
      "acquire",
      "write",
      "merge",
      "merge",
      "tool-command",
    ]);
    expect(plan.plan[1]).toMatchObject({
      path: ".aihq/notices/kit/LICENSE",
      items: ["kit.mcp.kit-graph"],
      clis: ["claude-code", "codex"],
    });
    expect(plan.plan[0]).toEqual({
      op: "acquire",
      aiSetup: "kit.ai-setup.kit-graph",
      version: "1.2.3",
      cell: "linux-x64",
      root: "user",
      into: INTO,
      distribution: {
        kind: "pypi-wheel",
        file: "kit_graph-1.2.3-py3-none-any.whl",
        sha256: h("a"),
        bytes: 1000,
      },
      executable: `${INTO}bin/kit-graph`,
      qualification: shaOf(record),
      closure: [WHEEL],
      interpreter: { prefer: "installed", range: ">=3.10", fallback: PYTHON },
      scanned: false,
    });
    expect(plan.plan[2]).toEqual({
      op: "merge",
      root: "project",
      file: ".codex/config.toml",
      format: "toml",
      key: "mcp_servers.kit-graph",
      entry: { command: `${INTO}bin/kit-graph`, args: ["serve"], env: { KIT_TELEMETRY: "off" } },
      rootPaths: [{ pointer: "/command", root: "user", path: `${INTO}bin/kit-graph` }],
      item: "kit.mcp.kit-graph",
      clis: ["codex"],
    });
    expect(plan.plan[3]).toMatchObject({
      file: ".mcp.json",
      key: "/mcpServers/kit-graph",
      entry: {
        type: "stdio",
        command: `${INTO}bin/kit-graph`,
        args: ["serve"],
        env: { KIT_TELEMETRY: "off" },
      },
      clis: ["claude-code"],
    });
    expect(plan.plan[4]).toEqual({
      op: "tool-command",
      aiSetup: "kit.ai-setup.kit-graph",
      qualification: shaOf(record),
      executable: { root: "user", path: `${INTO}bin/kit-graph` },
      argv: ["config", "set", "watch", "false"],
      readback: { argv: ["config", "get", "watch"], expected: "false" },
      restore: { argv: ["config", "set", "watch", "<prior>"] },
      approval: "required",
    });
    expect(JSON.stringify(plan)).not.toContain('kit-graph","install');
  });
});

/** Plans the kit tool for Codex on a cell with the supplied records, the item accepting `accepted`. */
async function toolPlan(
  accepted: readonly unknown[],
  supplied: readonly unknown[] = accepted,
  cell = "linux-x64",
) {
  const content = await accepting(...accepted);
  return planned(
    planInstall(["kit.ai-setup.kit-graph"], [content], [profile("codex")], {
      scope: "project",
      data: null,
      cell,
      qualifications: supplied as Qualification[],
    }),
  );
}
const acquired = (plan: { plan: readonly { op: string }[] }) =>
  plan.plan.filter((step) => step.op === "acquire") as unknown as { qualification: string }[];

describe("which qualification an AI setup uses", () => {
  it("is supplied, qualified records only; blocked, unknown and mismatched ones leave it unavailable", async () => {
    const cases = [
      {
        records: [
          kitQualification({ status: "blocked", reason: "pyyaml has no wheel for this Python" }),
        ],
        expected: {
          reason: "not-qualified",
          cause: "blocked",
          detail: "pyyaml has no wheel for this Python",
        },
      },
      {
        records: [kitQualification({ status: "unknown" })],
        expected: { reason: "not-qualified", cause: "unknown" },
      },
      {
        records: [kitQualification({ artifact: h("f") })],
        expected: { reason: "not-qualified", cause: "artifact-mismatch" },
      },
      {
        records: [kitQualification({ cell: "darwin-arm64" })],
        expected: { reason: "no-qualification" },
      },
      { records: [], expected: { reason: "no-qualification" } },
    ];
    for (const { records, expected } of cases) {
      const plan = await toolPlan(records);
      expect(plan.status).toBe("incomplete");
      expect(acquired(plan)).toEqual([]);
      expect(plan.unavailable).toEqual([
        expect.objectContaining({ item: "kit.ai-setup.kit-graph", cell: "linux-x64", ...expected }),
        UNACQUIRED_MCP,
      ]);
      expect(plan.unavailable[0]?.cli).toBeUndefined();
    }
  });

  it("reports the latest of several unqualified runs, whatever order they are supplied in", async () => {
    const older = kitQualification({
      status: "blocked",
      reason: "no interpreter download for 3.14.10",
      date: "2026-10-27",
      run: h("1"),
    });
    const newer = kitQualification({
      status: "blocked",
      reason: "pyyaml has no wheel for 3.15",
      date: "2026-11-04",
      run: h("2"),
    });
    const unknown = kitQualification({ status: "unknown", date: "2026-11-05", run: h("3") });
    for (const records of [
      [older, newer],
      [newer, older],
    ]) {
      const plan = await toolPlan(records);
      expect(plan.unavailable).toEqual([
        expect.objectContaining({
          item: "kit.ai-setup.kit-graph",
          cause: "blocked",
          detail: "pyyaml has no wheel for 3.15",
        }),
        UNACQUIRED_MCP,
      ]);
    }
    const latest = await toolPlan([older, newer, unknown]);
    expect(latest.unavailable).toEqual([
      expect.objectContaining({ item: "kit.ai-setup.kit-graph", cause: "unknown" }),
      UNACQUIRED_MCP,
    ]);
  });

  it("ignores a qualified record the item does not accept, and a record for no artifact's cell", async () => {
    const record = kitQualification();
    const unreferenced = await toolPlan([], [record]);
    expect(unreferenced.unavailable).toEqual([
      expect.objectContaining({ reason: "no-qualification" }),
      UNACQUIRED_MCP,
    ]);
    const arm = await toolPlan(
      [kitQualification({ cell: "windows-arm64" })],
      undefined,
      "windows-arm64",
    );
    expect(arm.unavailable).toEqual([
      expect.objectContaining({
        item: "kit.ai-setup.kit-graph",
        reason: "no-qualification",
        cell: "windows-arm64",
      }),
      expect.objectContaining({
        item: "kit.mcp.kit-graph",
        cli: "codex",
        reason: "no-qualification",
      }),
    ]);
  });

  it("takes the latest qualified run, then the lowest sha256, over blocked and older ones", async () => {
    const old = kitQualification({ date: "2026-10-01", run: h("1") });
    const newer = kitQualification({ date: "2026-11-02", run: h("2") });
    const twin = kitQualification({ date: "2026-11-02", run: h("3") });
    const blocked = kitQualification({ status: "blocked", date: "2026-11-03", run: h("4") });
    const plan = await toolPlan([old, newer, twin, blocked]);
    expect(plan.status).toBe("ok");
    const lowest = [shaOf(newer), shaOf(twin)].sort()[0];
    expect(acquired(plan).map((step) => step.qualification)).toEqual([lowest]);
  });

  it("acquires on Windows into its own cell folder with the console script there", async () => {
    const plan = await toolPlan(
      [kitQualification({ cell: "windows-x64" })],
      undefined,
      "windows-x64",
    );
    expect(plan.status).toBe("ok");
    expect(plan.plan[0]).toMatchObject({
      into: ".aihq/ai-setup/kit-graph/1.2.3/windows-x64/",
      executable: ".aihq/ai-setup/kit-graph/1.2.3/windows-x64/Scripts/kit-graph.exe",
    });
  });

  it("needs a platform cell and supplied records that read as qualifications", async () => {
    const content = await accepting();
    expect(
      planInstall(["kit.ai-setup.kit-graph"], [content], [profile("codex")], {
        scope: "project",
        data: null,
      }),
    ).toMatchObject({ status: "invalid", problems: [{ path: "options/cell" }] });
    expect(
      planInstall(["kit.ai-setup.kit-graph"], [content], [profile("codex")], {
        scope: "project",
        data: null,
        cell: "linux-x64",
        qualifications: [
          { ...kitQualification(), result: { status: "qualified", date: "2026-11-01" } } as never,
        ],
      }),
    ).toMatchObject({
      status: "invalid",
      problems: [{ path: "options/qualifications/0/result/run" }],
    });
  });
});

describe("an AI setup's MCP settings on each client", () => {
  it("writes the tool lists a client can restrict and warns where it cannot", async () => {
    const record = kitQualification();
    const content = await kitContent(
      { ...KIT_SETUP, qualifications: [shaOf(record)] },
      { enabledTools: ["query"], disabledTools: ["index"], startupSeconds: 30 },
    );
    const plan = planned(
      planInstall(
        ["kit.ai-setup.kit-graph"],
        [content],
        ["claude-code", "codex", "copilot", "kiro"].map(profile),
        {
          scope: "project",
          data: null,
          cell: "linux-x64",
          qualifications: [record as Qualification],
        },
      ),
    );
    const entries = Object.fromEntries(
      plan.plan
        .filter((step) => step.op === "merge")
        .map((step) => [
          (step as { clis: readonly string[] }).clis[0],
          (step as { entry: Record<string, unknown> }).entry,
        ]),
    );
    expect(entries.codex).toMatchObject({ enabled_tools: ["query"], disabled_tools: ["index"] });
    expect(entries.kiro).toMatchObject({ disabledTools: ["index"] });
    expect(entries.kiro?.enabledTools).toBeUndefined();
    expect(entries.copilot).toMatchObject({ tools: ["query"] });
    expect(entries["claude-code"]).not.toHaveProperty("tools");
    expect(plan.warnings).toEqual([
      { code: "mcp-timeouts-not-described", cli: "claude-code", items: ["kit.mcp.kit-graph"] },
      { code: "mcp-timeouts-not-described", cli: "codex", items: ["kit.mcp.kit-graph"] },
      { code: "mcp-timeouts-not-described", cli: "copilot", items: ["kit.mcp.kit-graph"] },
      { code: "mcp-timeouts-not-described", cli: "kiro", items: ["kit.mcp.kit-graph"] },
      { code: "mcp-tools-unrestricted", cli: "claude-code", items: ["kit.mcp.kit-graph"] },
    ]);
    expect(plan.status).toBe("ok");
  });
});

describe("an explicit upstream installer", () => {
  it("is never offered by default, and when chosen is one unmanaged, approval-requiring step", async () => {
    const content = await accepting();
    const plan = planned(
      planInstall(["kit.ai-setup.kit-graph"], [content], [profile("codex")], {
        scope: "project",
        data: null,
        cell: "linux-x64",
        upstreamInstallers: ["kit.ai-setup.kit-graph"],
      }),
    );
    expect(plan.status).toBe("ok");
    expect(plan.plan).toEqual([
      {
        op: "upstream-installer",
        aiSetup: "kit.ai-setup.kit-graph",
        argv: ["kit-graph", "install"],
        managed: false,
        scanned: false,
        approval: "required",
      },
    ]);
    expect(plan.unavailable).toEqual([]);
    expect(plan.warnings).toEqual([
      { code: "unmanaged", aiSetup: "kit.ai-setup.kit-graph", items: ["kit.ai-setup.kit-graph"] },
    ]);
  });

  it("names a selected AI setup", async () => {
    const content = await accepting();
    expect(
      planInstall(["kit.mcp.kit-graph", "kit.ai-setup.kit-graph"], [content], [profile("codex")], {
        scope: "project",
        data: null,
        cell: "linux-x64",
        upstreamInstallers: ["kit.mcp.kit-graph"],
      }),
    ).toMatchObject({ status: "invalid", problems: [{ path: "options/upstreamInstallers/0" }] });
  });
});

const ARCHIVE = {
  version: "0.9.0",
  distributions: [
    {
      cells: ["linux-x64"],
      kind: "native-archive",
      file: "kit-linux-x64.tar.gz",
      url: "https://example.invalid/kit-linux-x64.tar.gz",
      sha256: h("5"),
      bytes: 2048,
      members: [
        { path: "LICENSE", sha256: h("6"), executable: false },
        { path: "kit-graph", sha256: h("7"), executable: true },
        { path: "install.sh", sha256: h("8"), executable: true },
      ],
    },
    {
      cells: ["darwin-arm64"],
      kind: "npm",
      file: "kit-graph-0.9.0.tgz",
      sha256: h("4"),
      bytes: 512,
      integrity: "sha512-AAAA",
    },
  ],
  executable: "kit-graph",
  launch: { args: ["--ui=false"] },
  mcpItem: "kit.mcp.kit-graph",
  settings: { commands: [], files: [] },
  doNotRun: [["kit-graph", "install"], ["install.sh"]],
  qualifications: [] as string[],
};
const archiveRecord = (
  members: { path: string; sha256: string; executable: boolean }[],
  cell = "linux-x64",
) => ({
  schema: QUALIFICATION,
  subject: { aiSetup: "kit.ai-setup.kit-graph", version: "0.9.0", cell },
  observed: {
    artifact:
      cell === "linux-x64"
        ? { file: "kit-linux-x64.tar.gz", sha256: h("5"), bytes: 2048 }
        : { file: "kit-graph-0.9.0.tgz", sha256: h("4"), bytes: 512 },
    ...(cell === "linux-x64" ? { members } : {}),
    closure: null,
    interpreter: null,
  },
  result: { status: "qualified", run: h("9"), date: "2026-10-27" },
});

describe("a native archive and an npm artifact", () => {
  it("runs the archive's executable member, and every member must match", async () => {
    const members = ARCHIVE.distributions[0]?.members ?? [];
    const good = archiveRecord([...members]);
    const changed = archiveRecord(
      members.map((member) =>
        member.path === "install.sh" ? { ...member, sha256: h("0") } : member,
      ),
    );
    for (const [record, ok] of [
      [good, true],
      [changed, false],
    ] as const) {
      const content = await kitContent({ ...ARCHIVE, qualifications: [shaOf(record)] });
      const plan = planned(
        planInstall(["kit.ai-setup.kit-graph"], [content], [profile("codex")], {
          scope: "user",
          data: null,
          cell: "linux-x64",
          qualifications: [record as Qualification],
        }),
      );
      if (!ok) {
        expect(plan.unavailable).toEqual([
          expect.objectContaining({ reason: "not-qualified", cause: "artifact-mismatch" }),
          UNACQUIRED_MCP,
        ]);
        continue;
      }
      expect(plan.status).toBe("ok");
      expect(plan.plan[0]).toEqual({
        op: "acquire",
        aiSetup: "kit.ai-setup.kit-graph",
        version: "0.9.0",
        cell: "linux-x64",
        root: "user",
        into: ".aihq/ai-setup/kit-graph/0.9.0/linux-x64/",
        distribution: {
          kind: "native-archive",
          file: "kit-linux-x64.tar.gz",
          url: "https://example.invalid/kit-linux-x64.tar.gz",
          sha256: h("5"),
          bytes: 2048,
          members,
        },
        executable: ".aihq/ai-setup/kit-graph/0.9.0/linux-x64/kit-graph",
        qualification: shaOf(record),
        scanned: false,
      });
      expect(plan.plan.find((step) => step.op === "merge")).toMatchObject({
        root: "user",
        entry: {
          command: ".aihq/ai-setup/kit-graph/0.9.0/linux-x64/kit-graph",
          args: ["--ui=false"],
        },
      });
      expect(JSON.stringify(plan.plan)).not.toContain('"install.sh"]');
    }
  });

  it("installs an npm artifact without lifecycle scripts", async () => {
    const record = archiveRecord([], "darwin-arm64");
    const content = await kitContent({ ...ARCHIVE, qualifications: [shaOf(record)] });
    const plan = planned(
      planInstall(["kit.ai-setup.kit-graph"], [content], [profile("codex")], {
        scope: "project",
        data: null,
        cell: "darwin-arm64",
        qualifications: [record as Qualification],
      }),
    );
    expect(plan.status).toBe("ok");
    expect(plan.plan[0]).toMatchObject({
      distribution: { kind: "npm", integrity: "sha512-AAAA" },
      executable: ".aihq/ai-setup/kit-graph/0.9.0/darwin-arm64/node_modules/.bin/kit-graph",
      ignoreScripts: true,
    });
  });
});

const DECK = {
  ...ARCHIVE,
  mcpItem: "deck.mcp.deck-graph",
  executable: "deck-graph",
  distributions: [
    {
      ...ARCHIVE.distributions[0],
      members: [{ path: "deck-graph", sha256: h("7"), executable: true }],
    },
  ],
};
const deckRecord = {
  ...archiveRecord([{ path: "deck-graph", sha256: h("7"), executable: true }]),
  subject: { aiSetup: "deck.ai-setup.deck-graph", version: "0.9.0", cell: "linux-x64" },
};
const DATA_A = { repository: "https://example.invalid/catalog-data", commit: "a".repeat(40) };
const pin = (fw: string) => ({ repository: `https://example.invalid/${fw}`, commit: COMMIT });
const comboRecord = (
  members: readonly unknown[],
  status: "qualified" | "blocked" = "qualified",
) => ({
  schema: QUALIFICATION,
  subject: { recipe: "kit-deck", cell: "linux-x64" },
  observed: { qualifications: members.map(shaOf).sort() },
  result: {
    status,
    ...(status === "blocked" ? { reason: "the two servers share one daemon port" } : {}),
    run: h("8"),
    date: "2026-11-03",
  },
});
const trio = (combo: unknown | undefined, data = DATA_A) => ({
  schema: "urn:aihq:catalog:recipe:0.1.0",
  id: "kit-deck",
  kind: "combination" as const,
  frameworks: ["deck", "kit"],
  content: { deck: pin("deck"), kit: pin("kit") },
  routes: {},
  members: [
    { item: "deck.ai-setup.deck-graph", preTicked: true },
    { item: "kit.ai-setup.kit-graph", preTicked: true },
  ],
  aiSetup: { "kit.ai-setup.kit-graph": { disabledTools: ["index"], env: { KIT_MODE: "trio" } } },
  ...(combo !== undefined ? { qualifications: { "linux-x64": shaOf(combo) } } : {}),
  data,
});

describe("a combination recipe", () => {
  const kitOld = kitQualification({ date: "2026-10-01", run: h("1") });
  const kitNew = kitQualification({ date: "2026-11-02", run: h("2") });

  async function trioPlan(
    recipe: unknown,
    supplied: readonly unknown[],
    extra: Record<string, unknown> = {},
  ) {
    const kit = await kitContent({
      ...KIT_SETUP,
      qualifications: [shaOf(kitOld), shaOf(kitNew)].sort(),
    });
    const deck = await kitContent({ ...DECK, qualifications: [shaOf(deckRecord)] }, {}, "deck");
    return planned(
      planRecipe(
        recipe as never,
        [deck, kit],
        [profile("codex")],
        {},
        {
          scope: "project",
          source: { repository: "https://example.invalid/recipes", commit: "c".repeat(40) },
          cell: "linux-x64",
          qualifications: supplied as Qualification[],
          ...extra,
        },
      ),
    );
  }

  it("uses exactly the member qualifications its own qualification lists, with its changes", async () => {
    const combo = comboRecord([kitOld, deckRecord]);
    const plan = await trioPlan(trio(combo), [kitOld, kitNew, deckRecord, combo]);
    expect(plan.unavailable).toEqual([]);
    expect(plan.status).toBe("ok");
    expect(acquired(plan).map((step) => step.qualification)).toEqual([
      shaOf(deckRecord),
      shaOf(kitOld),
    ]);
    const kitEntry = plan.plan.find(
      (step) => step.op === "merge" && step.item === "kit.mcp.kit-graph",
    ) as { entry: Record<string, unknown> };
    expect(kitEntry.entry).toEqual({
      command: `${INTO}bin/kit-graph`,
      args: ["serve"],
      env: { KIT_MODE: "trio", KIT_TELEMETRY: "off" },
      disabled_tools: ["index"],
    });
    // Tools are not mixed content: no duplicate resolver or report.
    expect(plan.duplicates).toEqual([]);
    expect(JSON.stringify(plan.plan)).not.toContain("duplicate");
    expect(plan.plan.map((step) => step.op)).toEqual([
      "acquire",
      "acquire",
      "write",
      "write",
      "merge",
      "merge",
      "tool-command",
    ]);
  });

  it("is unavailable on a cell without its own qualified record, whatever its members say", async () => {
    const missing = await trioPlan(trio(undefined), [kitNew, deckRecord]);
    expect(missing.status).toBe("incomplete");
    expect(missing.unavailable).toEqual([
      expect.objectContaining({
        recipe: "kit-deck",
        cell: "linux-x64",
        reason: "no-qualification",
      }),
    ]);
    const blocked = comboRecord([kitOld, deckRecord], "blocked");
    const refusedCombo = await trioPlan(trio(blocked), [kitOld, deckRecord, blocked]);
    expect(refusedCombo.unavailable).toEqual([
      expect.objectContaining({
        recipe: "kit-deck",
        reason: "not-qualified",
        cause: "blocked",
        detail: "the two servers share one daemon port",
      }),
    ]);
  });

  it("refuses a listed member qualification that does not match the member's artifact", async () => {
    const stale = kitQualification({ artifact: h("f"), run: h("3") });
    const kit = await kitContent({ ...KIT_SETUP, qualifications: [shaOf(stale)] });
    const deck = await kitContent({ ...DECK, qualifications: [shaOf(deckRecord)] }, {}, "deck");
    const combo = comboRecord([stale, deckRecord]);
    const plan = planned(
      planRecipe(
        trio(combo) as never,
        [deck, kit],
        [profile("codex")],
        {},
        {
          scope: "project",
          source: { repository: "https://example.invalid/recipes", commit: "c".repeat(40) },
          cell: "linux-x64",
          qualifications: [stale, deckRecord, combo] as Qualification[],
        },
      ),
    );
    expect(plan.unavailable).toEqual([
      expect.objectContaining({
        item: "kit.ai-setup.kit-graph",
        reason: "not-qualified",
        cause: "artifact-mismatch",
      }),
      UNACQUIRED_MCP,
    ]);
  });

  it("leaves an unmanaged member out, without its settings or qualification", async () => {
    const combo = comboRecord([kitOld, deckRecord]);
    const plan = await trioPlan(trio(combo), [kitOld, deckRecord, combo], {
      upstreamInstallers: ["kit.ai-setup.kit-graph"],
    });
    expect(plan.status).toBe("ok");
    expect(acquired(plan).map((step) => step.qualification)).toEqual([shaOf(deckRecord)]);
    expect(plan.plan.some((step) => step.op === "merge" && step.item === "kit.mcp.kit-graph")).toBe(
      false,
    );
    expect(plan.plan.filter((step) => step.op === "upstream-installer")).toHaveLength(1);
    expect(plan.warnings).toContainEqual({
      code: "unmanaged",
      aiSetup: "kit.ai-setup.kit-graph",
      items: ["kit.ai-setup.kit-graph"],
    });
  });
});

describe("a new qualification in a data commit", () => {
  it("changes the plan without a library release or an item identity change", async () => {
    const blocked = kitQualification({
      status: "blocked",
      reason: "no interpreter download",
      run: h("1"),
    });
    const qualified = kitQualification({ date: "2026-11-03", run: h("2") });
    const before = await accepting(blocked);
    const after = await accepting(blocked, qualified);
    const DATA_B = { ...DATA_A, commit: "b".repeat(40) };
    const recipe = (data: typeof DATA_A) => ({
      schema: "urn:aihq:catalog:recipe:0.1.0",
      id: "kit-base",
      kind: "base",
      framework: "kit",
      content: pin("kit"),
      routes: {},
      members: [{ item: "kit.ai-setup.kit-graph", preTicked: true }],
      data,
    });
    const plan = (content: unknown, data: typeof DATA_A, records: readonly unknown[]) =>
      planned(
        planRecipe(
          recipe(data) as never,
          [content as never],
          [profile("codex")],
          {},
          {
            scope: "project",
            source: { repository: "https://example.invalid/recipes", commit: "c".repeat(40) },
            cell: "linux-x64",
            qualifications: records as Qualification[],
          },
        ),
      );
    const old = plan(before, DATA_A, [blocked]);
    expect(old.status).toBe("incomplete");
    expect(old.unavailable).toEqual([
      expect.objectContaining({ reason: "not-qualified", cause: "blocked" }),
      UNACQUIRED_MCP,
    ]);
    const updated = plan(after, DATA_B, [blocked, qualified]);
    expect(updated.status).toBe("ok");
    expect(updated.data).toEqual(DATA_B);
    expect(acquired(updated).map((step) => step.qualification)).toEqual([shaOf(qualified)]);
    const item = (content: typeof before) =>
      content.items.find((entry) => entry.kind === "ai-setup");
    expect(item(after)?.contentSha256).toBe(item(before)?.contentSha256);
    expect(item(after)?.behaviourSha256).toBe(item(before)?.behaviourSha256);
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(pkg.version).toBe("0.0.0-dev.1");
  });
});

/** Where the kit setup writes its settings file: its own settings folder. */
const SETTINGS_PATH = ".aihq/ai-setup/kit-graph/settings/kit.yml";

describe("settings files and licence notices", () => {
  it("reports an AI setup record that is not plain data", async () => {
    await expect(kitContent({ ...KIT_SETUP, mcpItem: undefined })).rejects.toThrow(
      /plain JSON data/,
    );
  });

  it("writes an item file as a setting only where declared, and warns about a licence to accept", async () => {
    const read = readLocalSource(folder({ "kit.yml": "watch: false\n" }, "kit-settings"));
    if (read.status !== "ok") throw new Error("read");
    const record = kitQualification();
    const settingsFile = read.files[0];
    const { mcpItem: _mcpItem, ...withoutMcp } = KIT_SETUP;
    const built = await buildContent(
      { kind: "git", repository: "https://example.invalid/kit", commit: COMMIT },
      read.files,
      [
        {
          id: "kit.ai-setup.kit-graph",
          kind: "ai-setup",
          name: "kit-graph",
          description: "Kit's code graph, as a pinned executable.",
          aiSetup: {
            ...withoutMcp,
            settings: {
              commands: [],
              files: [{ sourcePath: "kit.yml", root: "user", path: SETTINGS_PATH }],
            },
            licenceNotice: "Noncommercial use only.",
            qualifications: [shaOf(record)],
          },
          files: [
            {
              sourceId: "kit",
              sourcePath: "kit.yml",
              sha256: settingsFile?.sha256 as string,
              executable: false,
              role: "behaviour",
            },
          ],
        },
      ],
      { framework: "kit" },
    );
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    expect(built.content.items[0]?.scanKey).toMatch(/^git-sha1:/);
    const plan = planned(
      planInstall(["kit.ai-setup.kit-graph"], [built.content], [profile("codex")], {
        scope: "project",
        data: null,
        cell: "linux-x64",
        qualifications: [record as Qualification],
      }),
    );
    expect(plan.status).toBe("ok");
    expect(plan.plan.filter((step) => step.op === "write")).toEqual([
      {
        op: "write",
        root: "user",
        path: SETTINGS_PATH,
        from: {
          item: "kit.ai-setup.kit-graph",
          sourceId: "kit",
          sourcePath: "kit.yml",
          sha256: settingsFile?.sha256,
        },
        executable: false,
        item: "kit.ai-setup.kit-graph",
        clis: ["codex"],
      },
    ]);
    expect(plan.warnings).toEqual([
      {
        code: "licence-notice",
        aiSetup: "kit.ai-setup.kit-graph",
        items: ["kit.ai-setup.kit-graph"],
      },
    ]);
  });
});

describe("what an AI setup may run and write", () => {
  const command = (argv: string[]) => ({
    argv,
    readback: { argv: ["config", "get", "watch"], expected: "false" },
    restore: { argv: ["config", "set", "watch", "<prior>"] },
  });

  it("refuses a launch or settings command that starts an installer the record never runs", async () => {
    await expect(
      kitContent({ ...KIT_SETUP, launch: { args: ["install", "--yes"] } }),
    ).rejects.toThrow(/doNotRun|never runs/);
    await expect(
      kitContent({
        ...KIT_SETUP,
        launch: { args: ["serve"], clis: { codex: ["install"] } },
      }),
    ).rejects.toThrow(/doNotRun|never runs/);
    await expect(
      kitContent({
        ...KIT_SETUP,
        settings: { commands: [command(["install"])], files: [] },
      }),
    ).rejects.toThrow(/doNotRun|never runs/);
  });

  it("refuses a settings file outside the setup's own settings folder", async () => {
    for (const path of [
      ".kit/kit.yml",
      ".claude/settings.json",
      ".aihq/ai-setup/kit-graph/1.2.3/linux-x64/bin/kit-graph",
    ])
      await expect(
        kitContent({
          ...KIT_SETUP,
          settings: { commands: [], files: [{ sourcePath: "server.json", root: "user", path }] },
        }),
        path,
      ).rejects.toThrow(/settings file is written under/);
  });

  it("refuses a recipe's settings command that starts such an installer", async () => {
    const record = kitQualification();
    const content = await accepting(record);
    const plan = planRecipe(
      {
        schema: "urn:aihq:catalog:recipe:0.1.0",
        id: "kit-base",
        kind: "base",
        framework: "kit",
        content: { repository: "https://example.invalid/kit", commit: COMMIT },
        routes: {},
        members: [{ item: "kit.ai-setup.kit-graph", preTicked: true }],
        aiSetup: {
          "kit.ai-setup.kit-graph": {
            settings: { commands: [command(["install"])], files: [] },
          },
        },
        data: DATA_A,
      } as never,
      [content],
      [profile("codex")],
      {},
      {
        scope: "project",
        source: { repository: "https://example.invalid/recipes", commit: "c".repeat(40) },
        cell: "linux-x64",
        qualifications: [record as Qualification],
      },
    );
    expect(plan).toMatchObject({ status: "invalid" });
  });

  it("runs a recipe's own settings commands without the standalone qualification", async () => {
    const record = kitQualification();
    const content = await accepting(record);
    const plan = planned(
      planRecipe(
        {
          schema: "urn:aihq:catalog:recipe:0.1.0",
          id: "kit-base",
          kind: "base",
          framework: "kit",
          content: { repository: "https://example.invalid/kit", commit: COMMIT },
          routes: {},
          members: [{ item: "kit.ai-setup.kit-graph", preTicked: true }],
          aiSetup: {
            "kit.ai-setup.kit-graph": {
              settings: { commands: [command(["config", "set", "watch", "true"])], files: [] },
            },
          },
          data: DATA_A,
        } as never,
        [content],
        [profile("codex")],
        {},
        {
          scope: "project",
          source: { repository: "https://example.invalid/recipes", commit: "c".repeat(40) },
          cell: "linux-x64",
          qualifications: [record as Qualification],
        },
      ),
    );
    const commands = plan.plan.filter((step) => step.op === "tool-command");
    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toHaveProperty("qualification");
  });
});

describe("a recipe's settings files for an AI setup", () => {
  it("refuses a settings file the AI setup does not have, instead of skipping it", async () => {
    const record = kitQualification();
    const content = await accepting(record);
    const plan = planRecipe(
      {
        schema: "urn:aihq:catalog:recipe:0.1.0",
        id: "kit-base",
        kind: "base",
        framework: "kit",
        content: { repository: "https://example.invalid/kit", commit: COMMIT },
        routes: {},
        members: [{ item: "kit.ai-setup.kit-graph", preTicked: true }],
        aiSetup: {
          "kit.ai-setup.kit-graph": {
            settings: {
              commands: [],
              files: [{ sourcePath: "absent.yml", root: "user", path: SETTINGS_PATH }],
            },
          },
        },
        data: DATA_A,
      } as never,
      [content],
      [profile("codex")],
      {},
      {
        scope: "project",
        source: { repository: "https://example.invalid/recipes", commit: "c".repeat(40) },
        cell: "linux-x64",
        qualifications: [record as Qualification],
      },
    );
    expect(plan).toMatchObject({
      status: "invalid",
      problems: [expect.objectContaining({ message: "names no file of the AI setup" })],
    });
  });
});

describe("an AI setup's distribution URL", () => {
  it("refuses a URL that carries credentials", async () => {
    const [distribution] = KIT_SETUP.distributions;
    for (const url of [
      "https://user:secret@example.invalid/kit.whl",
      "https://token@example.invalid/kit.whl",
    ])
      await expect(
        kitContent({ ...KIT_SETUP, distributions: [{ ...distribution, url }] }),
        url,
      ).rejects.toThrow(/url/);
  });
});
