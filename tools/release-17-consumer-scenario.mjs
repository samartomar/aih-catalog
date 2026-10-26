// Copied into an outside consumer; only public package interfaces are imported.
// Release 1.7: reading beside 1.6, one item per content on real data, the recipe
// map, the frozen default read from a later package version by its historical
// digest, the transition build and the restructuring comparison. No Core, no execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FROZEN_DEFAULT_RELEASE_SHA256, releaseInventory } from "@aihq/catalog/contracts";
import { readInstalledRelease } from "@aihq/catalog/node";
import {
  compareRestructuring,
  compileProducerDeclaration,
  compileTransitionRelease,
} from "@aihq/catalog/producer";
import { configureItem, readRelease, readReleaseContent } from "@aihq/catalog/reader";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (text) => new TextEncoder().encode(text);
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const exported = (name) => readFileSync(fileURLToPath(import.meta.resolve(`@aihq/catalog/${name}`)));
const json = (name) => JSON.parse(exported(name).toString("utf8"));
const results = [];
const case_ = async (name, fn) => {
  try {
    await fn();
    results.push({ name, status: "pass" });
  } catch (error) {
    results.push({ name, status: "fail", error: String(error?.stack ?? error) });
  }
};
const content = (name) => {
  const bytes = exported(name);
  const read = readReleaseContent(bytes, { expectedSha256: sha256(bytes) });
  assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
  return read.release;
};
const archive = { kind: "archive", url: "https://example.test/catalog.tgz", sha256: "a".repeat(64), byteLength: 10 };

await case_("release 1.7 and 1.6 coexist with deterministic hash vectors", () => {
  const bytes = exported("fixtures/release-1.7.0-valid.json");
  const read = readRelease(bytes, { expectedSha256: sha256(bytes) });
  assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
  assert.equal(read.release.schema, "urn:aihq:catalog:release:1.7.0");
  const vectors = json("fixtures/release-1-7/hash-vectors.json");
  const schemas = [];
  for (const vector of vectors.releases) {
    const release = content(vector.export.replace("@aihq/catalog/", ""));
    schemas.push(release.schema);
    assert.equal(release.sha256, vector.releaseSha256);
    assert.deepEqual(
      release.items.map(({ id, itemSha256, contentSha256, behaviourSha256 }) => ({ id, itemSha256, contentSha256, behaviourSha256 })),
      vector.items,
    );
  }
  assert.deepEqual(schemas, ["urn:aihq:catalog:release:1.6.0", "urn:aihq:catalog:release:1.7.0"]);
  const inventory = json("fixtures/content-inventory-1.2.0-valid.json");
  assert.equal(inventory.schema, "urn:aihq:catalog:content-inventory:1.2.0");
  assert.equal(inventory.projection, "urn:aihq:catalog:release-content:1.2.0");
});

await case_("grill-me appears once on real data and supersedes the frozen default's copy", () => {
  const release = content("fixtures/release-1-7/extensions-release-1.7.0.json");
  const grill = release.items.filter((item) => item.name === "grill-me");
  assert.equal(grill.length, 1);
  assert.deepEqual(Object.keys(grill[0].recipes), ["claude-code", "copilot-vscode", "kiro-ide"]);
  const frozen = grill[0].supersedes.find((entry) => entry.itemId === "mattpocock.grill-me");
  assert.equal(frozen.match, "name+sourcePath");
  assert.equal(frozen.releaseSha256, sha256(exported("release.json")));
  assert.equal(frozen.releaseSha256, FROZEN_DEFAULT_RELEASE_SHA256);
  // The same content identity the October dry run projected for grill-me.
  const expectation = json("restructuring/expected-1.7.0.json");
  const expected = expectation.frameworks.extensions.items.find((item) => item.id === "extensions.matt.grill-me");
  assert.equal(grill[0].contentSha256, expected.contentSha256);
});

