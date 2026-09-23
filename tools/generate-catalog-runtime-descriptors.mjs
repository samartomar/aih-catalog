import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the runtime-descriptor sidecar: for each framework runtime
 * descriptor Catalog distributes, its source revision, its origin and the path,
 * sha256 and length of its exact bytes, bound to the committed index.
 *
 * The descriptor bytes are Core's sealed runtime material, distributed unchanged.
 * They enter this repository only through `--ingest-core-source-data`, which
 * takes them from a Core `packaged-source-data-data.json` file after checking the
 * record's own seal and the descriptor's own seal, and records that origin in
 * `defaults/catalog-runtime-descriptors-inputs-v1.json`. Generation then re-checks
 * every committed descriptor against the seal Core declared for it: an edited
 * descriptor fails here instead of being republished.
 *
 * Reads only local files. Nothing is fetched, executed or re-signed.
 *
 *   node tools/generate-catalog-runtime-descriptors.mjs [--check] [catalog-root]
 *   node tools/generate-catalog-runtime-descriptors.mjs --ingest-core-source-data <file> [catalog-root]
 */
export const INPUT = "defaults/catalog-runtime-descriptors-inputs-v1.json";
export const OUTPUT = "defaults/catalog-runtime-descriptors-v1.json";
const INDEX = "defaults/catalog-index-v1.json";
const DESCRIPTOR_ROOT = "defaults/runtime-descriptors";
const MAX_DESCRIPTOR_BYTES = 12 * 1024 * 1024;
const MAX_CORE_FILE_BYTES = 64 * 1024 * 1024;
/** The descriptor formats this version distributes, by framework. */
const SUPPORTED = new Map([["ecc-runtime-descriptor/v1", "ecc"]]);

