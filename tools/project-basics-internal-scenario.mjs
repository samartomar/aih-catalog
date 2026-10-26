// Copied into an outside consumer; only public package interfaces are imported.
// The internal local-package path for prepared release content: Project basics is read
// from the installed package with every byte verified, browsed and composed through the
// portable reader, and (with an exact Core archive installed beside it) prepared and
// applied by Core into a disposable project. No baseline is bound, none is fabricated,
// and the content stays labelled unbound and unauthenticated throughout.
//
//   node consume-project-basics-internal.mjs [core]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preparedReleaseContent } from "@aihq/catalog/contracts";
import { readInstalledPreparedContent, readInstalledRelease } from "@aihq/catalog/node";
import {
  configureItem,
  listItems,
  readRelease,
  resolveSelections,
  validateSelectionSet,
} from "@aihq/catalog/reader";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const results = [];
const case_ = async (name, fn) => {
  try {
    results.push({ name, status: "pass", ...((await fn()) ?? {}) });
  } catch (error) {
    results.push({ name, status: "fail", error: String(error?.stack ?? error) });
  }
};
const FRAMEWORK = "project-basics";
const entry = preparedReleaseContent.find((candidate) => candidate.frameworkId === FRAMEWORK);
const read = await readInstalledPreparedContent({ root, frameworkId: FRAMEWORK });
const reasons = (result) => (result.diagnostics ?? []).map((diagnostic) => diagnostic.reason);
const scratch = mkdtempSync(join(tmpdir(), "aih-catalog-project-basics-internal-"));
const copyPackage = (name) => {
  const copy = join(scratch, name);
  cpSync(root, copy, { recursive: true });
  return copy;
};

await case_("the installed package's prepared content is read with every byte verified", () => {
  assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
  assert.equal(read.release.schema, "urn:aihq:catalog:release:1.7.0");
  assert.equal(read.release.framework.id, FRAMEWORK);
  assert.deepEqual(read.source, { kind: "local", input: "catalog" });
  assert.deepEqual(Object.keys(read.materialRoots), ["catalog"]);
  const content = readFileSync(join(root, entry.content));
  const inventory = readFileSync(join(root, entry.inventory));
  assert.deepEqual(read.provenance, {
    kind: "installed-prepared",
    package: read.release.package,
    contentPath: entry.content,
    contentSha256: sha256(content),
    contentByteLength: content.length,
    inventoryPath: entry.inventory,
    inventorySha256: sha256(inventory),
    inventoryByteLength: inventory.length,
  });
  return { contentSha256: read.provenance.contentSha256, inventorySha256: read.provenance.inventorySha256 };
});

await case_("it is labelled unbound and unauthenticated, and release readers still refuse it", async () => {
  assert.deepEqual(read.status, {
    kind: "prepared-content",
    baseline: "unbound",
    authenticated: false,
    productionRelease: false,
  });
  assert.equal(read.release.baseline, undefined);
  const content = readFileSync(join(root, entry.content));
  const strict = readRelease(content, { expectedSha256: sha256(content) });
  assert.equal(strict.valid, false);
  assert.ok(reasons(strict).includes("baseline-invalid"));
  const installed = await readInstalledRelease({ root, release: `./${entry.export.slice("@aihq/catalog/".length)}` });
  assert.equal(installed.valid, false);
});

await case_("only a listed framework can be selected, from an absolute root", async () => {
  assert.deepEqual(reasons(await readInstalledPreparedContent({ root, frameworkId: "not-listed" })), ["prepared-content-unknown"]);
  assert.deepEqual(reasons(await readInstalledPreparedContent({ root: "relative/root", frameworkId: FRAMEWORK })), ["invalid-root"]);
  assert.deepEqual(reasons(await readInstalledPreparedContent({ root, frameworkId: FRAMEWORK, sourceInput: "not an id" })), ["invalid-source-input"]);
});

await case_("a changed material or a stale inventory is refused", async () => {
  const material = read.release.items[0].materials.find((member) => member.role === "content");
  const changed = copyPackage("changed-material");
  const target = join(changed, material.packagePath);
  writeFileSync(target, Buffer.concat([readFileSync(target).subarray(0, material.byteLength - 1), Buffer.from("!")]));
  assert.deepEqual(reasons(await readInstalledPreparedContent({ root: changed, frameworkId: FRAMEWORK })), ["member-sha256-mismatch"]);
  const stale = copyPackage("stale-inventory");
  writeFileSync(join(stale, entry.inventory), `${readFileSync(join(stale, entry.inventory), "utf8").trimEnd()} \n`);
  assert.deepEqual(reasons(await readInstalledPreparedContent({ root: stale, frameworkId: FRAMEWORK })), ["prepared-inventory-mismatch"]);
});

const releases = { [read.release.sha256]: read.release };
const roots = [{ releaseSha256: read.release.sha256, itemId: "project-basics.shared-block", scope: "project", configuration: { projectFolder: "team-ai" } }];
const resolved = resolveSelections({ releases, roots, skips: [] });
let selections = [];

await case_("a consumer browses and composes Project basics through the portable reader", () => {
  assert.deepEqual(listItems(read.release).map((item) => item.id), [
    "project-basics.router",
    "project-basics.shared-block",
    "project-basics.working-rules",
  ]);
  assert.equal(resolved.status, "ok", JSON.stringify(resolved.diagnostics));
  // The shared block brings the router and the working rules it points to.
  assert.deepEqual([...new Set(resolved.value.selections.map((selection) => selection.item.itemId))].sort(), [
    "project-basics.router",
    "project-basics.shared-block",
    "project-basics.working-rules",
  ]);
  const validated = validateSelectionSet({ releases, selections: resolved.value.selections });
  assert.equal(validated.valid, true, JSON.stringify(validated.diagnostics));
  selections = resolved.value.selections.map((selection) => {
    const configured = configureItem({ release: read.release, itemId: selection.item.itemId, configuration: { projectFolder: "team-ai" }, materialSource: read.source });
    assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
    return { ...configured.selection, id: selection.id, managementId: selection.id, scope: "project", requires: validated.requiresBySelectionId[selection.id] };
  });
  assert.equal(selections.length, resolved.value.selections.length);
});

let core = { status: "not-run", reason: "No Core archive installed; Catalog public reader, resolver and configuration only." };
if (process.argv[2] === "core") {
  await case_("Core prepares and applies the composed content into the project's named folder", async () => {
    const { apply, prepare } = await import("@aihq/core");
    const project = join(scratch, "project");
    mkdirSync(project);
    const controls = { logging: "off", materialRoots: read.materialRoots };
    const policy = {
      schema: "urn:aihq:core:execution-policy:1.3.0",
      mode: "vibe",
      managedSelections: [{ id: "project-basics", scope: "project", members: selections.map((selection) => selection.id) }],
      selections,
    };
    const prepared = await prepare({ useCase: "policy", policy, target: { project } }, controls);
    assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
    const applied = await apply(prepared.prepared, { approved: true, origin: "automation", reviewDigest: prepared.review.reviewDigest }, controls);
    assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
    const written = {};
    for (const item of read.release.items) {
      const material = item.materials.find((member) => member.role === "content");
      const bytes = readFileSync(join(project, "team-ai", material.relPath));
      assert.equal(sha256(bytes), material.sha256, item.id);
      written[`team-ai/${material.relPath}`] = material.sha256;
    }
    core = { status: "complete", prepared: prepared.status, applied: applied.completion, written, nativeExecution: "not-run" };
    return { written };
  });
}

rmSync(scratch, { recursive: true, force: true });
process.stdout.write(JSON.stringify({ results, core }));