await case_("configureItem selects a transition recipe by clientId", () => {
  const release = content("fixtures/release-1-7/extensions-release-1.7.0.json");
  const configure = (clientId) =>
    configureItem({ release, itemId: "extensions.matt.grill-me", configuration: {}, materialSource: archive, ...(clientId ? { clientId } : {}) });
  assert.equal(configure().diagnostics[0].reason, "client-id-required");
  assert.equal(configure("cursor").diagnostics[0].reason, "client-unavailable");
  const kiro = configure("kiro-ide");
  assert.equal(kiro.valid, true, JSON.stringify(kiro.diagnostics));
  const entry = release.items.find((item) => item.id === "extensions.matt.grill-me").recipes["kiro-ide"];
  assert.equal(kiro.selection.recipe.reference.sha256, entry.sha256);
  assert.deepEqual(kiro.selection.recipe.reference.materials.map((member) => member.id), entry.materials);
});

await case_("an unknown release format is refused precisely", () => {
  const document = json("fixtures/release-1-7/extensions-release-1.7.0.json");
  document.schema = "urn:aihq:catalog:release:1.8.0";
  const bytes = encode(`${JSON.stringify(document)}\n`);
  const read = readReleaseContent(bytes, { expectedSha256: sha256(bytes) });
  assert.equal(read.valid, false);
  assert.equal(read.diagnostics[0].code, "SCHEMA_UNSUPPORTED");
  assert.equal(read.diagnostics[0].encountered, "urn:aihq:catalog:release:1.8.0");
  assert.ok(read.diagnostics[0].supported.includes("urn:aihq:catalog:release:1.7.0"));
});

await case_("the frozen default is read from a later package version by its historical digest", async () => {
  const entry = releaseInventory.releases.find((release) => release.release === "./release.json");
  assert.equal(entry.historical, true);
  assert.equal(entry.sha256, FROZEN_DEFAULT_RELEASE_SHA256);
  const later = mkdtempSync(join(tmpdir(), "aih-catalog-later-"));
  try {
    cpSync(root, later, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(later, "package.json"), "utf8"));
    manifest.version = "0.2.0";
    writeFileSync(join(later, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const frozen = await readInstalledRelease({ root: later, release: "./release.json" });
    assert.equal(frozen.valid, true, JSON.stringify(frozen.diagnostics));
    assert.equal(frozen.release.package.version, "0.1.0");
    const ordinary = await readInstalledRelease({ root: later, release: "./release-extensions.json" });
    assert.equal(ordinary.valid, false);
    assert.ok(ordinary.diagnostics.some((d) => d.reason === "package-mismatch"));
    const document = JSON.parse(readFileSync(join(later, "release/release.json"), "utf8"));
    document.items[0].label = `${document.items[0].label} (changed)`;
    const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value)
      : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    writeFileSync(join(later, "release/release.json"), `${canonical(document)}\n`);
    const changed = await readInstalledRelease({ root: later, release: "./release.json" });
    assert.equal(changed.valid, false);
    // Any other bytes are an ordinary release again, held to the package identity.
    assert.ok(changed.diagnostics.some((d) => d.reason === "package-mismatch"), JSON.stringify(changed.diagnostics));
  } finally {
    rmSync(later, { recursive: true, force: true });
  }
});

/** A checked release 1.6 of one tool's copies, built through the public 3.2.0 producer. */
const copies = (items, extra = {}) => {
  const compiled = compileProducerDeclaration({
    declaration: {
      schema: "urn:aihq:catalog:producer-declaration:3.2.0", format: "aihq-catalog-producer-declaration", version: 3,
      framework: { id: "notes", name: "Notes", version: "1.0.0", description: "Packed transition framework." },
      sources: [{ id: "notes", repository: "example/notes", licensePath: "LICENSE", license: "MIT" }],
      items: items.map(({ id, ...rest }) => ({
        id, source: "notes", label: "review", description: "Review", kind: "skill", skillPath: "review/SKILL.md",
        requires: [], optional: [], conflicts: [], clientCapabilities: [], activation: [],
        configuration: { agentDirectory: { type: "string", required: true, default: ".claude", minLength: 1, maxLength: 64,
          description: "Project directory that receives skills/<name>/ (Claude Code reads .claude)." } },
        ...rest,
      })),
    },
    sourceFiles: [{ source: "notes", revision: "a".repeat(40), files: Object.fromEntries(Object.entries({
      LICENSE: "MIT license fixture\n", "review/SKILL.md": "---\ndescription: Review.\n---\n# Review\n",
      "review/notes.md": "Support.\n", ...extra,
    }).map(([path, text]) => [path, encode(text)])) }],
  });
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
  return compiled.value.release;
};
const transition = (releases, earlier, items, extra = {}) => compileTransitionRelease({
  releases: Object.fromEntries(releases.map((release) => [release.sha256, release])), earlier,
  framework: { id: "notes", name: "Notes", version: "1.1.0", description: "Packed transition framework." },
  package: { name: "supplied-catalog", version: "0.0.0" }, items, ...extra,
});
const survivor = (id, pairs) => ({ id, kind: "skill", role: "choosable",
  copies: pairs.map(([release, itemId, clientId]) => ({ releaseSha256: release.sha256, itemId, ...(clientId ? { clientId } : {}) })) });

