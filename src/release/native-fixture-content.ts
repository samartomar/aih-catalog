/**
 * Internal, portable renderer for the Claude graph-fixture preparation content: a
 * project-scope MCP item backed by a tiny Catalog-authored read-only graph server
 * (`release-native-fixture.json`) and the Core-owned `NativeVerificationBundle` that
 * pins it (`release-native-bundles.json`). The bundle pins the SHA-256 of the release
 * document and item it describes, so it cannot live in the document it pins.
 *
 * Every pin is computed here, before any execution: the expected output files follow
 * from the recipe and Core's documented edit rules (a JSON edit of an absent target
 * starts from `{}` plus LF with two-space indent; a text block in an absent file is
 * marker, content, marker and a final LF). Nothing is learned from a run.
 * `tools/generate-release.mjs` writes the result; no Node built-ins.
 *
 * The content is a fixture at test scope. It proves nothing about a production graph
 * server, about a client loading the configuration or about persistence.
 */
import type { Json } from "./contracts.js";
import { CORE_RECIPE_SCHEMA_ID } from "./contracts.js";
import { canonicalJson } from "./json.js";
import { RECORDER_ORIGIN, RECORDER_SOURCE } from "./native-recorder-pin.js";
import { renderedItemSha256 } from "./project-context.js";
import { sha256Hex } from "./sha256.js";

export const NATIVE_FIXTURE_SOURCE_ID = "aihq-native-fixtures";
export const NATIVE_FIXTURE_SOURCE = Object.freeze({
  id: NATIVE_FIXTURE_SOURCE_ID,
  origin: Object.freeze({ kind: "authored" }),
});

export const NATIVE_FIXTURE_ITEM_ID = "aihq.mcp.claude.graph-fixture";
export const NATIVE_BUNDLE_ITEM_ID = "aihq.native-bundle.claude.graph-fixture";
export const NATIVE_BUNDLE_ID = "aihq.catalog.claude.graph-fixture.v1";
export const NATIVE_FIXTURE_RELEASE_PATH = "release/release-native-fixture.json";
export const NATIVE_BUNDLES_RELEASE_PATH = "release/release-native-bundles.json";

const SERVER_NAME = "aihq-graph-fixture";
const QUERY_TOOL = "aihq_graph_callees";
const ATTEST_TOOL = "aihq_attest_instruction";
const RECORDER_PATH = ".aihq-native/recorder.mjs";
const SERVER_PATH = ".aihq/graph-fixture/graph-server.mjs";
const GRAPH_PATH = ".aihq/graph-fixture/graph.json";
/**
 * A fresh 256-bit public diagnostic marker, committed with the content. It lets a later
 * native session show it loaded this instruction; it is not a secret and unlocks nothing.
 */
const MARKER = "52d3da7194106025ec9a9760ccbda34b6449c97efa271ac2659df903869a87d9";
const BLOCK_ID = "aihq-graph-fixture";
const START_MARKER = "<!-- BEGIN aihq:graph-fixture -->";
const END_MARKER = "<!-- END aihq:graph-fixture -->";

const FIXTURE_DIR = `release/materials/aihq/native-fixtures/${NATIVE_FIXTURE_ITEM_ID}`;
const BUNDLE_DIR = `release/materials/aihq/native-bundles/${NATIVE_BUNDLE_ITEM_ID}`;
const encoder = new TextEncoder();
const documentBytes = (value: unknown): Uint8Array => encoder.encode(`${canonicalJson(value)}\n`);
const literalTarget = (segments: readonly string[]) => ({
  root: "project",
  segments: segments.map((segment) => ({ literal: segment })),
});
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const GRAPH_JSON = `${JSON.stringify(
  {
    calls: {
      main: ["parseArgs", "loadConfig"],
      loadConfig: ["readFile"],
      parseArgs: [],
      readFile: [],
    },
  },
  null,
  2,
)}\n`;

