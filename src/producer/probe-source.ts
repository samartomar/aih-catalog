/**
 * The program an extracted, installed copy of the packed package runs against itself.
 * It imports only through the package's own public specifiers, so a broken or tampered
 * packed runtime fails here even when the producer's own copy of the reader is fine.
 *
 *   node probe.mjs <release sha256> <package name> <package version>
 *
 * It prints one JSON object. The selection step is bounded: it picks the first item
 * (preferring one with an explicit required closure) whose closure needs no
 * configuration and holds no conflict, and records truthfully when none exists.
 */
export const PROBE_SOURCE = `
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [expectedSha, name, version] = process.argv.slice(2);
const out = { imports: false, release: false, schema: false, installed: false, support: false };
const fail = (stage, error) => {
  out.failure = stage + ": " + String(error && error.message ? error.message : error).slice(0, 300);
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
};
let contracts, reader, node;
try {
  contracts = await import("@aihq/catalog/contracts");
  reader = await import("@aihq/catalog/reader");
  node = await import("@aihq/catalog/node");
  out.imports = true;
} catch (error) { fail("imports", error); }
try {
  const support = contracts.contractSupport;
  out.support = support.package.name === name && support.package.version === version;
  const bytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release.json")));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== expectedSha) throw new Error("packed release.json differs from the candidate");
  const read = reader.readRelease(bytes, { expectedSha256: sha });
  if (!read.valid) throw new Error(read.diagnostics.map((d) => d.reason).join(","));
  out.release = true;
  const schema = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/schemas/release/1.0.0.json")), "utf8"));
  out.schema = support.contracts.some((contract) => contract.id === schema.$id);
  const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
  const installed = await node.readInstalledRelease({ root });
  if (!installed.valid) throw new Error(installed.diagnostics.map((d) => d.reason).join(","));
  out.installed = installed.release.sha256 === sha;
  const release = installed.release;
  const items = reader.listItems(release);
  const byId = new Map(items.map((item) => [item.id, item]));
  const closure = (id) => {
    const order = [];
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop();
      if (order.includes(current)) continue;
      order.push(current);
      for (const ref of byId.get(current).dependencies.requires) {
        if (ref.release !== undefined || !byId.has(ref.itemId)) return undefined;
        stack.push(ref.itemId);
      }
    }
    return order;
  };
  let configurationRequired = 0;
  let conflicting = 0;
  let unresolved = 0;
  const viable = [];
  for (const item of items) {
    const ids = closure(item.id);
    if (ids === undefined) { unresolved += 1; continue; }
    const configured = ids.map((id) => reader.configureItem({ release, itemId: id, configuration: {}, materialSource: installed.source }));
    const bad = configured.flatMap((result) => (result.valid ? [] : result.diagnostics));
    if (bad.length > 0) {
      if (bad.every((d) => d.reason === "input-required")) { configurationRequired += 1; continue; }
      throw new Error("configureItem " + item.id + ": " + bad.map((d) => d.reason).join(","));
    }
    const selections = ids.map((id, index) => ({
      id: "s" + index,
      item: { releaseSha256: release.sha256, itemId: id, itemSha256: byId.get(id).itemSha256 },
      configuration: {},
    }));
    const set = reader.validateSelectionSet({ releases: { [release.sha256]: release }, selections });
    if (!set.valid) {
      if (set.diagnostics.every((d) => d.reason === "conflict-selected")) { conflicting += 1; continue; }
      throw new Error("validateSelectionSet " + item.id + ": " + set.diagnostics.map((d) => d.reason).join(","));
    }
    viable.push(ids);
  }
  const chosen = viable.find((ids) => ids.length > 1) ?? viable[0];
  out.selection = chosen
    ? { status: "passed", selected: chosen, itemCount: items.length }
    : { status: "not-run", itemCount: items.length, configurationRequired, conflicting, unresolved };
  if (chosen) Object.assign(out.selection, { configurationRequired, conflicting, unresolved });
} catch (error) { fail("packed-runtime", error); }
process.stdout.write(JSON.stringify(out));
`;