await case_("collapsed copies keep the union of materials and conflicting copies are refused", () => {
  const claude = copies([{ id: "notes.review", supportPaths: ["notes.md"] }]);
  const kiro = copies([{ id: "notes.kiro.review" }]);
  const built = transition([claude, kiro], [claude.sha256, kiro.sha256],
    [survivor("notes.review", [[claude, "notes.review", "claude-code"], [kiro, "notes.kiro.review", "kiro-ide"]])]);
  assert.equal(built.status, "ok", JSON.stringify(built.diagnostics));
  const review = built.value.release.items[0];
  assert.equal(built.value.release.items.length, 1);
  assert.ok(review.materials.some((member) => member.relPath === "notes.md"));
  assert.deepEqual(built.value.release.retired.map((entry) => entry.id), ["notes.kiro.review"]);
  const fork = copies([{ id: "notes.kiro.review" }], { "review/SKILL.md": "---\ndescription: Fork.\n---\n# Fork\n" });
  const refused = transition([claude, fork], [],
    [survivor("notes.review", [[claude, "notes.review", "claude-code"], [fork, "notes.kiro.review", "kiro-ide"]])]);
  assert.equal(refused.status, "refused");
  assert.ok(refused.diagnostics.some((d) => d.reason === "conflicting-copies"));
});

await case_("an unmapped rename or an unretired drop fails the build", () => {
  const release = copies([{ id: "notes.review" }]);
  const empty = transition([release], [release.sha256], [], {});
  assert.ok(empty.diagnostics.some((d) => d.reason === "dropped-without-retirement"), JSON.stringify(empty.diagnostics));
  const moved = copies([{ id: "notes.renamed" }]);
  const renamed = transition([release, moved], [release.sha256], [survivor("notes.renamed", [[moved, "notes.renamed"]])], {
    retired: [{ id: "notes.review", reason: "Renamed.", replacedBy: [{ framework: "notes", itemId: "notes.renamed" }] }],
  });
  assert.ok(renamed.diagnostics.some((d) => d.reason === "unmapped-rename"), JSON.stringify(renamed.diagnostics));
});

await case_("the restructuring comparison checks hashes and supersessions row by row", () => {
  const release = content("fixtures/release-1-7/extensions-release-1.7.0.json");
  const expectation = json("restructuring/expected-1.7.0.json");
  const result = compareRestructuring({ release, expectation });
  const row = (check, subject) => result.rows.find((entry) => entry.check === check && entry.subject === subject);
  assert.equal(row("hash", "extensions.matt.grill-me").status, "pass");
  assert.equal(row("supersession", "extensions.matt.grill-me <- mattpocock.grill-me").status, "pass");
  assert.equal(row("supersession", "extensions.matt.grill-me <- extensions.kiro.matt.grill-me").status, "pass");
  // The golden fixture is two skills of the 57-item framework, so the release as a whole fails.
  assert.equal(result.status, "fail");
  assert.equal(expectation.counts.mattSupersessions, 27);
});

await case_("a split spreads the frozen default's project context over three survivors", () => {
  const release = content("fixtures/release-1-7/split-supersession-release-1.7.0.json");
  const splits = release.items.filter((item) =>
    item.supersedes?.some((entry) => entry.itemId === "aihq.project-context" && entry.match === "split"));
  assert.equal(splits.length, 3);
});

process.stdout.write(JSON.stringify({ results }));
