import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/release/json.js";
import {
  GRAPH_JSON,
  GRAPH_SERVER_SOURCE,
  NATIVE_BUNDLE_ID,
  NATIVE_BUNDLE_ITEM_ID,
  NATIVE_BUNDLES_RELEASE_PATH,
  NATIVE_FIXTURE_ITEM_ID,
  NATIVE_FIXTURE_RELEASE_PATH,
  nativeTreeDigest,
  renderNativeFixture,
} from "../../src/release/native-fixture-content.js";
import { RECORDER_ORIGIN, RECORDER_SOURCE } from "../../src/release/native-recorder-pin.js";
import { renderedItemSha256 } from "../../src/release/project-context.js";
import { listItems, readRelease } from "../../src/release/reader.js";
import { sha256 } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const bytesAt = (path: string) => readFileSync(resolve(root, path));
const jsonAt = (path: string) => JSON.parse(bytesAt(path).toString("utf8"));
const pkg = jsonAt("package.json") as { name: string; version: string };

// The two earlier documents must stay byte-identical to the base this work started from.
const RELEASE_1_0_SHA256 = "aabdf1fb75d4798c6da5aeda728c4c9150f37de0e618fb0e8048f7088309a100";
const RELEASE_1_1_SHA256 = "cfc610dc039041e2f6c8a578aaa3a7314bb7baa2776dc48be99836a601e0bf97";
const MARKER = "52d3da7194106025ec9a9760ccbda34b6449c97efa271ac2659df903869a87d9";

const checked = (path: string) => {
  const bytes = bytesAt(path);
  const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  return result.release;
};
const rendered = renderNativeFixture(pkg);
const archiveFile = (member: string) => {
  expect(member.startsWith("package/")).toBe(true);
  const bytes = rendered.files.get(member.slice("package/".length));
  expect(bytes, member).toBeDefined();
  return Buffer.from(bytes as Uint8Array);
};