export const GRAPH_SERVER_SOURCE = String.raw`// AIHQ graph fixture: a read-only MCP stdio server over a small fixed call graph.
// Test scope only. It answers one query from the sibling graph.json and implements no
// attestation; the verifier's recorder does that. No network, writes or child processes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOOL = 'aihq_graph_callees';
const MAX_MESSAGES = 512;
const MAX_LINE = 262144;
const MAX_BYTES = 4194304;
const calls = JSON.parse(readFileSync(fileURLToPath(new URL('./graph.json', import.meta.url)), 'utf8')).calls;

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const fail = (id, code, text) => send({ jsonrpc: '2.0', id, error: { code, message: text } });

const tools = [{
  name: TOOL,
  description: 'List the functions that a function directly calls in the fixed fixture call graph.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false }
}];

const call = (id, params) => {
  if (!isRecord(params) || params.name !== TOOL) return fail(id, -32602, 'unknown tool');
  const args = params.arguments;
  if (!isRecord(args) || Object.keys(args).length !== 1 || typeof args.symbol !== 'string')
    return fail(id, -32602, 'invalid arguments');
  if (!Object.hasOwn(calls, args.symbol)) return fail(id, -32602, 'unknown symbol');
  send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: calls[args.symbol].join(',') }], isError: false } });
};

const handle = line => {
  let message;
  try { message = JSON.parse(line); } catch { return fail(null, -32700, 'parse error'); }
  if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
      (Object.hasOwn(message, 'id') && typeof message.id !== 'string' && !Number.isSafeInteger(message.id)))
    return fail(null, -32600, 'invalid request');
  if (!Object.hasOwn(message, 'id')) return;
  const { id, method, params } = message;
  if (method === 'initialize')
    return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: isRecord(params) && typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'aihq-graph-fixture', version: '1' } } });
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools } });
  if (method === 'tools/call') return call(id, params);
  fail(id, -32601, 'method not found');
};

let messages = 0;
let bytes = 0;
let buffer = '';
let stopped = false;
const stop = () => { stopped = true; process.exitCode = 4; process.stdin.destroy(); };
const accept = line => {
  if (stopped) return;
  messages += 1;
  bytes += Buffer.byteLength(line) + 1;
  if (messages > MAX_MESSAGES || bytes > MAX_BYTES || line.length > MAX_LINE) return stop();
  handle(line);
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while (!stopped && (index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    accept(line.endsWith('\r') ? line.slice(0, -1) : line);
  }
  if (!stopped && buffer.length > MAX_LINE) stop();
});
process.stdin.on('end', () => { if (buffer.length > 0) accept(buffer); });
`;

/** The `.mcp.json` entry value, written as the recipe's canonical (sorted-key) literal. */
const SERVER_ENTRY = Object.freeze({
  args: Object.freeze([RECORDER_PATH, "--", "node", SERVER_PATH]),
  command: "node",
  type: "stdio",
});

/** The block content the recipe sets, ending in LF so Core adds no extra newline. */
const INSTRUCTION = `# AIHQ graph fixture

This project is a disposable verification fixture. When asked to verify the session, do exactly this and nothing else:

1. Call the MCP tool \`${ATTEST_TOOL}\` with \`marker\` set to \`${MARKER}\` and \`challenge\` set to the session challenge from the prompt.
2. Call the MCP tool \`${QUERY_TOOL}\` with \`symbol\` set to \`loadConfig\`.
3. Reply with the text returned by \`${QUERY_TOOL}\` and the \`markerSha256\` returned by attestation.
`;

/** CLAUDE.md as Core produces it from an absent file: marker, content, marker, final LF. */
export const EXPECTED_CLAUDE_MD = `${START_MARKER}\n${INSTRUCTION}${END_MARKER}\n`;

/**
 * `.mcp.json` as Core's JSON edit produces it from an absent file: the entry is applied
 * to `{}` plus LF with two-space indent and the recipe's own (sorted) key order.
 */
