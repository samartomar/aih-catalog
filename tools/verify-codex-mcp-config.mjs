import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

// Drive Core's public API against the real packed Catalog recipes in a fixture home; never
// start a native client or choose a registry version.
assert(
  process.argv.length === 4 || process.argv.length === 5,
  "Usage: node tools/verify-codex-mcp-config.mjs --expect-removal=<clean|empty-managed-table-headers-remain> <core-tarball> [catalog-tarball]",
);
const expectedRemoval = process.argv[2].replace(/^--expect-removal=/, "");
assert(
  process.argv[2] === "--expect-removal=" + expectedRemoval &&
    ["clean", "empty-managed-table-headers-remain"].includes(expectedRemoval),
  "Explicitly require --expect-removal=clean or --expect-removal=empty-managed-table-headers-remain for the supplied Core build.",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreTarball = resolve(process.argv[3]);
assert(existsSync(coreTarball), "The supplied Core artifact must exist.");
const suppliedCatalog = process.argv[4] && resolve(process.argv[4]);
assert(!suppliedCatalog || existsSync(suppliedCatalog), "The supplied Catalog artifact must exist.");
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const coreSha256 = hash(coreTarball);
const npm = [
  process.env.npm_execpath,
  resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js"),
].find(
  (candidate) =>
    candidate &&
    isAbsolute(candidate) &&
    basename(candidate) === "npm-cli.js" &&
    existsSync(candidate),
);
assert(npm, "Use a Node distribution with adjacent npm, or invoke through npm.");
const prefix = join(tmpdir(), "aih-catalog-codex-mcp-");
const fixture = mkdtempSync(prefix);
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
);
const runNpm = (args, cwd) =>
  execFileSync(process.execPath, [npm, ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
try {
  // Keep the caller's npm cache: the offline install needs Core's dependencies from it, and
  // npm would otherwise derive an empty cache from the fixture home.
  environment.npm_config_cache ??= runNpm(["config", "get", "cache"], fixture).trim();
  const home = join(fixture, "home");
  mkdirSync(home);
  environment.HOME = home;
  environment.USERPROFILE = home;
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const consumerPath = environment[pathKey] ?? "";
  const catalogTarball =
    suppliedCatalog ??
    join(
      fixture,
      JSON.parse(
        runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root),
      )[0].filename,
    );
  const catalogSha256 = hash(catalogTarball);
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm(
    ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", catalogTarball, coreTarball],
    consumer,
  );
  assert.equal(hash(coreTarball), coreSha256, "The installed Core artifact must retain its digest.");
  assert.equal(hash(catalogTarball), catalogSha256, "The installed Catalog artifact must retain its digest.");
  writeFileSync(
    join(consumer, "consume.mjs"),
    String.raw`
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configureItem, resolveSelections, validateSelectionSet } from "@aihq/catalog/reader";
import { readInstalledRelease } from "@aihq/catalog/node";
import { apply, checkFileState, listManagedSelections, prepare } from "@aihq/core";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixture = process.argv[2];
const expectedRemoval = process.argv[3];
const home = process.env.HOME;
const project = join(fixture, "project");
mkdirSync(project);
const configPath = join(home, ".codex", "config.toml");
const read = () => readFileSync(configPath, "utf8");
const dump = (value) => JSON.stringify(value);

const catalogRoot = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const installed = await readInstalledRelease({ root: catalogRoot, release: "./release-ecc.json" });
assert.equal(installed.valid, true, dump(installed.diagnostics));
const releases = { [installed.release.sha256]: installed.release };
const itemIds = ["ecc.codex.mcp.github", "ecc.codex.mcp.browser-use"];
const resolved = resolveSelections({
  releases,
  roots: itemIds.map((itemId) => ({ releaseSha256: installed.release.sha256, itemId, scope: "user", configuration: {} })),
  skips: [],
});
assert.equal(resolved.status, "ok", dump(resolved.diagnostics));
assert.deepEqual(resolved.value.selections.map((selection) => selection.item.itemId).sort(), [...itemIds].sort());
const validated = validateSelectionSet({ releases, selections: resolved.value.selections });
assert.equal(validated.valid, true, dump(validated.diagnostics));
const recipes = {};
const idOf = {};
const selections = resolved.value.selections.map((selection) => {
  const configured = configureItem({
    release: installed.release,
    itemId: selection.item.itemId,
    configuration: selection.configuration,
    materialSource: installed.source,
  });
  assert.equal(configured.valid, true, dump(configured.diagnostics));
  const reference = configured.selection.recipe.reference;
  const bytes = readFileSync(join(installed.materialRoots.catalog, reference.path));
  assert.equal(sha(bytes), reference.sha256, reference.path);
  recipes[selection.item.itemId] = JSON.parse(bytes);
  idOf[selection.item.itemId] = selection.id;
  return {
    ...configured.selection,
    id: selection.id,
    managementId: selection.id,
    scope: "user",
    requires: validated.requiresBySelectionId[selection.id],
  };
});
const managed = (members) => ({
  schema: "urn:aihq:core:execution-policy:1.3.0",
  mode: "vibe",
  managedSelections: [{ id: "codex-mcp", scope: "user", members }],
  selections: members.length ? selections : [],
});
const policy = managed(selections.map((selection) => selection.id));
const removalPolicy = managed([]);
const controls = { logging: "off", materialRoots: installed.materialRoots };

// The expected managed statements, written out so a recipe change cannot move them silently.
const githubSection = [
  "[mcp_servers.github]",
  'url = "https://api.githubcopilot.com/mcp/readonly"',
];
const browserSection = [
  "[mcp_servers.browser-use]",
  'url = "https://api.browser-use.com/v3/mcp"',
  "[mcp_servers.browser-use.env_http_headers]",
  'x-browser-use-api-key = "BROWSER_USE_KEY"',
];
const entriesOf = (itemId) => recipes[itemId].operations.find((operation) => operation.kind === "config.entries").entries;
const literalOf = (itemId, path) => entriesOf(itemId).find((entry) => entry.path.join(".") === path).value.literal;
assert.equal(literalOf(itemIds[0], "mcp_servers.github.url"), "https://api.githubcopilot.com/mcp/readonly");
assert.equal(literalOf(itemIds[1], "mcp_servers.browser-use.url"), "https://api.browser-use.com/v3/mcp");
assert.equal(literalOf(itemIds[1], "mcp_servers.browser-use.env_http_headers.x-browser-use-api-key"), "BROWSER_USE_KEY");
assert.equal(entriesOf(itemIds[0]).length, 1);
assert.equal(entriesOf(itemIds[1]).length, 2);

const trailer = "# trailing note one\n# trailing note two\n";
const projectTable = (path) => "[projects." + JSON.stringify(path) + "]\ntrust_level = \"trusted\"\n";
const seed = [
  "# Codex user configuration.",
  "# Edited by hand; keep these comments.",
  "",
  'model = "gpt-5.5"',
  'model_reasoning_effort = "high"',
  'approval_policy = "on-request"',
  'sandbox_mode = "workspace-write" # keep the sandbox on',
  "",
  '[projects."/home/dev/app"]',
  'trust_level = "trusted"',
  "",
  "[projects.'C:\\Users\\dev\\app']",
  'trust_level = "trusted"',
  "",
  '[projects."/home/dev/my projects/spaced app"]',
  'trust_level = "trusted"',
  "",
  "[mcp_servers.other]",
  'command = "node"',
  "args = [",
  '  "server.js",',
  '  "--port", "8080", # keep the port',
  "]",
  "",
  "[mcp_servers.other.env]",
  'LOG_LEVEL = "info"',
  "",
  "[profiles.x]",
  'model = "gpt-5.5-mini"',
  "",
  "",
].join("\n") + trailer;
mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(configPath, seed);

// What Codex CLI 0.162.1 does: record a trusted project before the trailing comments and
// leave the person's other settings alone; here it also changes an unrelated value.
const clientEdit = (text) => {
  assert(text.includes(trailer) && text.includes('model = "gpt-5.5"\n'));
  return text
    .replace(trailer, projectTable(project) + "\n" + trailer)
    .replace('model = "gpt-5.5"\n', 'model = "gpt-5.5-codex"\n');
};

const steps = {};
const stateOf = async (label, fileState) => {
  const result = await checkFileState({ policy, target: { project } }, { materialRoots: controls.materialRoots });
  // Core never evaluates prerequisites or custody here, so the status stays "incomplete" and
  // names exactly those omissions; every file and check outcome is still compared.
  assert.equal(result.status, "incomplete", label + ": " + dump(result));
  assert.deepEqual(
    result.notChecked.map(({ kind, reason }) => kind + ":" + reason).sort(),
    ["managed-set:custody-not-evaluated", "prerequisite:process-not-checked"],
    label + ": " + dump(result.notChecked),
  );
  assert.equal(result.coverage.unavailableTargets + result.coverage.unavailableChecks, 0, dump(result.coverage));
  const summary = {
    fileState: result.fileState,
    targets: result.targets.map(({ id, operationIds, target, outcome, reason }) => ({ id, operationIds, target, outcome, reason })),
    checks: result.checks.map(({ id, outcome, reason }) => ({ id, outcome, reason })),
    notChecked: result.notChecked,
  };
  assert.equal(result.fileState, fileState, label + ": " + dump(summary));
  return summary;
};
const setup = async (label, thePolicy) => {
  const prepared = await prepare({ useCase: "policy", policy: thePolicy, target: { project } }, controls);
  assert.equal(prepared.status, "ready", label + ": " + dump(prepared.diagnostics));
  const applied = await apply(prepared.prepared, {
    approved: true, origin: "automation", reviewDigest: prepared.review.reviewDigest,
  }, controls);
  assert.equal(applied.completion, "complete", label + ": " + dump(applied.diagnostics));
  return {
    prepared: prepared.status,
    applied: applied.completion,
    operations: prepared.review.operations.map((operation) => operation.kind + ":" + operation.id),
  };
};
const section = (text, header) => {
  const lines = text.split("\n");
  const start = lines.indexOf(header);
  assert(start >= 0, "Missing table " + header);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("["));
  return lines.slice(start, end < 0 ? undefined : end).filter((line) => line.trim() !== "");
};
const assertManaged = (text) => {
  assert.deepEqual(section(text, "[mcp_servers.github]"), githubSection);
  assert.deepEqual(section(text, "[mcp_servers.browser-use]"), browserSection.slice(0, 2));
  assert.deepEqual(section(text, "[mcp_servers.browser-use.env_http_headers]"), browserSection.slice(2));
};
const materialPaths = Object.values(recipes).flatMap((recipe) => recipe.checks
  .filter((check) => check.kind === "file.sha256")
  .map((check) => ({ path: join(home, ...check.target.segments.map((segment) => segment.literal)), sha256: check.sha256 })));
assert.equal(materialPaths.length, 4);
const pinnedFromRelease = installed.release.items
  .filter((item) => itemIds.includes(item.id))
  .flatMap((item) => item.materials.map((member) => member.sha256));

// 1. setup
{
  const run = await setup("setup", policy);
  const result = read();
  // Core appends its tables after the last original byte; the original is an exact prefix.
  assert(result.startsWith(seed), "Original bytes must survive as a prefix: " + dump(result));
  assertManaged(result);
  for (const { path, sha256 } of materialPaths) {
    assert(existsSync(path), "Missing delivered material " + path);
    assert.equal(sha(readFileSync(path)), sha256, path);
  }
  assert.deepEqual(
    [...new Set(materialPaths.map(({ sha256 }) => sha256))].sort(),
    [...new Set(pinnedFromRelease)].sort(),
  );
  steps.setup = {
    ...run,
    layout: "original-is-a-byte-exact-prefix",
    appendedAfterOriginal: result.slice(seed.length),
    materialSha256: Object.fromEntries(materialPaths.map(({ path, sha256 }) => [path.slice(home.length + 1).replaceAll("\\", "/"), sha256])),
    fileState: await stateOf("setup", "match"),
  };
}

// 2. client change
const afterSetup = read();
const clientChanged = clientEdit(afterSetup);
assert.notEqual(clientChanged, afterSetup);
writeFileSync(configPath, clientChanged);
assertManaged(read());
const originalWithClient = clientEdit(seed);
steps.clientChange = { fileState: await stateOf("client change", "match") };

// 3. repeat setup
{
  const before = read();
  const run = await setup("repeat setup", policy);
  assert.equal(read(), before, "Repeating setup must leave every byte unchanged.");
  steps.repeatSetup = { ...run, bytesUnchanged: true, fileState: await stateOf("repeat setup", "match") };
}

// 4. managed drift
{
  const before = read();
  const managedValue = 'url = "https://api.githubcopilot.com/mcp/readonly"';
  assert.equal(before.split(managedValue).length, 2);
  writeFileSync(configPath, before.replace(managedValue, 'url = "https://example.invalid/changed"'));
  const drifted = await stateOf("managed drift", "changed");
  // Core reports file state per target file, not per key: the one changed target is
  // config.toml and its operationIds list every selection that registers a server there.
  const changed = drifted.targets.filter((target) => target.outcome === "changed");
  assert.equal(changed.length, 1, "Exactly the edited file must drift: " + dump(drifted));
  assert.deepEqual(changed[0].target, { root: "userHome", path: ".codex/config.toml" });
  assert.equal(changed[0].reason, "content-changed");
  assert.deepEqual(
    changed[0].operationIds.sort(),
    itemIds.map((itemId) => idOf[itemId] + "/register-server").sort(),
  );
  assert(drifted.targets.filter((target) => target !== changed[0]).every((target) => target.outcome === "match"), dump(drifted));
  writeFileSync(configPath, before);
  assert.equal(read(), before);
  steps.managedDrift = { drifted, restored: await stateOf("restored", "match") };
}

// 5. removal
{
  const run = await setup("removal", removalPolicy);
  const after = read();
  // Builds before Core #69 retain these headers. Builds containing it record newly created
  // tables and remove their headers when their last managed key is removed. Require the
  // caller's declared outcome, always comparing every byte of the person's/client's content.
  const emptyHeaders = "[mcp_servers.browser-use]\n[mcp_servers.browser-use.env_http_headers]\n[mcp_servers.github]\n";
  const outcome = after === originalWithClient ? "clean"
    : after === originalWithClient + emptyHeaders ? "empty-managed-table-headers-remain" : "unexpected";
  steps.removal = {
    ...run,
    expectedOutcome: expectedRemoval,
    outcome,
    ...(outcome === "empty-managed-table-headers-remain"
      ? { finding: "Core leaves empty managed table headers after removal", leftover: emptyHeaders }
      : {}),
  };
  assert.equal(outcome, expectedRemoval, "Removal did not match the required outcome: " + dump({
    outcome, expectedRemoval, observed: after,
    expected: originalWithClient + (expectedRemoval === "clean" ? "" : emptyHeaders),
  }));
  for (const { path } of materialPaths) assert(!existsSync(path), "Delivered material must be removed: " + path);
  steps.removal.materialRemoved = true;
}

// 6. control: the custody inventory exposes no ownership-root version.
{
  const inventory = await listManagedSelections({ target: { project }, scope: "user" });
  assert.equal(inventory.status, "complete", dump(inventory.diagnostics));
  steps.control = {
    managedAfterRemoval: inventory.selections,
    ownershipRootVersion: "not exposed by the public interface",
    pathsAreBare: [...githubSection, ...browserSection].every((line) => !line.startsWith("[") || /^\[[A-Za-z0-9_.-]+\]$/.test(line)),
  };
}
console.log(JSON.stringify({ steps }));
`,
  );
  const result = JSON.parse(
    execFileSync(process.execPath, [join(consumer, "consume.mjs"), fixture, expectedRemoval], {
      cwd: consumer,
      env: { ...environment, [pathKey]: consumerPath },
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
  assert.equal(hash(coreTarball), coreSha256);
  console.log(JSON.stringify({ coreSha256, catalogSha256, ...result }, null, 2));
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  // mkdtemp supplies this exact task-owned root; no caller path is removed.
  assert(fixture.startsWith(prefix));
  rmSync(fixture, { recursive: true, force: true });
}