describe("native fixture release documents", () => {
  it("are exactly what the generator produces", () => {
    if (!existsSync(resolve(root, "dist/release/native-fixture-content.js")))
      throw new Error("run npm run build:dist first");
    const output = execFileSync(process.execPath, ["tools/generate-release.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain("release/release-native-fixture.json");
    expect(output).toContain("release/release-native-bundles.json");
  });

  it("reproduce byte for byte from the portable renderer", () => {
    for (const [path, bytes] of rendered.files) {
      expect(bytesAt(path).equals(Buffer.from(bytes)), path).toBe(true);
    }
  });

  it("leave the 1.0 and 1.1 releases byte-identical", () => {
    expect(sha256(bytesAt("release/release.json"))).toBe(RELEASE_1_0_SHA256);
    expect(sha256(bytesAt("release/release-1.1.json"))).toBe(RELEASE_1_1_SHA256);
  });

  it("are 1.0 releases of this package with one authored item each", () => {
    for (const [path, id, kind] of [
      [NATIVE_FIXTURE_RELEASE_PATH, NATIVE_FIXTURE_ITEM_ID, "mcp-server"],
      [NATIVE_BUNDLES_RELEASE_PATH, NATIVE_BUNDLE_ITEM_ID, "native-verification-bundle"],
    ] as const) {
      const release = checked(path);
      expect(release.schema).toBe("urn:aihq:catalog:release:1.0.0");
      expect(release.package).toEqual({ name: pkg.name, version: pkg.version });
      expect(release.sources).toHaveLength(1);
      expect(release.sources[0]?.origin).toEqual({ kind: "authored" });
      const items = listItems(release);
      expect(items.map((item) => item.id)).toEqual([id]);
      expect(items[0]).toMatchObject({
        kind,
        scopes: ["project"],
        inputs: {},
        dependencies: { requires: [], optional: [], conflicts: [] },
      });
      expect(items[0]?.recipe.schema).toBe("urn:aihq:core:recipe:1.0.0");
    }
  });

  it("are exported as package files", () => {
    expect(pkg).toMatchObject({
      exports: {
        "./release-native-fixture.json": "./release/release-native-fixture.json",
        "./release-native-bundles.json": "./release/release-native-bundles.json",
      },
    });
  });
});

describe("the graph fixture recipe", () => {
  const item = listItems(checked(NATIVE_FIXTURE_RELEASE_PATH))[0];
  const recipe = JSON.parse(bytesAt(item?.recipe.path as string).toString("utf8"));
  const target = (...segments: string[]) => ({
    root: "project",
    segments: segments.map((literal) => ({ literal })),
  });

  it("writes three pinned files, one project-scope MCP entry and one owned instruction block", () => {
    expect(recipe.prerequisites).toEqual([{ kind: "executable", name: "node" }]);
    expect(item?.targets).toEqual(recipe.prerequisites);
    expect(recipe.targets).toEqual(["project"]);
    expect(recipe.operations.map((op: { kind: string }) => op.kind)).toEqual([
      "file.write",
      "file.write",
      "file.write",
      "config.entries",
      "text.block",
    ]);
    const writes = recipe.operations.filter((op: { kind: string }) => op.kind === "file.write");
    expect(writes.map((op: { target: unknown }) => op.target)).toEqual([
      target(".aihq", "graph-fixture", "graph-server.mjs"),
      target(".aihq", "graph-fixture", "graph.json"),
      target(".aihq-native", "recorder.mjs"),
    ]);
    const config = recipe.operations.find((op: { kind: string }) => op.kind === "config.entries");
    expect(config).toMatchObject({
      scope: "project",
      format: "json",
      target: target(".mcp.json"),
      entries: [
        {
          path: ["mcpServers", "aihq-graph-fixture"],
          action: "set",
          value: {
            literal: {
              type: "stdio",
              command: "node",
              args: [
                ".aihq-native/recorder.mjs",
                "--",
                "node",
                ".aihq/graph-fixture/graph-server.mjs",
              ],
            },
          },
        },
      ],
    });
    // The server is registered only after the files it names exist.
    expect(config.requires).toHaveLength(3);
  });

  it("owns its own instruction block and never the shared context block", () => {
    const block = recipe.operations.find((op: { kind: string }) => op.kind === "text.block");
    expect(block).toMatchObject({
      scope: "project",
      target: target("CLAUDE.md"),
      blockId: "aihq-graph-fixture",
      action: "set",
    });
    expect(block.startMarker).toContain("aihq:graph-fixture");
    expect(block.endMarker).toContain("aihq:graph-fixture");
    const shared = jsonAt("release/recipes/aihq.project-context-pointer.claude-md.json");
    const sharedBlock = shared.operations[0];
    expect(sharedBlock.blockId).not.toBe(block.blockId);
    expect(sharedBlock.startMarker).not.toBe(block.startMarker);
    expect(block.startMarker.includes(sharedBlock.startMarker)).toBe(false);
    expect(block.content.literal).toContain(MARKER);
  });

  it("checks the hash of every written file", () => {
    const checks = recipe.checks.filter((check: { kind: string }) => check.kind === "file.sha256");
    expect(checks.map((check: { sha256: string }) => check.sha256).sort()).toEqual(
      item?.materials.map((material) => material.sha256).sort(),
    );
    const checkIds = recipe.operations.flatMap((op: { checks: string[] }) => op.checks);
    expect(checkIds.sort()).toEqual(recipe.checks.map((check: { id: string }) => check.id).sort());
  });

  it("delivers the Core recorder program unmodified", () => {
    const material = item?.materials.find((member) => member.id === "recorder");
    const bytes = bytesAt(material?.path as string);
    expect(bytes.toString("utf8")).toBe(RECORDER_SOURCE);
    expect(sha256(bytes)).toBe(RECORDER_ORIGIN.sha256);
    expect(bytes.length).toBe(RECORDER_ORIGIN.byteLength);
    expect(material?.sha256).toBe(RECORDER_ORIGIN.sha256);
    expect(item?.metadata).toMatchObject({
      recorder: { coreVersion: RECORDER_ORIGIN.coreVersion },
    });
  });
});

describe("the bundle declaration", () => {
  const fixtureItem = listItems(checked(NATIVE_FIXTURE_RELEASE_PATH))[0];
  const bundleItem = listItems(checked(NATIVE_BUNDLES_RELEASE_PATH))[0];
  const bundleMaterial = bundleItem?.materials.find((member) => member.id === "bundle");
  const bundle = JSON.parse(bytesAt(bundleMaterial?.path as string).toString("utf8"));

  it("ships the bundle as an ordinary declared material with a recipe that writes only it", () => {
    expect(bundleMaterial?.sha256).toBe(sha256(Buffer.from(rendered.bundleBytes)));
    const recipe = jsonAt(bundleItem?.recipe.path as string);
    expect(recipe.operations).toHaveLength(1);
    expect(recipe.operations[0]).toMatchObject({
      kind: "file.write",
      material: "bundle",
      target: {
        root: "project",
        segments: [
          { literal: ".aihq-native" },
          { literal: "verification" },
          { literal: `${NATIVE_BUNDLE_ID}.json` },
        ],
      },
    });
    expect(bundleItem?.materials.map((member) => member.id)).toEqual([
      "bundle",
      "expected-claude-md",
      "expected-mcp-json",
    ]);
  });

  it("uses the closed Core bundle shape for the Claude test configuration", () => {
    expect(Object.keys(bundle).sort()).toEqual(
      [
        "schema",
        "id",
        "client",
        "adapterId",
        "scope",
        "package",
        "release",
        "selection",
        "startingTree",
        "startingTreeSha256",
        "outputTree",
        "outputTreeSha256",
        "instructions",
        "server",
      ].sort(),
    );
    expect(bundle).toMatchObject({
      schema: "urn:aihq:core:native-verification-bundle:1.0.0",
      id: NATIVE_BUNDLE_ID,
      client: "claude",
      adapterId: "claude-stream-json.v1",
      scope: "test-configuration",
      package: { name: pkg.name, version: pkg.version },
      startingTree: [],
    });
    expect(Object.keys(bundle.server).sort()).toEqual(
      [
        "name",
        "transport",
        "runtime",
        "evidenceAdapterId",
        "observation",
        "recorder",
        "toolNames",
        "queryTool",
        "queryArguments",
        "challenge",
        "expectedResultSha256",
        "expectedAnswer",
      ].sort(),
    );
    expect(bundle.server).toMatchObject({
      name: "aihq-graph-fixture",
      transport: "stdio",
      evidenceAdapterId: "aihq.stdio-recorder.v1",
      observation: "recorder",
      toolNames: ["aihq_attest_instruction", "aihq_graph_callees"],
      queryTool: "aihq_graph_callees",
      queryArguments: { symbol: "loadConfig" },
      challenge: { mode: "rpc-id" },
      expectedAnswer: "readFile",
    });
  });

  it("pins the release, item and recipe the bundle selects", () => {
    const releaseBytes = bytesAt(NATIVE_FIXTURE_RELEASE_PATH);
    expect(bundle.release).toEqual({
      path: `package/${NATIVE_FIXTURE_RELEASE_PATH}`,
      sha256: sha256(releaseBytes),
      byteLength: releaseBytes.length,
    });
    const record = jsonAt(NATIVE_FIXTURE_RELEASE_PATH).items[0];
    expect(bundle.selection.itemId).toBe(NATIVE_FIXTURE_ITEM_ID);
    expect(bundle.selection.itemSha256).toBe(renderedItemSha256(record));
    expect(bundle.selection.itemSha256).toBe(fixtureItem?.itemSha256);
    expect(bundle.selection.inputs).toEqual({});
    const recipeBytes = bytesAt(fixtureItem?.recipe.path as string);
    expect(bundle.selection.recipe).toEqual({
      path: `package/${fixtureItem?.recipe.path}`,
      sha256: sha256(recipeBytes),
      byteLength: recipeBytes.length,
    });
  });

  it("resolves every member to rendered archive bytes with the pinned hash and length", () => {
    const members = [
      bundle.release,
      bundle.selection.recipe,
      ...bundle.startingTree.map((file: { member: unknown }) => file.member),
      ...bundle.outputTree.map((file: { member: unknown }) => file.member),
      ...bundle.server.runtime,
      bundle.server.recorder,
    ] as { path: string; sha256: string; byteLength: number }[];
    for (const member of members) {
      const bytes = archiveFile(member.path);
      expect(sha256(bytes), member.path).toBe(member.sha256);
      expect(bytes.length, member.path).toBe(member.byteLength);
      expect(member.byteLength).toBeGreaterThan(0);
    }
  });

  it("pins the complete empty-start output tree and both tree digests", () => {
    expect(bundle.startingTree).toEqual([]);
    expect(bundle.startingTreeSha256).toBe(sha256(Buffer.from("[]")));
    const paths = bundle.outputTree.map((file: { path: string }) => file.path);
    expect(paths).toEqual([
      ".aihq-native/recorder.mjs",
      ".aihq/graph-fixture/graph-server.mjs",
      ".aihq/graph-fixture/graph.json",
      ".mcp.json",
      "CLAUDE.md",
    ]);
    expect(bundle.outputTree.every((file: { root: string }) => file.root === "project")).toBe(true);
    const entries = bundle.outputTree
      .map(
        (file: { root: string; path: string; member: { sha256: string; byteLength: number } }) => ({
          root: file.root,
          path: file.path,
          sha256: file.member.sha256,
          byteLength: file.member.byteLength,
        }),
      )
      .sort((a: { path: string }, b: { path: string }) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
      );
    expect(bundle.outputTreeSha256).toBe(sha256(Buffer.from(canonicalJson(entries))));
    expect(nativeTreeDigest(bundle.outputTree)).toBe(bundle.outputTreeSha256);
    expect(nativeTreeDigest([])).toBe(bundle.startingTreeSha256);
  });

  it("binds each recipe-written output to the item's material bytes", () => {
    const byPath = new Map(
      bundle.outputTree.map((file: { path: string; member: { sha256: string } }) => [
        file.path,
        file.member.sha256,
      ]),
    );
    const material = (id: string) => fixtureItem?.materials.find((m) => m.id === id)?.sha256;
    expect(byPath.get(".aihq/graph-fixture/graph-server.mjs")).toBe(material("graph-server"));
    expect(byPath.get(".aihq/graph-fixture/graph.json")).toBe(material("graph-data"));
    expect(byPath.get(".aihq-native/recorder.mjs")).toBe(RECORDER_ORIGIN.sha256);
  });

  it("derives the configuration and instruction outputs from the recipe, not from a run", () => {
    const recipe = jsonAt(fixtureItem?.recipe.path as string);
    const config = recipe.operations.find((op: { kind: string }) => op.kind === "config.entries");
    // Core edits an absent JSON target by applying entries to `{}` plus LF with two-space indent.
    let text = "{}\n";
    for (const entry of config.entries) {
      text = applyEdits(
        text,
        modify(text, entry.path, entry.value.literal, {
          formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
        }),
      );
    }
    const mcp = bundle.outputTree.find((file: { path: string }) => file.path === ".mcp.json");
    expect(archiveFile(mcp.member.path).toString("utf8")).toBe(text);
    // Core inserts a block into an absent file as marker, content, marker and a final LF.
    const block = recipe.operations.find((op: { kind: string }) => op.kind === "text.block");
    const content: string = block.content.literal;
    const claude = bundle.outputTree.find((file: { path: string }) => file.path === "CLAUDE.md");
    expect(archiveFile(claude.member.path).toString("utf8")).toBe(
      `${block.startMarker}\n${content}${content.endsWith("\n") ? "" : "\n"}${block.endMarker}\n`,
    );
  });

  it("names one marker instruction in the project instruction file", () => {
    expect(bundle.instructions).toHaveLength(1);
    const [instruction] = bundle.instructions;
    const claude = bundle.outputTree.find((file: { path: string }) => file.path === "CLAUDE.md");
    expect(instruction).toEqual({
      root: "project",
      path: "CLAUDE.md",
      sha256: claude.member.sha256,
      evidence: "marker",
      markerSha256: sha256(Buffer.from(MARKER)),
    });
    const text = archiveFile(claude.member.path).toString("utf8");
    expect(text).toContain(MARKER);
    expect(text).toContain("aihq_attest_instruction");
    expect(text).toContain("aihq_graph_callees");
    expect(text).toContain("loadConfig");
    expect(text.match(/[0-9a-f]{64}/g)).toEqual([MARKER]);
  });

  it("limits the runtime to files the tree provides and pins the recorder path", () => {
    const tree = bundle.outputTree as { path: string; member: { path: string; sha256: string } }[];
    for (const member of bundle.server.runtime as { path: string; sha256: string }[]) {
      expect(
        tree.some(
          (file) => file.member.path === member.path && file.member.sha256 === member.sha256,
        ),
      ).toBe(true);
    }
    expect(bundle.server.runtime).toHaveLength(2);
    const recorder = tree.find((file) => file.path === ".aihq-native/recorder.mjs");
    expect(bundle.server.recorder).toMatchObject({
      path: recorder?.member.path,
      sha256: RECORDER_ORIGIN.sha256,
      byteLength: RECORDER_ORIGIN.byteLength,
    });
  });

  it("pins the fixed read-only query result before any execution", () => {
    const result = { content: [{ type: "text", text: "readFile" }], isError: false };
    expect(bundle.server.expectedResultSha256).toBe(sha256(Buffer.from(canonicalJson(result))));
  });

  it("agrees with the bundle item's own materials", () => {
    const expected = (id: string) => bundleItem?.materials.find((m) => m.id === id)?.sha256;
    const byPath = new Map(
      bundle.outputTree.map((file: { path: string; member: { sha256: string } }) => [
        file.path,
        file.member.sha256,
      ]),
    );
    expect(byPath.get(".mcp.json")).toBe(expected("expected-mcp-json"));
    expect(byPath.get("CLAUDE.md")).toBe(expected("expected-claude-md"));
  });
});

describe("the graph fixture server", () => {
  const fixtureItem = listItems(checked(NATIVE_FIXTURE_RELEASE_PATH))[0];
  const member = (id: string) =>
    bytesAt(fixtureItem?.materials.find((material) => material.id === id)?.path as string);

  /** Runs the delivered server once over stdio in a throwaway directory laid out like the project. */
  function exchange(lines: string[], graph: Buffer = member("graph-data")) {
    const dir = mkdtempSync(join(tmpdir(), "aih-graph-fixture-"));
    try {
      mkdirSync(join(dir, ".aihq", "graph-fixture"), { recursive: true });
      writeFileSync(
        join(dir, ".aihq", "graph-fixture", "graph-server.mjs"),
        member("graph-server"),
      );
      writeFileSync(join(dir, ".aihq", "graph-fixture", "graph.json"), graph);
      const run = spawnSync(process.execPath, [".aihq/graph-fixture/graph-server.mjs"], {
        cwd: dir,
        input: `${lines.join("\n")}\n`,
        encoding: "utf8",
        timeout: 20_000,
      });
      return {
        status: run.status,
        stderr: run.stderr,
        replies: run.stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const request = (id: unknown, method: string, params?: unknown) =>
    JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
  const callees = (id: unknown, args: unknown, name = "aihq_graph_callees") =>
    request(id, "tools/call", { name, arguments: args });

  it("answers initialize, ping, tools/list and the fixed query", () => {
    const run = exchange([
      request(1, "initialize", { protocolVersion: "2025-06-18" }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      request(2, "ping"),
      request(3, "tools/list"),
      callees("c".repeat(64), { symbol: "loadConfig" }),
    ]);
    expect(run.status).toBe(0);
    expect(run.replies).toHaveLength(4);
    expect(run.replies[0].result.capabilities).toEqual({ tools: {} });
    expect(run.replies[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    expect(run.replies[2].result.tools).toHaveLength(1);
    expect(run.replies[2].result.tools[0]).toMatchObject({
      name: "aihq_graph_callees",
      inputSchema: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
        additionalProperties: false,
      },
    });
    // The id is echoed unchanged, so the recorder's rpc-id challenge correlates.
    expect(run.replies[3]).toEqual({
      jsonrpc: "2.0",
      id: "c".repeat(64),
      result: { content: [{ type: "text", text: "readFile" }], isError: false },
    });
  });

  it("answers the other symbols from the fixed graph", () => {
    const run = exchange([
      callees(1, { symbol: "main" }),
      callees(2, { symbol: "parseArgs" }),
      callees(3, { symbol: "readFile" }),
    ]);
    expect(run.replies.map((reply) => reply.result.content[0].text)).toEqual([
      "parseArgs,loadConfig",
      "",
      "",
    ]);
  });

  it("refuses unknown symbols, wrong arguments, unknown tools and unknown methods", () => {
    const run = exchange([
      callees(1, { symbol: "missing" }),
      callees(2, { symbol: "__proto__" }),
      callees(3, { symbol: "constructor" }),
      callees(4, { symbol: "loadConfig", extra: true }),
      callees(5, {}),
      callees(6, { symbol: 7 }),
      callees(7, undefined),
      callees(8, { symbol: "loadConfig" }, "aihq_attest_instruction"),
      callees(9, { symbol: "loadConfig" }, "unknown_tool"),
      request(10, "resources/list"),
      request(11, "tools/call"),
      "{",
      JSON.stringify({ jsonrpc: "1.0", id: 12, method: "ping" }),
    ]);
    expect(run.status).toBe(0);
    expect(run.replies.every((reply) => reply.result === undefined)).toBe(true);
    expect(run.replies.map((reply) => reply.error.code)).toEqual([
      -32602, -32602, -32602, -32602, -32602, -32602, -32602, -32602, -32602, -32601, -32602,
      -32700, -32600,
    ]);
  });

  it("stops without a reply once a bound is exceeded", () => {
    const flood = Array.from({ length: 600 }, (_, index) => request(index, "ping"));
    const run = exchange(flood);
    expect(run.status).toBe(4);
    expect(run.replies.length).toBeLessThanOrEqual(512);
  });

  it("uses only Node built-ins, reads only its sibling graph and never writes or spawns", () => {
    const source = GRAPH_SERVER_SOURCE;
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["node:fs", "node:url"]);
    for (const forbidden of [
      "child_process",
      "node:net",
      "node:http",
      "fetch(",
      "writeFile",
      "appendFile",
      "unlink",
      "spawn",
      "exec(",
      "process.env",
      "eval(",
    ]) {
      expect(source.includes(forbidden), forbidden).toBe(false);
    }
    expect(member("graph-server").toString("utf8")).toBe(source);
    expect(member("graph-data").toString("utf8")).toBe(GRAPH_JSON);
    expect(JSON.parse(GRAPH_JSON)).toEqual({
      calls: {
        main: ["parseArgs", "loadConfig"],
        loadConfig: ["readFile"],
        parseArgs: [],
        readFile: [],
      },
    });
  });
});

describe("rendered native fixture content", () => {
  it("contains no machine path, drive letter or credential", () => {
    const drive = /(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/;
    const absolute = /(^|[\s"'`(=])\/(?:Users|home|tmp|var|private|mnt|opt|etc)\//;
    for (const [path, bytes] of rendered.files) {
      // The Core recorder is third-party text pinned as is; its own constants are not paths.
      const text = Buffer.from(bytes).toString("utf8");
      expect(drive.test(text), path).toBe(false);
      expect(absolute.test(text), path).toBe(false);
      expect(/[\\/]Users[\\/]/i.test(text), path).toBe(false);
      expect(/\b(?:sk-|ghp_|AKIA|BEGIN [A-Z ]*PRIVATE KEY)/.test(text), path).toBe(false);
    }
  });
});
