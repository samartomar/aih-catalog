import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

// Simulate the client edit; never start a native client or choose a registry version.
assert.equal(
  process.argv.length,
  3,
  "Usage: node tools/verify-codex-config-drift.mjs <core-tarball>",
);
const coreTarball = resolve(process.argv[2]);
assert(existsSync(coreTarball), "The supplied Core artifact must exist.");
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
const prefix = join(tmpdir(), "aih-catalog-codex-drift-");
const fixture = mkdtempSync(prefix);
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
);
try {
  // Keep the caller's npm cache: the offline install needs Core's dependencies from it, and
  // npm would otherwise derive an empty cache from the fixture home.
  environment.npm_config_cache ??= execFileSync(
    process.execPath,
    [npm, "config", "get", "cache"],
    { env: environment, encoding: "utf8", timeout: 60_000 },
  ).trim();
  const home = join(fixture, "home");
  mkdirSync(home);
  environment.HOME = home;
  environment.USERPROFILE = home;
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  execFileSync(
    process.execPath,
    [npm, "install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", coreTarball],
    {
      cwd: consumer,
      env: environment,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  assert.equal(hash(coreTarball), coreSha256, "The installed artifact must retain its digest.");
  writeFileSync(
    join(consumer, "consume.mjs"),
    String.raw`
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepare, apply, checkFileState } from "@aihq/core";

// FileStateRequest in the installed Core declarations takes policy + target.project.
const fixture = process.argv[2];
const project = join(fixture, "project");
mkdirSync(project);
const id = "codex-drift-fixture";
const startMarker = "# BEGIN " + id;
const endMarker = "# END " + id;
const content = '[mcp_servers.fixture]\ncommand = "node"\n';
const selection = {
  id, managementId: id, scope: "user", configuration: {}, requires: [],
  recipe: { inline: {
    schema: "urn:aihq:core:recipe:1.0.0", id,
    description: "Prove managed block drift and recovery", inputs: {}, materials: [],
    targets: ["user"], prerequisites: [], checks: [], operations: [{
      id: "block", purpose: "Write fixture configuration", kind: "text.block", action: "set",
      blockId: id, startMarker, endMarker, content: { literal: content },
      scope: "user", requires: [], checks: [],
      target: { root: "userHome", segments: [{ literal: ".codex" }, { literal: "config.toml" }] },
    }],
  } },
};
const policy = { schema: "urn:aihq:core:execution-policy:1.1.0", mode: "vibe", selections: [selection] };
const setup = async () => {
  const prepared = await prepare({ useCase: "policy", policy, target: { project } }, {});
  assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
  const applied = await apply(prepared.prepared, {
    approved: true, origin: "automation", reviewDigest: prepared.review.reviewDigest,
  }, {});
  assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
};
const steps = {};
const check = async (step, fileState, reason) => {
  const result = await checkFileState({ policy, target: { project } }, {});
  assert.equal(result.status, "complete", JSON.stringify(result.diagnostics));
  // Core calls unchanged bytes "match" in its public file-state result.
  assert.equal(result.fileState, fileState);
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].reason, reason);
  steps[step] = { fileState: result.fileState, reason: result.targets[0].reason };
};
await setup();
const target = join(process.env.HOME, ".codex", "config.toml");
const read = () => readFileSync(target, "utf8");
const original = read();
assert(original.endsWith(endMarker + "\n"));
const block = startMarker + "\n" + content + endMarker;
assert(original.includes(block), "Core must install the exact block content.");
await check("setup", "match", "content-match");
// JSON string quoting is valid TOML basic-string quoting for this fixture path.
const mode = process.argv[3];
assert(mode === "drift" || mode === "control", "Unknown scenario: " + mode);
const table = "[projects." + JSON.stringify(project) + "]\ntrust_level = \"trusted\"\n";
if (mode === "control") {
  writeFileSync(target, original + "\n" + table);
  assert(read().includes(block));
  assert(read().includes(table));
  await check("clientBelowBlock", "match", "content-match");
} else {
  const drifted = original.replace(endMarker + "\n", "\n" + table + endMarker + "\n");
  assert.notEqual(drifted, original);
  writeFileSync(target, drifted);
  await check("clientInsideBlock", "changed", "content-changed");
  // Move the table out of the block without losing it or changing the managed bytes.
  const recovered = read().replace("\n" + table + endMarker + "\n", endMarker + "\n\n" + table);
  writeFileSync(target, recovered);
  assert.equal(read(), original + "\n" + table);
  assert(read().includes(table));
  assert(read().includes(block));
  await check("recovery", "match", "content-match");
}
console.log(JSON.stringify({ steps }));
`,
  );
  const consume = (scenario, env, mode) =>
    JSON.parse(
      execFileSync(process.execPath, [join(consumer, "consume.mjs"), scenario, mode], {
        cwd: consumer,
        env,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      }),
    );
  const result = consume(fixture, environment, "drift");
  const control = join(fixture, "control");
  const controlHome = join(control, "home");
  mkdirSync(controlHome, { recursive: true });
  const controlResult = consume(
    control,
    { ...environment, HOME: controlHome, USERPROFILE: controlHome },
    "control",
  );
  console.log(
    JSON.stringify({
      coreSha256,
      steps: { ...result.steps, control: controlResult.steps.clientBelowBlock },
    }),
  );
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  // mkdtemp supplies this exact task-owned root; no caller path is removed.
  assert(fixture.startsWith(prefix));
  rmSync(fixture, { recursive: true, force: true });
}
