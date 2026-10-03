// Runs inside a disposable consumer holding the packed Catalog beside a Core without
// recipe 1.1 support (see tools/verify-hook-consumer.mjs --legacy-core). The hook item must
// be reported as unsupported, never partially installed.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInstalledRelease } from "@aihq/catalog/node";
import { configureItem } from "@aihq/catalog/reader";
import { prepare } from "@aihq/core";
import { contractSupport } from "@aihq/core/contracts";
import { createRequire } from "node:module";

const ITEM = "aihq.hook.claude.protect-env";
const root = createRequire(import.meta.url).resolve("@aihq/catalog/package.json").replace(/package\.json$/u, "");
const installed = await readInstalledRelease({ root: root.replace(/[\/]$/u, ""), release: "./release-1.1.json" });
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
const accepted = contractSupport.contracts.filter((contract) => contract.id.includes(":1.1.0"));
assert.deepEqual(accepted, [], "The legacy Core declares no 1.1 contract.");
const configured = configureItem({ release: installed.release, itemId: ITEM, configuration: {},
  materialSource: installed.source });
assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
const project = mkdtempSync(join(tmpdir(), "aih-hook-legacy-"));
mkdirSync(join(project, ".claude"));
const settings = `${JSON.stringify({ hooks: { PreToolUse: [] } }, null, 2)}\n`;
writeFileSync(join(project, ".claude", "settings.json"), settings);
const controls = { logging: "off", materialRoots: installed.materialRoots };
const refusals = [];
for (const schema of ["urn:aihq:core:execution-policy:1.1.0", "urn:aihq:core:execution-policy:1.0.0"]) {
  const prepared = await prepare({ useCase: "policy", target: { project }, policy: {
    schema, mode: "vibe", selections: [{ ...configured.selection, id: ITEM, managementId: ITEM,
      scope: "project", requires: [] }] } }, controls);
  assert.notEqual(prepared.status, "ready", `${schema} must not prepare the hook item`);
  assert.equal(prepared.prepared, undefined);
  refusals.push({ schema, status: prepared.status, reasons: prepared.diagnostics.map((d) => `${d.code}/${d.reason}`) });
}
assert.equal(readFileSync(join(project, ".claude", "settings.json"), "utf8"), settings);
assert.equal(existsSync(join(project, ".claude", "hooks")), false, "No partial install.");
console.log(JSON.stringify({ status: "passed", unsupported: refusals }));