export const EXPECTED_MCP_JSON = `${[
  "{",
  '  "mcpServers": {',
  `    ${JSON.stringify(SERVER_NAME)}: {`,
  '      "args": [',
  SERVER_ENTRY.args.map((argument) => `        ${JSON.stringify(argument)}`).join(",\n"),
  "      ],",
  '      "command": "node",',
  '      "type": "stdio"',
  "    }",
  "  }",
  "}",
].join("\n")}\n`;

interface TreeEntry {
  readonly root: string;
  readonly path: string;
  readonly member: { readonly sha256: string; readonly byteLength: number };
}

/** SHA-256 of canonical JSON over `{root,path,sha256,byteLength}`, sorted by root then path. */
export function nativeTreeDigest(tree: readonly TreeEntry[]): string {
  const entries = tree
    .map(({ root, path, member }) => ({
      root,
      path,
      sha256: member.sha256,
      byteLength: member.byteLength,
    }))
    .sort((a, b) => compare(a.root, b.root) || compare(a.path, b.path));
  return sha256Hex(encoder.encode(canonicalJson(entries)));
}

export interface RenderedNativeFixture {
  /** Every package-relative file (both release documents included) → bytes. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly bundle: Record<string, Json>;
  readonly bundleBytes: Uint8Array;
}

const member = (path: string, bytes: Uint8Array) => ({
  path: `package/${path}`,
  sha256: sha256Hex(bytes),
  byteLength: bytes.length,
});
const descriptor = (id: string, bytes: Uint8Array) => ({
  id,
  sha256: sha256Hex(bytes),
  byteLength: bytes.length,
});

/** Both release documents, their recipes and every member, deterministically for one package. */
export function renderNativeFixture(pkg: {
  readonly name: string;
  readonly version: string;
}): RenderedNativeFixture {
  const files = new Map<string, Uint8Array>();
  const serverBytes = encoder.encode(GRAPH_SERVER_SOURCE);
  const graphBytes = encoder.encode(GRAPH_JSON);
  const recorderBytes = encoder.encode(RECORDER_SOURCE);
  if (
    recorderBytes.length !== RECORDER_ORIGIN.byteLength ||
    sha256Hex(recorderBytes) !== RECORDER_ORIGIN.sha256
  ) {
    throw new Error("the pinned recorder bytes differ from their recorded origin");
  }
  const serverPath = `${FIXTURE_DIR}/graph-server.mjs`;
  const graphPath = `${FIXTURE_DIR}/graph.json`;
  const recorderPath = `${FIXTURE_DIR}/recorder.mjs`;
  files.set(serverPath, serverBytes);
  files.set(graphPath, graphBytes);
  files.set(recorderPath, recorderBytes);
  const serverMaterial = descriptor("graph-server", serverBytes);
  const graphMaterial = descriptor("graph-data", graphBytes);
  const recorderMaterial = descriptor("recorder", recorderBytes);

  const write = (id: string, material: string, target: string) => ({
    id,
    purpose: `Write the pinned ${target} file`,
    kind: "file.write",
    scope: "project",
    target: literalTarget(target.split("/")),
    material,
    requires: [],
    checks: [`${material}-sha256`],
  });
  const check = (material: string, target: string, sha256: string) => ({
    id: `${material}-sha256`,
    purpose: `The installed ${target} has the pinned bytes`,
    kind: "file.sha256",
    target: literalTarget(target.split("/")),
    sha256,
  });
  const fixtureRecipe = {
    schema: CORE_RECIPE_SCHEMA_ID,
    id: NATIVE_FIXTURE_ITEM_ID,
    description:
      "Install a read-only fixture graph server with its fixed call graph and the Core stdio recorder, register it as a project-scope Claude MCP server and add one owned instruction block to CLAUDE.md.",
    inputs: {},
    materials: [graphMaterial, serverMaterial, recorderMaterial],
    targets: ["project"],
    prerequisites: [{ kind: "executable", name: "node" }],
    operations: [
      write("write-server", "graph-server", SERVER_PATH),
      write("write-graph", "graph-data", GRAPH_PATH),
      write("write-recorder", "recorder", RECORDER_PATH),
      {
        id: "register-server",
        purpose: `Register the ${SERVER_NAME} stdio server in the project .mcp.json behind the recorder`,
        kind: "config.entries",
        scope: "project",
        target: literalTarget([".mcp.json"]),
        format: "json",
        entries: [
          { path: ["mcpServers", SERVER_NAME], action: "set", value: { literal: SERVER_ENTRY } },
        ],
        requires: ["write-server", "write-graph", "write-recorder"],
        checks: [],
      },
      {
        id: "add-instruction",
        purpose: "Add the graph-fixture verification instruction block to CLAUDE.md",
        kind: "text.block",
        scope: "project",
        target: literalTarget(["CLAUDE.md"]),
        blockId: BLOCK_ID,
        startMarker: START_MARKER,
        endMarker: END_MARKER,
        action: "set",
        content: { literal: INSTRUCTION },
        requires: [],
        checks: [],
      },
    ],
    checks: [
      check("graph-data", GRAPH_PATH, graphMaterial.sha256),
      check("graph-server", SERVER_PATH, serverMaterial.sha256),
      check("recorder", RECORDER_PATH, recorderMaterial.sha256),
    ],
  };
  const fixtureRecipeBytes = documentBytes(fixtureRecipe);
  const fixtureRecipePath = `release/recipes/${NATIVE_FIXTURE_ITEM_ID}.json`;
  files.set(fixtureRecipePath, fixtureRecipeBytes);
  const fixtureItem: Record<string, Json> = {
    id: NATIVE_FIXTURE_ITEM_ID,
    label: "Claude project MCP graph fixture",
    description:
      "Test-scope fixture: a read-only call-graph MCP server registered in the project .mcp.json behind the Core stdio recorder, with one owned CLAUDE.md instruction block.",
    kind: "mcp-server",
    sourceIds: [NATIVE_FIXTURE_SOURCE_ID],
    targets: [{ kind: "executable", name: "node" }],
    scopes: ["project"],
    inputs: {},
    recipe: {
      id: NATIVE_FIXTURE_ITEM_ID,
      schema: CORE_RECIPE_SCHEMA_ID,
      path: fixtureRecipePath,
      sha256: sha256Hex(fixtureRecipeBytes),
      byteLength: fixtureRecipeBytes.length,
    },
    materials: [
      { ...graphMaterial, path: graphPath },
      { ...serverMaterial, path: serverPath },
      { ...recorderMaterial, path: recorderPath },
    ],
    dependencies: { requires: [], optional: [], conflicts: [] },
    metadata: {
      client: "claude",
      scope: "test-configuration",
      recorder: {
        package: RECORDER_ORIGIN.package,
        coreVersion: RECORDER_ORIGIN.coreVersion,
        recorderId: RECORDER_ORIGIN.recorderId,
        sha256: RECORDER_ORIGIN.sha256,
        byteLength: RECORDER_ORIGIN.byteLength,
      },
    },
  };
  const fixtureDocumentBytes = documentBytes({
    schema: "urn:aihq:catalog:release:1.0.0",
    package: { name: pkg.name, version: pkg.version },
    sources: [NATIVE_FIXTURE_SOURCE],
    items: [fixtureItem],
  });
  files.set(NATIVE_FIXTURE_RELEASE_PATH, fixtureDocumentBytes);

  const claudeBytes = encoder.encode(EXPECTED_CLAUDE_MD);
  const mcpBytes = encoder.encode(EXPECTED_MCP_JSON);
  const outputFiles: { path: string; bytes: Uint8Array; archive: string }[] = [
    { path: RECORDER_PATH, bytes: recorderBytes, archive: recorderPath },
    { path: SERVER_PATH, bytes: serverBytes, archive: serverPath },
    { path: GRAPH_PATH, bytes: graphBytes, archive: graphPath },
    { path: ".mcp.json", bytes: mcpBytes, archive: `${BUNDLE_DIR}/expected-mcp.json` },
    { path: "CLAUDE.md", bytes: claudeBytes, archive: `${BUNDLE_DIR}/expected-CLAUDE.md` },
  ];
  const outputTree = outputFiles
    .map((file) => ({ root: "project", path: file.path, member: member(file.archive, file.bytes) }))
    .sort((a, b) => compare(a.root, b.root) || compare(a.path, b.path));
  const result = { content: [{ type: "text", text: "readFile" }], isError: false };
  const bundle: Record<string, Json> = {
    schema: "urn:aihq:core:native-verification-bundle:1.0.0",
    id: NATIVE_BUNDLE_ID,
    client: "claude",
    adapterId: "claude-stream-json.v1",
    scope: "test-configuration",
    package: { name: pkg.name, version: pkg.version },
    release: member(NATIVE_FIXTURE_RELEASE_PATH, fixtureDocumentBytes),
    selection: {
      itemId: NATIVE_FIXTURE_ITEM_ID,
      itemSha256: renderedItemSha256(fixtureItem),
      recipe: member(fixtureRecipePath, fixtureRecipeBytes),
      inputs: {},
    },
    startingTree: [],
    startingTreeSha256: nativeTreeDigest([]),
    outputTree,
    outputTreeSha256: nativeTreeDigest(outputTree),
    instructions: [
      {
        root: "project",
        path: "CLAUDE.md",
        sha256: sha256Hex(claudeBytes),
        evidence: "marker",
        markerSha256: sha256Hex(encoder.encode(MARKER)),
      },
    ],
    server: {
      name: SERVER_NAME,
      transport: "stdio",
      runtime: [member(serverPath, serverBytes), member(graphPath, graphBytes)],
      evidenceAdapterId: RECORDER_ORIGIN.recorderId,
      observation: "recorder",
      recorder: member(recorderPath, recorderBytes),
      toolNames: [ATTEST_TOOL, QUERY_TOOL],
      queryTool: QUERY_TOOL,
      queryArguments: { symbol: "loadConfig" },
      challenge: { mode: "rpc-id" },
      expectedResultSha256: sha256Hex(encoder.encode(canonicalJson(result))),
      expectedAnswer: "readFile",
    },
  };
  const bundleBytes = documentBytes(bundle);
  const bundleFile = `${NATIVE_BUNDLE_ID}.json`;
  const bundleMaterial = descriptor("bundle", bundleBytes);
  const claudeMaterial = descriptor("expected-claude-md", claudeBytes);
  const mcpMaterial = descriptor("expected-mcp-json", mcpBytes);
  files.set(`${BUNDLE_DIR}/${bundleFile}`, bundleBytes);
  files.set(`${BUNDLE_DIR}/expected-CLAUDE.md`, claudeBytes);
  files.set(`${BUNDLE_DIR}/expected-mcp.json`, mcpBytes);

  const bundleRecipe = {
    schema: CORE_RECIPE_SCHEMA_ID,
    id: NATIVE_BUNDLE_ITEM_ID,
    description: `Place the ${NATIVE_BUNDLE_ID} verification bundle and its pinned expected-output files beside the project for a verifier to select.`,
    inputs: {},
    materials: [bundleMaterial, claudeMaterial, mcpMaterial],
    targets: ["project"],
    prerequisites: [],
    operations: [
      {
        id: "write-bundle",
        purpose: `Write the pinned ${NATIVE_BUNDLE_ID} bundle`,
        kind: "file.write",
        scope: "project",
        target: literalTarget([".aihq-native", "verification", bundleFile]),
        material: "bundle",
        requires: [],
        checks: ["bundle-sha256"],
      },
    ],
    checks: [
      {
        id: "bundle-sha256",
        purpose: "The installed bundle has the pinned bytes",
        kind: "file.sha256",
        target: literalTarget([".aihq-native", "verification", bundleFile]),
        sha256: bundleMaterial.sha256,
      },
    ],
  };
  const bundleRecipeBytes = documentBytes(bundleRecipe);
  const bundleRecipePath = `release/recipes/${NATIVE_BUNDLE_ITEM_ID}.json`;
  files.set(bundleRecipePath, bundleRecipeBytes);
  const bundleItem: Record<string, Json> = {
    id: NATIVE_BUNDLE_ITEM_ID,
    label: "Claude graph fixture verification bundle",
    description:
      "Test-scope NativeVerificationBundle for the Claude project MCP graph fixture, with its pinned expected-output files. It selects nothing by itself and proves nothing until a verifier runs it.",
    kind: "native-verification-bundle",
    sourceIds: [NATIVE_FIXTURE_SOURCE_ID],
    targets: [],
    scopes: ["project"],
    inputs: {},
    recipe: {
      id: NATIVE_BUNDLE_ITEM_ID,
      schema: CORE_RECIPE_SCHEMA_ID,
      path: bundleRecipePath,
      sha256: sha256Hex(bundleRecipeBytes),
      byteLength: bundleRecipeBytes.length,
    },
    materials: [
      { ...bundleMaterial, path: `${BUNDLE_DIR}/${bundleFile}` },
      { ...claudeMaterial, path: `${BUNDLE_DIR}/expected-CLAUDE.md` },
      { ...mcpMaterial, path: `${BUNDLE_DIR}/expected-mcp.json` },
    ],
    dependencies: { requires: [], optional: [], conflicts: [] },
    metadata: {
      client: "claude",
      scope: "test-configuration",
      bundleId: NATIVE_BUNDLE_ID,
      selects: NATIVE_FIXTURE_ITEM_ID,
    },
  };
  files.set(
    NATIVE_BUNDLES_RELEASE_PATH,
    documentBytes({
      schema: "urn:aihq:catalog:release:1.0.0",
      package: { name: pkg.name, version: pkg.version },
      sources: [NATIVE_FIXTURE_SOURCE],
      items: [bundleItem],
    }),
  );
  return { files, bundle, bundleBytes };
}
