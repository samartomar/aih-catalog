// Owns the baseline schemas and their standalone content projection.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const base = JSON.parse(readFileSync(resolve(root, "schemas/release/1.4.0.json")));
const object = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, required, properties });
const digest = { type: "string", pattern: "^[0-9a-f]{64}$" };
const path = { type: "string", minLength: 1, maxLength: 4096, description: "Canonical safe package-relative member path; reader enforces the portable path profile." };
const descriptor = object({ path, sha256: digest, byteLength: { type: "integer", minimum: 1, maximum: 16777216 } });
const pathList = { type: "array", maxItems: 10000, uniqueItems: true, items: path, description: "Sorted by code unit; requested scope, not achieved coverage." };
const baseline = object({
  schema: { const: "urn:aihq:catalog:scan-baseline:1.0.0" },
  inventory: descriptor,
  scanId: { type: "string", pattern: "^scan:sha256:[0-9a-f]{64}$" },
  artifact: object({ sha256: digest, byteLength: { type: "integer", minimum: 1, maximum: 67108864 }, location: { oneOf: [
    object({ kind: { const: "package" }, path }),
    object({ kind: { const: "https" }, url: { type: "string", maxLength: 2048, pattern: "^https://", description: "No credentials, fragment or non-443 port; reader enforces URL profile." } }),
  ] } }),
  scope: object({ namespace: { const: "package-relative" }, paths: pathList, excludedPaths: pathList }),
});
baseline.properties.artifact.allOf = [{ if: { properties: { location: { type: "object", properties: { kind: { const: "package" } } } } }, then: { properties: { byteLength: { type: "integer", maximum: 16777216 } } } }];
const release = structuredClone(base);
release.$id = "urn:aihq:catalog:release:1.5.0";
release.title = "Catalog release with a pinned content assessment baseline";
release.description = "All release content fields except baseline form content-inventory 1.0. The reader recomputes the exact inventory digest and length. A binding describes evidence, not safety, authentication or execution authority.";
release.properties.schema.const = release.$id;
release.required.push("baseline");
release.properties.baseline = baseline;
const content = structuredClone(release);
delete content.$schema; delete content.$id; delete content.$defs;
content.required = content.required.filter(key => key !== "baseline");
delete content.properties.baseline;
const inventory = {
  $schema: base.$schema, $id: "urn:aihq:catalog:content-inventory:1.0.0",
  title: "Complete release content projection before assessment",
  ...object({ schema: { const: "urn:aihq:catalog:content-inventory:1.0.0" },
    projection: { const: "urn:aihq:catalog:release-content:1.0.0" }, release: { $ref: "#/$defs/releaseContent" } }),
  $defs: { ...base.$defs, releaseContent: content },
};
// Release 1.6.0 adds behaviour files, two identities, typed payloads, true
// provenance and measured sizes, all optional alongside the 1.5 baseline binding.
const truthy = { enum: [true, false, "unknown"] };
const sizeMeasure = object({ bytes: { type: "integer", minimum: 0 }, chars: { type: "integer", minimum: 0 }, status: { enum: ["measured", "unknown"] } });
const upstreamProof = object({ sourceId: { $ref: "#/$defs/id" }, path: { $ref: "#/$defs/path" }, gitBlob: { type: "string", pattern: "^[0-9a-f]{40}$" }, transform: { enum: ["identical", "edited"] } });
const material16 = object({
  id: { $ref: "#/$defs/id" },
  relPath: { $ref: "#/$defs/path" },
  sourcePath: { type: ["string", "null"], maxLength: 4096 },
  packagePath: { $ref: "#/$defs/path" },
  sha256: { $ref: "#/$defs/sha256" },
  byteLength: { type: "integer", minimum: 0, maximum: 16777216 },
  executable: truthy,
  sourceId: { $ref: "#/$defs/id" },
  role: { enum: ["content", "behaviour"] },
}, ["id", "relPath", "packagePath", "sha256", "byteLength", "executable", "sourceId"]);
material16.properties.upstream = upstreamProof;
material16.properties.size = sizeMeasure;
const nameBasis = { enum: ["authored", "first-heading", "key", "file-name", "publisher"] };
const typedInput = { type: "object", additionalProperties: { $ref: "#/$defs/input" } };
const skillPayload = object({ dirName: { type: "string", minLength: 1, maxLength: 256 }, namespace: { type: "string", minLength: 1, maxLength: 256 }, invocation: { enum: ["user-only", "model-allowed"] }, invocationBasis: { type: "string", minLength: 1, maxLength: 4096 } }, ["dirName", "invocation", "invocationBasis"]);
const rulePayload = object({ namespace: { type: "string", minLength: 1, maxLength: 256 }, applyTo: { type: "array", minItems: 1, maxItems: 4096, items: { type: "string", minLength: 1, maxLength: 4096 } }, applyToBasis: { type: "string", minLength: 1, maxLength: 4096 }, inclusion: { enum: ["always", "fileMatch", "manual"] }, placement: { enum: ["file", "entry-block", "project-folder"] } }, ["applyTo", "applyToBasis"]);
const hookCommand = object({ program: { type: "string", minLength: 1, maxLength: 4096 }, interpreter: { enum: ["node", "bash", "python", "pwsh"] }, script: { $ref: "#/$defs/id" }, args: { type: "array", maxItems: 4096, items: { oneOf: [{ type: "string" }, object({ material: { $ref: "#/$defs/id" } }, ["material"])] } } }, ["script"]);
const hookPayload = object({ event: { type: "string", minLength: 1, maxLength: 256 }, matcher: { type: "string", minLength: 1, maxLength: 4096 }, protocol: { const: "claude-code-hooks" }, timeoutSec: { type: "integer", minimum: 1, maximum: 86400 }, command: hookCommand }, ["event", "protocol", "command"]);
const envEntry = { oneOf: [object({ input: { type: "string", minLength: 1, maxLength: 256 } }, ["input"]), object({ value: { type: "string", minLength: 1, maxLength: 4096 } }, ["value"])] };
const mcpPayload = object({
  key: { type: "string", minLength: 1, maxLength: 256 },
  transport: { enum: ["stdio", "http", "sse"] },
  command: { type: "string", minLength: 1, maxLength: 4096 },
  args: { type: "array", maxItems: 4096, items: { type: "string", minLength: 1, maxLength: 4096 } },
  url: { type: "string", minLength: 1, maxLength: 2048 },
  env: { type: "object", additionalProperties: envEntry },
  headers: { type: "object", additionalProperties: envEntry },
  derivation: object({ sourceMaterial: { $ref: "#/$defs/id" }, pointer: { type: "string", minLength: 1, maxLength: 4096 }, transform: { enum: ["identical", "edited"] }, editsSha256: { $ref: "#/$defs/sha256" } }, ["sourceMaterial", "pointer", "transform"]),
}, ["key", "transport"]);
mcpPayload.allOf = [
  { if: { properties: { transport: { const: "stdio" } } }, then: { required: ["command"], properties: { command: true } } },
  { if: { properties: { transport: { enum: ["http", "sse"] } } }, then: { required: ["url"], properties: { url: true } } },
];
const filesPayload = object({ files: { type: "array", maxItems: 4096, items: { $ref: "#/$defs/id" } } }, ["files"]);
const payloadByKind = { oneOf: [skillPayload, rulePayload, hookPayload, mcpPayload, filesPayload] };
const derivedFromEntry = object({
  itemId: { $ref: "#/$defs/id" },
  releaseSha256: { $ref: "#/$defs/sha256" },
  status: { enum: ["verified", "declared"] },
  proof: object({ materials: { type: "array", minItems: 1, maxItems: 4096, items: object({ relPath: { $ref: "#/$defs/path" }, sha256: { $ref: "#/$defs/sha256" } }, ["relPath", "sha256"]) } }, ["materials"]),
}, ["itemId", "status"]);
const partSize = object({ part: { enum: ["name", "description", "frontmatter", "body", "files"] }, bytes: { type: "integer", minimum: 0 }, chars: { type: "integer", minimum: 0 } }, ["part", "bytes", "chars"]);
const item16 = structuredClone(base.$defs.item);
item16.properties.name = { type: "string", minLength: 1, maxLength: 256 };
item16.properties.nameBasis = nameBasis;
item16.properties.descriptionBasis = nameBasis;
item16.properties.payload = payloadByKind;
item16.properties.requirements = object({ inputs: typedInput }, []);
item16.properties.executable = { type: "object", propertyNames: { $ref: "#/$defs/path" }, additionalProperties: truthy };
item16.properties.contentSha256 = { $ref: "#/$defs/sha256" };
item16.properties.behaviourSha256 = { $ref: "#/$defs/sha256" };
item16.properties.source = { type: "string", minLength: 1, maxLength: 4096 };
item16.properties.selectedBy = { type: "string", minLength: 1, maxLength: 4096 };
item16.properties.derivedFrom = { type: "array", maxItems: 4096, items: derivedFromEntry };
item16.properties.size = object({ parts: { type: "array", minItems: 1, maxItems: 8, items: partSize }, status: { enum: ["measured", "unknown"] } }, ["parts"]);
item16.properties.materials = { type: "array", maxItems: 4096, items: { oneOf: [{ $ref: "#/$defs/member" }, { $ref: "#/$defs/material16" }] } };
item16.allOf = [
  ...(item16.allOf ?? []),
  { if: { properties: { kind: { const: "skill" } }, required: ["kind"] }, then: { properties: { payload: skillPayload } } },
  { if: { properties: { kind: { const: "rule" } }, required: ["kind"] }, then: { properties: { payload: rulePayload } } },
  { if: { properties: { kind: { const: "hook" } }, required: ["kind"] }, then: { properties: { payload: hookPayload } } },
  { if: { properties: { kind: { const: "mcp-server" } }, required: ["kind"] }, then: { properties: { payload: mcpPayload } } },
  { if: { properties: { kind: { const: "agent" } }, required: ["kind"] }, then: { properties: { payload: filesPayload } } },
  { if: { properties: { kind: { const: "command" } }, required: ["kind"] }, then: { properties: { payload: filesPayload } } },
  { if: { properties: { kind: { const: "document" } }, required: ["kind"] }, then: { properties: { payload: filesPayload } } },
];
const release16 = structuredClone(release);
release16.$id = "urn:aihq:catalog:release:1.6.0";
release16.title = "Catalog release with behaviour files, two identities, typed payloads and provenance";
release16.description = "Adds optional behaviour materials, contentSha256/behaviourSha256 identities, typed payloads, framework identity, provenance and measured sizes. All new fields are optional; recipes and item ids are unchanged. Like release 1.5, the release carries its baseline binding. The reader recomputes behaviour bytes and both identities.";
release16.properties.schema.const = release16.$id;
release16.properties.framework = object({ id: { $ref: "#/$defs/id" }, name: { type: "string", minLength: 1, maxLength: 256 }, version: { $ref: "#/$defs/version" }, description: { type: "string", minLength: 1, maxLength: 4096 } });
release16.properties.retired = { type: "array", maxItems: 4096, items: object({ id: { $ref: "#/$defs/id" }, reason: { type: "string", minLength: 1, maxLength: 4096 }, replacedBy: { type: "array", maxItems: 4096, items: { $ref: "#/$defs/id" } } }, ["id", "reason"]) };
release16.properties.nativeRoutes = { type: "array", maxItems: 4096, items: { type: "string", minLength: 1, maxLength: 4096 } };
const source16 = structuredClone(base.$defs.source);
source16.properties.license = { type: "string", minLength: 1, maxLength: 256, description: "SPDX license identifier for this source hop." };
release16.properties.sources = { type: "array", items: source16 };
release16.properties.items = { type: "array", items: { $ref: "#/$defs/item16" } };
release16.$defs = { ...release16.$defs, item16, material16, sizeMeasure };
const content16 = structuredClone(release16);
delete content16.$schema; delete content16.$id; delete content16.$defs;
content16.required = content16.required.filter(key => key !== "baseline");
delete content16.properties.baseline;
const inventory11 = {
  $schema: base.$schema, $id: "urn:aihq:catalog:content-inventory:1.1.0",
  title: "Complete release content projection for releases with behaviour files",
  ...object({ schema: { const: "urn:aihq:catalog:content-inventory:1.1.0" },
    projection: { const: "urn:aihq:catalog:release-content:1.1.0" }, release: { $ref: "#/$defs/releaseContent" } }),
  $defs: { ...release16.$defs, releaseContent: content16 },
};
// Release 1.7.0: one tool-neutral item per piece of content. Every release 1.6
// item field is required, kinds are closed, documents carry a purpose, and an
// item carries one recipe or a transition map keyed by client id. Supersession,
// durable retirement, embedded sets and the declarations outside both identities
// arrive here. The reader additionally recomputes behaviour files, identities and
// set digests, and checks every cross-field rule.
const sets = JSON.parse(readFileSync(resolve(root, "schemas/release-sets/1.0.0.json")));
const setDefs = Object.fromEntries(Object.entries(sets.$defs).map(([key, value]) => [`set_${key}`, value]));
const rewriteRefs = (value) => {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) =>
    [key, key === "$ref" && typeof inner === "string" ? inner.replace("#/$defs/", "#/$defs/set_") : rewriteRefs(inner)]));
};
for (const key of Object.keys(setDefs)) setDefs[key] = rewriteRefs(setDefs[key]);
const clientId = { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" };
const idList = { type: "array", maxItems: 4096, uniqueItems: true, items: { $ref: "#/$defs/id" } };
const recipe17 = structuredClone(base.$defs.item.properties.recipe);
const recipeEntry = structuredClone(recipe17);
recipeEntry.required.push("materials", "inputs");
recipeEntry.properties.materials = { ...idList, description: "Ascending content material ids: exactly this recipe's material closure." };
recipeEntry.properties.inputs = { ...idList, description: "Ascending input names of the item this recipe defines." };
const itemIdentityRef = { releaseSha256: { $ref: "#/$defs/sha256" }, itemId: { $ref: "#/$defs/id" }, itemSha256: { $ref: "#/$defs/sha256" }, contentSha256: { $ref: "#/$defs/sha256" }, behaviourSha256: { $ref: "#/$defs/sha256" } };
const supersession = { oneOf: [
  object({ match: { const: "hash" }, ...itemIdentityRef }, ["match", "releaseSha256", "itemId", "itemSha256", "contentSha256"]),
  object({ match: { const: "name+sourcePath" }, ...itemIdentityRef, name: { type: "string", minLength: 1, maxLength: 256 }, sourcePath: { $ref: "#/$defs/path" } }, ["match", "releaseSha256", "itemId", "itemSha256", "name", "sourcePath"]),
  object({ match: { const: "split" }, ...itemIdentityRef }, ["match", "releaseSha256", "itemId", "itemSha256"]),
] };
const sameReleaseRef = object({ itemId: { $ref: "#/$defs/id" } });
const documentPayload = object({ files: { type: "array", maxItems: 4096, items: { $ref: "#/$defs/id" } }, purpose: { enum: ["notice", "license", "reference", "guide"] }, placement: { enum: ["file", "entry-block", "project-folder"] } }, ["files", "purpose"]);
const dependencyRef17 = structuredClone(base.$defs.dependencyRef);
dependencyRef17.oneOf[1].required.push("contentSha256", "behaviourSha256");
dependencyRef17.oneOf[1].properties.contentSha256 = { $ref: "#/$defs/sha256" };
dependencyRef17.oneOf[1].properties.behaviourSha256 = { $ref: "#/$defs/sha256" };
const dependencyList17 = { type: "array", items: { $ref: "#/$defs/dependencyRef17" } };
const item17 = structuredClone(item16);
delete item17.properties.clientId;
item17.properties.kind = { enum: ["skill", "agent", "command", "rule", "hook", "mcp-server", "document"] };
item17.properties.role = { enum: ["choosable", "supporting"], description: "Presentation only." };
// Sizes as the contract states them: exact bytes, characters when the bytes are text, labelled token counts.
const tokenCounts = (key) => ({ type: "array", maxItems: 16, items: object({ tokenizer: { $ref: "#/$defs/id" }, [key]: { type: "integer", minimum: 0 } }) });
const material17 = structuredClone(material16);
material17.properties.size = object({ bytes: { type: "integer", minimum: 0 }, chars: { type: ["integer", "null"], minimum: 0 }, tokens: tokenCounts("count"), status: { enum: ["measured", "not-text", "unsupported"] } });
item17.properties.materials = { type: "array", maxItems: 4096, items: { $ref: "#/$defs/material17" } };
item17.properties.size = object({ parts: { type: "array", minItems: 1, maxItems: 8, items: object({ part: { enum: ["name", "description", "frontmatter", "body", "files"] }, bytes: { type: "integer", minimum: 0 }, chars: { type: ["integer", "null"], minimum: 0 } }) }, tokens: tokenCounts("sum") });
// Provenance hops replace the 1.6 URL fields: the source whose tree holds the bytes,
// who selected it when not the source, and real modified hops, nearest first.
const hop = { sourceId: { $ref: "#/$defs/id" }, path: { $ref: "#/$defs/path" }, revision: { type: "string", minLength: 1, maxLength: 128 } };
delete item17.properties.selectedBy;
delete item17.properties.derivedFrom;
item17.properties.provenance = object({
  source: object({ ...hop, license: { type: "string", minLength: 1, maxLength: 256 } }),
  selectedBy: object(hop),
  derivedFrom: { type: "array", maxItems: 64, items: object({ ...hop, license: { type: "string", minLength: 1, maxLength: 256 }, ancestry: { enum: ["verified", "declared"] } }) },
}, ["source", "derivedFrom"]);
item17.properties.recipe = recipe17;
item17.properties.recipes = { type: "object", minProperties: 1, maxProperties: 64, propertyNames: clientId, additionalProperties: recipeEntry, description: "Transition recipes of the replaced tool variants, selected by clientId." };
item17.properties.supersedes = { type: "array", minItems: 1, maxItems: 4096, items: supersession };
item17.properties.fallback = sameReleaseRef;
item17.properties.variantOf = sameReleaseRef;
item17.properties.hints = object({ tools: { type: "array", maxItems: 64, uniqueItems: true, items: clientId } });
const hookPayload17 = structuredClone(hookPayload);
hookPayload17.properties.async = { type: "boolean", description: "Runs without blocking the tool, as the upstream registers it." };
item17.properties.payload = { oneOf: [skillPayload, rulePayload, hookPayload17, mcpPayload, filesPayload, documentPayload] };
item17.properties.dependencies = object({ requires: dependencyList17, optional: dependencyList17, conflicts: dependencyList17 }, []);
delete item17.properties.source;
item17.required = ["id", "label", "kind", "role", "name", "nameBasis", "provenance", "sourceIds", "targets", "scopes", "inputs", "materials", "dependencies", "payload", "requirements", "executable", "contentSha256", "behaviourSha256"];
item17.oneOf = [{ required: ["recipe"], properties: { recipe: true } }, { required: ["recipes"], properties: { recipes: true } }];
item17.allOf = item17.allOf.map((rule) => rule.if?.properties?.kind?.const === "document"
  ? { ...rule, then: { properties: { payload: documentPayload } } }
  : rule.if?.properties?.kind?.const === "hook" ? { ...rule, then: { properties: { payload: hookPayload17 } } } : rule);
item17.allOf.push({ if: { properties: { kind: { enum: ["agent", "command"] } }, required: ["kind"] }, then: { properties: { fallback: false } } });
const release17 = structuredClone(release16);
release17.$id = "urn:aihq:catalog:release:1.7.0";
release17.title = "Catalog release with one tool-neutral item per piece of content";
release17.description = "Closed kinds, a presentation role, required behaviour files and both identities, supersession, durable retirement, embedded sets and an optional transition recipe map selected by clientId. Readers older than 1.7.0 refuse the whole format. Like release 1.5 and 1.6, the release carries its baseline binding.";
release17.properties.schema.const = release17.$id;
release17.required = ["schema", "package", "framework", "sources", "items", "baseline"];
const source17 = structuredClone(source16);
source17.required = [...source17.required, "license"];
release17.properties.sources = { type: "array", items: source17 };
release17.properties.items = { type: "array", items: { $ref: "#/$defs/item17" } };
release17.properties.retired = { type: "array", maxItems: 4096, items: object({ id: { $ref: "#/$defs/id" }, reason: { type: "string", minLength: 1, maxLength: 4096 }, replacedBy: { type: "array", maxItems: 4096, items: object({ framework: { $ref: "#/$defs/id" }, itemId: { $ref: "#/$defs/id" } }) } }) };
release17.properties.sets = { type: "array", maxItems: 4096, items: { $ref: "#/$defs/set_set" } };
release17.$defs = { ...release16.$defs, ...setDefs, item17, material17, dependencyRef17 };
const content17 = structuredClone(release17);
delete content17.$schema; delete content17.$id; delete content17.$defs;
content17.required = content17.required.filter(key => key !== "baseline");
delete content17.properties.baseline;
const inventory12 = {
  $schema: base.$schema, $id: "urn:aihq:catalog:content-inventory:1.2.0",
  title: "Complete release content projection for release 1.7.0",
  ...object({ schema: { const: "urn:aihq:catalog:content-inventory:1.2.0" },
    projection: { const: "urn:aihq:catalog:release-content:1.2.0" }, release: { $ref: "#/$defs/releaseContent" } }),
  $defs: { ...release17.$defs, releaseContent: content17 },
};
for (const [name, schema] of [
  ["release/1.5.0", release], ["content-inventory/1.0.0", inventory],
  ["release/1.6.0", release16], ["content-inventory/1.1.0", inventory11],
  ["scan-baseline/1.0.0", { $schema: base.$schema, $id: "urn:aihq:catalog:scan-baseline:1.0.0", ...baseline }],
  ["release-content/1.0.0", { $schema: base.$schema, $id: "urn:aihq:catalog:release-content:1.0.0", ...content, $defs: base.$defs }],
  ["release-content/1.1.0", { $schema: base.$schema, $id: "urn:aihq:catalog:release-content:1.1.0", ...content16, $defs: release16.$defs }],
  ["release/1.7.0", release17], ["content-inventory/1.2.0", inventory12],
  ["release-content/1.2.0", { $schema: base.$schema, $id: "urn:aihq:catalog:release-content:1.2.0", ...content17, $defs: release17.$defs }],
]) {
  const path = resolve(root, `schemas/${name}.json`), bytes = `${JSON.stringify(schema, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== bytes) throw new Error(`stale baseline schema: ${name}`);
  } else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
}
