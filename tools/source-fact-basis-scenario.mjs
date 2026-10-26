import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { checkProducerDeclaration, compileProducerDeclaration } from "@aihq/catalog/producer";
import { readRelease, readReleaseContent } from "@aihq/catalog/reader";
import { extractSourceFacts } from "@aihq/catalog/source";

const root = new URL(".", import.meta.resolve("@aihq/catalog/package.json"));
const template = JSON.parse(readFileSync(new URL("producer/templates/public/declaration.json", root)));
const enc = value => new TextEncoder().encode(value);
const sha = value => createHash("sha256").update(value).digest("hex");
const baseFiles = Object.fromEntries(["LICENSE", "recipe.json", "note.md"].map(path =>
  [path, new Uint8Array(readFileSync(new URL(`producer/templates/public/${path}`, root)))]));
const sourcePath = "example/note.md";
const authored = '---\nname: example\ndescription: |\n  First source line.\n  Second source line.\ncompatibility: Requires a terminal\nmetadata:\n  owner: Example\n---\nBody stays separate.\n';
const cases = [
  ["agent-skills", authored, "valid", "authored", "authored", "authored"],
  ["markdown", "# Source heading\nBody stays separate.\n", "valid", "authored", "absent", "first-heading"],
  ["claude-command", "---\n---\nBody is not purpose.\n", "valid", "absent", "absent"],
  ["agent-skills", "---\nname: example\n---\n", "profile-error", "authored", "absent", "authored"],
  ["agent-skills", "---\nname: [wrong]\ndescription: 12\n---\n", "profile-error", "invalid", "invalid"],
  ["agent-skills", "---\nname: [broken\n---\n", "malformed", "absent", "absent"],
  ["claude-mcp-registration", '{"mcpServers":{"example":{"command":"node","args":["server.js"]}}}', "valid", "absent", "absent", undefined, "example"],
  ["claude-hooks", '{"hooks":{}}', "valid", "absent", "absent"],
];
for (const version of ["3.0.0", "3.1.0", "3.2.0"]) {
  const local = version === "3.1.0";
  for (const [profile, text, status, nameState, descriptionState, basis, key] of cases) {
    const declaration = structuredClone(template);
    declaration.schema = `urn:aihq:catalog:producer-declaration:${version}`;
    if (version === "3.2.0") {
      declaration.items[0].payload = {applyTo:["**/*"], applyToBasis:"publisher"};
      declaration.framework = {id:"example", name:"Example", version:"1.0.0", description:"Example source facts"};
    }
    if (local) {
      delete declaration.sources[0].repository;
      declaration.sources[0].origin = { kind: "local" };
    }
    declaration.items[0].materials.find(m => m.id === "note").path = sourcePath;
    declaration.items[0].sourceDiscovery = { profile, path: sourcePath, ...(key ? {key} : {}) };
    const revision = "a".repeat(local ? 64 : 40), bytes = enc(text);
    const facts = extractSourceFacts({profile, path: sourcePath, revision, bytes, ...(key ? {key} : {})});
    assert.equal(facts.status, status);
    assert.equal(facts.name.state, nameState);
    assert.equal(facts.description.state, descriptionState);
    if (basis) assert.equal(facts.name.basis, basis);
    if (descriptionState === "authored") assert.equal(facts.description.basis, "authored");
    for (const field of [facts.name, facts.description]) {
      if (field.state !== "authored") assert(!Object.hasOwn(field, "basis"));
    }
    const compiled = compileProducerDeclaration({declaration, sourceFiles:[{
      source: "notes", revision, files: {...baseFiles, [sourcePath]: bytes},
    }]});
    assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
    const wire = JSON.parse(new TextDecoder().decode(compiled.value.releaseBytes));
    assert.deepEqual(wire.items[0].metadata.sourceFacts, facts);
    assert.equal(sha(compiled.value.releaseBytes), compiled.value.releaseSha256);
    const reader = version === "3.2.0" ? readReleaseContent : readRelease;
    const checked = reader(compiled.value.releaseBytes, {expectedSha256: compiled.value.releaseSha256});
    assert(checked.valid, JSON.stringify(checked.diagnostics));
    assert.deepEqual(checked.release.items[0].metadata.sourceFacts, facts);
    const material = checked.release.items[0].materials.find(m => m.id === "note");
    assert.equal(material.sha256, sha(bytes));
    assert.deepEqual(compiled.value.materials.find(m => m.path === (material.path ?? material.packagePath)).bytes, bytes);
    // Earlier stored metadata remains generic JSON; reading never fabricates basis.
    const historical = structuredClone(wire);
    delete historical.items[0].metadata.sourceFacts.name.basis;
    delete historical.items[0].metadata.sourceFacts.description.basis;
    const keys = new Set();
    JSON.stringify(historical, (key, value) => { keys.add(key); return value; });
    const oldBytes = enc(JSON.stringify(historical, [...keys].sort()) + "\n");
    const old = reader(oldBytes, {expectedSha256: sha(oldBytes)});
    assert(old.valid, JSON.stringify(old.diagnostics));
    assert.deepEqual(old.release.items[0].metadata.sourceFacts, historical.items[0].metadata.sourceFacts);
  }
}
for (const sourceDiscovery of [
  {profile:"unknown", path:"note.md"},
  {profile:"markdown", path:"../note.md"},
  {profile:"markdown", path:"note.md", basis:"authored"},
]) {
  const declaration = structuredClone(template);
  declaration.items[0].sourceDiscovery = sourceDiscovery;
  assert.equal(checkProducerDeclaration(declaration).status, "refused");
  assert.equal(compileProducerDeclaration({declaration, sourceFiles:[]}).status, "refused");
}
console.log("Source fact basis packed consumer passed");
