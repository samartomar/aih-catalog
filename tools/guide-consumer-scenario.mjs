// Disposable packed Catalog -> public reader/selection -> packed Core Prepare/Apply.
// Synthetic update bytes below are fixture content, never canonical Guide output.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readInstalledRelease } from "@aihq/catalog/node";
import { configureItem, validateSelectionSet } from "@aihq/catalog/reader";
import { prepare, apply } from "@aihq/core";

const ITEM = "aihq.guide";
const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const checks = [];
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`;
const document = (value) => Buffer.from(`${canonical(value)}\n`);
async function configuredAt(root, sourceInput) {
  const read = await readInstalledRelease({ root, release: "./release-guide.json", sourceInput });
  assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
  const configured = configureItem({
    release: read.release,
    itemId: ITEM,
    configuration: { guideDirectory: "saved-guide" },
    materialSource: read.source,
  });
  assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
  const set = validateSelectionSet({
    releases: { [read.release.sha256]: read.release },
    selections: [
      {
        id: ITEM,
        item: {
          releaseSha256: read.release.sha256,
          itemId: ITEM,
          itemSha256: configured.provenance.itemSha256,
        },
        configuration: { guideDirectory: "saved-guide" },
      },
    ],
  });
  assert.equal(set.valid, true, JSON.stringify(set.diagnostics));
  return { read, configured, set };
}
const previousRoot = process.argv[2];
const firstRoot = previousRoot ?? root;
const first = await configuredAt(firstRoot, "catalog");
const secondRoot = previousRoot ? root : join(here, "synthetic-update");
let manualBytes;
if (!previousRoot) {
  cpSync(root, secondRoot, { recursive: true });
  const manifestPath = join(secondRoot, "release/release-guide.json");
  const manifest = JSON.parse(readFileSync(manifestPath));
  const item = manifest.items[0];
  const manual = item.materials.find((m) => m.id === "manual");
  manualBytes = Buffer.from("# Controlled Guide update fixture\n");
  writeFileSync(join(secondRoot, manual.path), manualBytes);
  manual.sha256 = hash(manualBytes);
  manual.byteLength = manualBytes.length;
  const recipePath = join(secondRoot, item.recipe.path);
  const recipe = JSON.parse(readFileSync(recipePath));
  Object.assign(
    recipe.materials.find((m) => m.id === "manual"),
    { sha256: manual.sha256, byteLength: manual.byteLength },
  );
  recipe.checks.find((c) => c.id === "manual-sha256").sha256 = manual.sha256;
  const recipeBytes = document(recipe);
  writeFileSync(recipePath, recipeBytes);
  item.recipe.sha256 = hash(recipeBytes);
  item.recipe.byteLength = recipeBytes.length;
  writeFileSync(manifestPath, document(manifest));
}
const second = await configuredAt(secondRoot, "catalog-update");
if (previousRoot) {
  const nextManual = second.read.release.items[0].materials.find((m) => m.id === "manual");
  manualBytes = readFileSync(join(secondRoot, nextManual.path));
  assert.notEqual(
    first.read.release.items[0].materials.find((m) => m.id === "manual").sha256,
    nextManual.sha256,
    "Real pinned update must change canonical manual content",
  );
}
const controls = {
  logging: "off",
  materialRoots: { ...first.read.materialRoots, ...second.read.materialRoots },
};
const policy = (members, version = first) => ({
  schema: "urn:aihq:core:execution-policy:1.1.0",
  mode: "vibe",
  managedSelections: [{ id: "guide", scope: "project", members }],
  selections: members.map((id) => ({
    ...version.configured.selection,
    id,
    managementId: id,
    scope: "project",
    requires: version.set.requiresBySelectionId[id],
  })),
});
const project = (name) => {
  const dir = join(here, name);
  mkdirSync(dir);
  return dir;
};
const prepareAt = (policy, project) =>
  prepare({ useCase: "policy", policy, target: { project } }, controls);
const ready = async (policy, project) => {
  const p = await prepareAt(policy, project);
  assert.equal(p.status, "ready", JSON.stringify(p.diagnostics));
  return p;
};
const approved = async (p) => {
  const a = await apply(
    p.prepared,
    { approved: true, origin: "automation", reviewDigest: p.review.reviewDigest },
    controls,
  );
  assert.equal(a.completion, "complete", JSON.stringify(a));
  assert(a.checks.every((check) => check.status === "passed"));
  return a;
};
const dir = project("lifecycle");
const neighbor = join(dir, "AGENTS.md");
writeFileSync(neighbor, "Existing project choices\n");
const saved = join(dir, "saved-guide");
let p = await ready(policy([ITEM]), dir);
assert(!existsSync(saved), "Prepare must not create Guide output");
const rejected = await apply(p.prepared, undefined, controls);
assert.equal(rejected.completion, "rejected");
assert(!existsSync(saved));
assert(
  JSON.stringify(p.review).includes(
    first.read.release.items[0].materials.find((m) => m.id === "manual").sha256,
  ),
);
checks.push("review-pins-content-and-no-effects-before-approval");
p = await ready(policy([ITEM]), dir);
await approved(p);
const expectedManual = readFileSync(
  join(firstRoot, first.read.release.items[0].materials.find((m) => m.id === "manual").path),
);
assert(readFileSync(join(saved, "MANUAL.md")).equals(expectedManual));
for (const client of ["claude", "kimi", "opencode"])
  assert(existsSync(join(saved, "profiles", client, "aih-guide.md")));
assert.equal(readFileSync(neighbor, "utf8"), "Existing project choices\n");
assert(!existsSync(join(dir, ".claude")));
assert(!existsSync(join(dir, ".kimi")));
assert(!existsSync(join(dir, ".opencode")));
checks.push("canonical-manual-and-reference-profiles-installed-without-native-registration");
writeFileSync(join(saved, "neighbor.md"), "Keep neighboring content\n");
p = await ready(policy([ITEM], second), dir);
await approved(p);
assert(readFileSync(join(saved, "MANUAL.md")).equals(manualBytes));
assert.equal(readFileSync(join(saved, "neighbor.md"), "utf8"), "Keep neighboring content\n");
checks.push(
  previousRoot
    ? "owned-update-between-exact-reviewed-artifacts-preserves-neighbors"
    : "owned-update-with-controlled-fixture-and-neighbor-preservation",
);
p = await ready(policy([]), dir);
await approved(p);
assert(!existsSync(join(saved, "MANUAL.md")));
for (const client of ["claude", "kimi", "opencode"])
  assert(!existsSync(join(saved, "profiles", client, "aih-guide.md")));
assert.equal(readFileSync(join(saved, "neighbor.md"), "utf8"), "Keep neighboring content\n");
assert.equal(readFileSync(neighbor, "utf8"), "Existing project choices\n");
checks.push("owned-removal-preserves-neighboring-files-and-choices");
const conflict = project("unowned-conflict");
mkdirSync(join(conflict, "saved-guide"));
writeFileSync(join(conflict, "saved-guide/MANUAL.md"), "User manual\n");
p = await prepareAt(policy([ITEM]), conflict);
assert(
  p.review.operations.some((op) => op.effects === "conflict"),
  JSON.stringify(p),
);
assert.equal(readFileSync(join(conflict, "saved-guide/MANUAL.md"), "utf8"), "User manual\n");
assert(!existsSync(join(conflict, "saved-guide/profiles")));
checks.push("unowned-whole-file-conflict-preserves-user-bytes");
const edited = project("owned-edit-conflict");
p = await ready(policy([ITEM]), edited);
await approved(p);
writeFileSync(join(edited, "saved-guide/MANUAL.md"), "Locally edited manual\n");
p = await prepareAt(policy([], first), edited);
assert(
  p.review.operations.some((op) => op.effects === "conflict"),
  JSON.stringify(p),
);
assert.equal(
  readFileSync(join(edited, "saved-guide/MANUAL.md"), "utf8"),
  "Locally edited manual\n",
);
checks.push("edited-owned-removal-conflict-preserves-user-bytes");
console.log(
  JSON.stringify({
    checks,
    nativeConversation: "not-tested-or-registered",
    update: previousRoot ? "exact-reviewed-artifacts" : "synthetic-disposable-fixture",
    manualSha256: hash(expectedManual),
    updatedManualSha256: hash(manualBytes),
    releaseSha256: first.read.release.sha256,
    updatedReleaseSha256: second.read.release.sha256,
    platform: process.platform,
    node: process.version,
  }),
);