const SHA256_HEX = /^[0-9a-f]{64}$/;
const SEAL = /^sha256:[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (message) => {
  throw new Error(`catalog-runtime-descriptors: ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const object = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label);
  return value;
};
const exactKeys = (value, keys, label) => {
  object(value, label);
  const present = Object.keys(value).sort(compare);
  if (canonical(present) !== canonical([...keys].sort(compare))) fail(`${label}: unknown or missing members`);
  return value;
};

/** Where a descriptor for this exact source revision lives. One place, never chosen by hand. */
export function descriptorPath(repository, commit) {
  return `${DESCRIPTOR_ROOT}/github.com/${repository}/${commit}/ecc-runtime-descriptor-v1.json`;
}

/**
 * The descriptor's own declared identity, from canonical bytes that match a seal.
 * `label` names the input in any failure.
 */
function inspectDescriptor(bytes, seal, label) {
  if (!SEAL.test(seal ?? "")) fail(`${label}: seal`);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DESCRIPTOR_BYTES) fail(`${label}: size`);
  if (`sha256:${sha256(bytes)}` !== seal) fail(`${label}: bytes do not match the Core seal ${seal}`);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) fail(`${label}: not UTF-8`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return fail(`${label}: not JSON`);
  }
  // Core accepts only canonical strict JSON; anything else was rewritten after sealing.
  if (canonical(value) !== text) fail(`${label}: not canonical sorted-key JSON`);
  object(value, `${label}: descriptor`);
  const framework = SUPPORTED.get(value.version);
  if (framework === undefined) fail(`${label}: unsupported descriptor format ${JSON.stringify(value.version)}`);
  const source = object(value.source, `${label}: source`);
  if (!REPOSITORY.test(source.repository ?? "") || !GIT_COMMIT.test(source.commit ?? "")) {
    fail(`${label}: source`);
  }
  return { framework, format: value.version, repository: source.repository, commit: source.commit };
}

function readInputs(root) {
  const inputs = exactKeys(
    JSON.parse(readFileSync(resolve(root, INPUT), "utf8")),
    ["descriptors", "format", "version"],
    "inputs",
  );
  if (inputs.format !== "aih-catalog-runtime-descriptors-inputs" || inputs.version !== 1) {
    fail("unsupported inputs version");
  }
  if (!Array.isArray(inputs.descriptors) || inputs.descriptors.length === 0 || inputs.descriptors.length > 64) {
    fail("descriptors");
  }
  return inputs.descriptors.map((item, position) => {
    const label = `inputs.descriptors[${position}]`;
    exactKeys(item, ["coreSeal", "format", "framework", "origin", "path"], label);
    exactKeys(item.origin, ["kind", "recordSha256"], `${label}.origin`);
    if (item.origin.kind !== "core-packaged-source-data" || !SHA256_HEX.test(item.origin.recordSha256 ?? "")) {
      fail(`${label}.origin`);
    }
    return item;
  });
}

function githubSources(root) {
  const index = JSON.parse(readFileSync(resolve(root, INDEX), "utf8"));
  const sources = new Set();
  for (const entry of index.entries ?? []) {
    const source = entry?.subject?.source;
    if (source?.type === "github") sources.add(`${source.repository}\u0000${source.commit}`);
  }
  return sources;
}

/** Build the sidecar from the committed inputs, descriptors and index. */
export function generateCatalogRuntimeDescriptors(packageRoot) {
  const root = resolve(packageRoot);
  const indexBytes = readFileSync(resolve(root, INDEX));
  const sources = githubSources(root);
  const descriptors = readInputs(root).map((item, position) => {
    const label = `inputs.descriptors[${position}]`;
    const segments = typeof item.path === "string" ? item.path.split("/") : [];
    if (
      !item.path?.startsWith?.(`${DESCRIPTOR_ROOT}/`) ||
      segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\\"))
    ) {
      fail(`${label}: unsafe path`);
    }
    const bytes = readFileSync(resolve(root, ...segments));
    const identity = inspectDescriptor(bytes, item.coreSeal, label);
    if (identity.framework !== item.framework || identity.format !== item.format) {
      fail(`${label}: declared framework or format differs from the descriptor`);
    }
    if (item.path !== descriptorPath(identity.repository, identity.commit)) {
      fail(`${label}: path must be ${descriptorPath(identity.repository, identity.commit)}`);
    }
    if (!sources.has(`${identity.repository}\u0000${identity.commit}`)) {
      fail(`${label}: ${identity.repository}@${identity.commit} is not a source the index carries`);
    }
    return {
      descriptor: { byteLength: bytes.byteLength, path: item.path, sha256: sha256(bytes) },
      format: identity.format,
      framework: identity.framework,
      origin: { kind: item.origin.kind, recordSha256: item.origin.recordSha256 },
      source: { commit: identity.commit, repository: identity.repository, type: "github" },
    };
  });
  const key = (item) => `${item.framework}\u0000${item.source.repository}\u0000${item.source.commit}`;
  descriptors.sort((a, b) => compare(key(a), key(b)));
  for (let position = 1; position < descriptors.length; position += 1) {
    if (key(descriptors[position - 1]) === key(descriptors[position])) fail("duplicate descriptor");
  }
  return {
    descriptors,
    format: "aih-catalog-runtime-descriptors",
    index: { path: INDEX, sha256: sha256(indexBytes) },
    organizationAdmission: "not-authoritative",
    version: 1,
  };
}

/** Same canonical form as the index: the reader refuses anything else. */
export function serializeCatalogRuntimeDescriptors(value) {
  return `${canonical(value)}\n`;
}

/**
 * Takes every runtime descriptor out of a Core `packaged-source-data-data.json`
 * file (an array of sealed `{ bytes, sha256 }` records) and commits its exact
 * bytes and origin. Refuses a record whose bytes do not match its own seal, a
 * descriptor whose bytes do not match the seal the record declares for it, and
 * non-canonical descriptor bytes. Writes nothing unless every descriptor passes.
 */
export function ingestCoreSourceDataRuntimeDescriptors(packageRoot, coreFile) {
  const root = resolve(packageRoot);
  const fileBytes = readFileSync(resolve(coreFile));
  if (fileBytes.byteLength > MAX_CORE_FILE_BYTES) fail("Core source-data file is too large");
  const records = JSON.parse(fileBytes.toString("utf8"));
  if (!Array.isArray(records) || records.length === 0 || records.length > 64) fail("Core source-data file");
  const found = [];
  records.forEach((sealed, position) => {
    const label = `core record ${position}`;
    exactKeys(sealed, ["bytes", "sha256"], label);
    if (typeof sealed.bytes !== "string" || !SHA256_HEX.test(sealed.sha256 ?? "")) fail(`${label}: seal`);
    if (sha256(Buffer.from(sealed.bytes, "utf8")) !== sealed.sha256) fail(`${label}: bytes do not match the record seal`);
    const record = object(JSON.parse(sealed.bytes), label);
    if (record.version !== "packaged-workbench-source-data/v1") fail(`${label}: record version`);
    if (record.runtimeDescriptor === undefined) return;
    const carried = exactKeys(record.runtimeDescriptor, ["bytesBase64", "sha256"], `${label}.runtimeDescriptor`);
    const bytes = Buffer.from(String(carried.bytesBase64), "base64");
    if (bytes.toString("base64") !== carried.bytesBase64) fail(`${label}: descriptor base64`);
    const identity = inspectDescriptor(bytes, carried.sha256, `${label}.runtimeDescriptor`);
    const recordSource = object(record.source, `${label}.source`);
    if (recordSource.repository !== identity.repository || recordSource.commit !== identity.commit) {
      fail(`${label}: descriptor source differs from its record`);
    }
    found.push({
      bytes,
      input: {
        coreSeal: carried.sha256,
        format: identity.format,
        framework: identity.framework,
        origin: { kind: "core-packaged-source-data", recordSha256: sealed.sha256 },
        path: descriptorPath(identity.repository, identity.commit),
      },
    });
  });
  if (found.length === 0) fail("Core source-data file carries no runtime descriptor");

  let existing = [];
  try {
    existing = readInputs(root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const byPath = new Map(existing.map((item) => [item.path, item]));
  for (const { bytes, input } of found) {
    const target = resolve(root, ...input.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    byPath.set(input.path, input);
  }
  const descriptors = [...byPath.values()].sort((a, b) => compare(a.path, b.path));
  const inputs = { descriptors, format: "aih-catalog-runtime-descriptors-inputs", version: 1 };
  writeFileSync(resolve(root, INPUT), `${JSON.stringify(inputs, null, 2)}\n`);
  return found.map(({ input }) => input);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    if (args[0] === "--ingest-core-source-data") {
      if (args.length < 2 || args.length > 3 || args[1].startsWith("-")) {
        fail("usage: node tools/generate-catalog-runtime-descriptors.mjs --ingest-core-source-data <file> [catalog-root]");
      }
      const ingested = ingestCoreSourceDataRuntimeDescriptors(resolve(args[2] ?? here), args[1]);
      for (const item of ingested) console.log(`Ingested ${item.path} (${item.coreSeal})`);
      process.exit(0);
    }
    const check = args[0] === "--check";
    if (check) args.shift();
    if (args.length > 1 || args[0]?.startsWith("-")) {
      fail("usage: node tools/generate-catalog-runtime-descriptors.mjs [--check] [catalog-root]");
    }
    const root = resolve(args[0] ?? here);
    const value = generateCatalogRuntimeDescriptors(root);
    const bytes = serializeCatalogRuntimeDescriptors(value);
    const output = resolve(root, OUTPUT);
    if (check) {
      let current = null;
      try {
        current = readFileSync(output, "utf8");
      } catch {
        current = null;
      }
      if (current !== bytes) fail("runtime descriptors are stale; run npm run generate:catalog-runtime-descriptors");
    } else {
      const temporary = `${output}.tmp`;
      writeFileSync(temporary, bytes, { flag: "wx" });
      try {
        renameSync(temporary, output);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    const summary = value.descriptors
      .map((item) => `${item.framework} ${item.source.repository}@${item.source.commit.slice(0, 12)}`)
      .join(", ");
    console.log(`${check ? "Checked" : "Generated"} ${OUTPUT}: ${summary}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
