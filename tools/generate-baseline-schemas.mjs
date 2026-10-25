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
  { if: { properties: { kind: { const: "skill" } }, required: ["kind", "payload"] }, then: { properties: { payload: skillPayload } } },
  { if: { properties: { kind: { const: "rule" } }, required: ["kind", "payload"] }, then: { properties: { payload: rulePayload } } },
  { if: { properties: { kind: { const: "hook" } }, required: ["kind", "payload"] }, then: { properties: { payload: hookPayload } } },
  { if: { properties: { kind: { const: "mcp-server" } }, required: ["kind", "payload"] }, then: { properties: { payload: mcpPayload } } },
  { if: { properties: { kind: { const: "agent" } }, required: ["kind", "payload"] }, then: { properties: { payload: filesPayload } } },
  { if: { properties: { kind: { const: "command" } }, required: ["kind", "payload"] }, then: { properties: { payload: filesPayload } } },
  { if: { properties: { kind: { const: "document" } }, required: ["kind", "payload"] }, then: { properties: { payload: filesPayload } } },
];
const release16 = structuredClone(release);
release16.$id = "urn:aihq:catalog:release:1.6.0";
release16.title = "Catalog release with behaviour files, two identities, typed payloads and provenance";
release16.description = "Adds optional behaviour materials, contentSha256/behaviourSha256 identities, typed payloads, framework identity, provenance and measured sizes. All new fields are optional; recipes and item ids are unchanged. A baseline binding, required for prepared releases, is validated when present. The reader recomputes behaviour bytes and both identities.";
release16.required = release16.required.filter((key) => key !== "baseline");
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
for (const [name, schema] of [
  ["release/1.5.0", release], ["content-inventory/1.0.0", inventory],
  ["release/1.6.0", release16], ["content-inventory/1.1.0", inventory11],
  ["scan-baseline/1.0.0", { $schema: base.$schema, $id: "urn:aihq:catalog:scan-baseline:1.0.0", ...baseline }],
  ["release-content/1.0.0", { $schema: base.$schema, $id: "urn:aihq:catalog:release-content:1.0.0", ...content, $defs: base.$defs }],
  ["release-content/1.1.0", { $schema: base.$schema, $id: "urn:aihq:catalog:release-content:1.1.0", ...content16, $defs: release16.$defs }],
]) {
  const path = resolve(root, `schemas/${name}.json`), bytes = `${JSON.stringify(schema, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== bytes) throw new Error(`stale baseline schema: ${name}`);
  } else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
}
