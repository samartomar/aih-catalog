import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCatalogIndex, serializeCatalogIndex } from "./generate-catalog-index.mjs";

/**
 * Generates the published collection view over the catalog index.
 *
 * The index carries each entry's source as type/release/revision. It does not
 * say which package owns a group of entries or which release of that group is
 * current, and that cannot be recovered from entry ids or by comparing
 * versions: the default profile's release 1.0.0 is a profile version, not a
 * Core release. The collection inputs state it explicitly, and this tool checks
 * every stated member against the index it binds to.
 *
 * Entries whose source type is collected, but that no current collection names,
 * stay in the index for evidence and reference. They are not current inventory.
 */
export const INPUT = "defaults/catalog-collection-inputs-v1.json";
export const OUTPUT = "defaults/catalog-collections-v1.json";
const INDEX = "defaults/catalog-index-v1.json";

const COLLECTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const RELEASE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (message) => {
  throw new Error(`catalog-collections: ${message}`);
};
const object = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label);
  return value;
};
const text = (value, label, pattern) => {
  if (typeof value !== "string" || value.length === 0) fail(label);
  if (pattern !== undefined && !pattern.test(value)) fail(label);
  return value;
};
const exactKeys = (value, allowed, label) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}: unknown field ${key}`);
};
const safePath = (value, label) => {
  const path = text(value, label, SAFE_PATH);
  const segments = path.split("/");
  if (path.endsWith("/")) segments.pop();
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail(`${label}: unsafe path ${path}`);
  }
  return path;
};
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};

/** How the current release was identified when the inputs were prepared. */
function origin(value, collection) {
  const label = `${collection}: current.origin`;
  object(value, label);
  switch (value.kind) {
    case "npm-dist-tag":
      exactKeys(value, ["kind", "name", "tag", "version"], label);
      return {
        kind: value.kind,
        name: text(value.name, `${label}.name`, PACKAGE_NAME),
        tag: text(value.tag, `${label}.tag`, COLLECTION_ID),
        version: text(value.version, `${label}.version`, RELEASE),
      };
    case "package-file":
      exactKeys(value, ["kind", "name", "sha256", "version"], label);
      return {
        kind: value.kind,
        name: text(value.name, `${label}.name`, PACKAGE_NAME),
        sha256: text(value.sha256, `${label}.sha256`, SHA256_HEX),
        version: text(value.version, `${label}.version`, RELEASE),
      };
    case "catalog-authored":
      exactKeys(value, ["kind"], label);
      return { kind: value.kind };
    default:
      return fail(`${label}: unknown kind`);
  }
}

/**
 * Build the collection view from the inputs and the index generated from the
 * same root. `inputs` defaults to the committed input file.
 */
export function generateCatalogCollections(packageRoot, inputs) {
  const root = resolve(packageRoot);
  const indexBytes = serializeCatalogIndex(generateCatalogIndex(root));
  const index = JSON.parse(indexBytes);
  const input = object(inputs ?? JSON.parse(readFileSync(resolve(root, INPUT), "utf8")), "inputs");
  if (input.format !== "aih-catalog-collection-inputs" || input.version !== 1) {
    fail("unsupported inputs version");
  }
  exactKeys(input, ["collectedSourceTypes", "collections", "format", "version"], "inputs");

  if (!Array.isArray(input.collectedSourceTypes) || input.collectedSourceTypes.length === 0) {
    fail("collectedSourceTypes");
  }
  const collectedSourceTypes = input.collectedSourceTypes.map((type) =>
    text(type, "collectedSourceTypes", COLLECTION_ID));
  if (new Set(collectedSourceTypes).size !== collectedSourceTypes.length) {
    fail("duplicate collected source type");
  }

  if (!Array.isArray(input.collections) || input.collections.length === 0 || input.collections.length > 256) {
    fail("collections");
  }
  const bySeed = new Map(index.entries.map((entry) => [entry.seed.path, entry]));
  const ids = new Set();
  const claimed = new Map();
  const collections = input.collections.map((raw) => {
    object(raw, "collection");
    exactKeys(raw, ["current", "id", "owner", "seedRoot", "seeds", "sourceType"], "collection");
    const id = text(raw.id, "collection id", COLLECTION_ID);
    if (ids.has(id)) fail(`duplicate collection id: ${id}`);
    ids.add(id);
    const owner = object(raw.owner, `${id}: owner`);
    exactKeys(owner, ["package"], `${id}: owner`);
    const ownerPackage = text(owner.package, `${id}: owner.package`, PACKAGE_NAME);
    const sourceType = text(raw.sourceType, `${id}: sourceType`);
    if (!collectedSourceTypes.includes(sourceType)) fail(`${id}: sourceType ${sourceType} is not collected`);
    const current = object(raw.current, `${id}: current`);
    exactKeys(current, ["origin", "release"], `${id}: current`);
    const release = text(current.release, `${id}: current.release`, RELEASE);
    const currentOrigin = origin(current.origin, id);
    if ("version" in currentOrigin && currentOrigin.version !== release) {
      fail(`${id}: current.release ${release} is not the identified version ${currentOrigin.version}`);
    }
    if ("name" in currentOrigin && currentOrigin.name !== ownerPackage) {
      fail(`${id}: current.origin names ${currentOrigin.name}, not the owner ${ownerPackage}`);
    }

    // Membership is stated, never inferred: a seed directory or a list of seeds.
    if (("seedRoot" in raw) === ("seeds" in raw)) fail(`${id}: give exactly one of seedRoot or seeds`);
    let members;
    if ("seedRoot" in raw) {
      const seedRoot = safePath(raw.seedRoot, `${id}: seedRoot`);
      if (!seedRoot.endsWith("/")) fail(`${id}: seedRoot must end with /`);
      const prefix = `defaults/${seedRoot}`;
      members = index.entries.filter((entry) => entry.seed.path.startsWith(prefix));
      if (members.length === 0) {
        fail(`${id}: no seeds under ${seedRoot}; ${ownerPackage} ${release} needs a Catalog content update`);
      }
    } else {
      if (!Array.isArray(raw.seeds) || raw.seeds.length === 0 || raw.seeds.length > 4096) fail(`${id}: seeds`);
      members = raw.seeds.map((seed) => {
        const path = safePath(seed, `${id}: seeds`);
        const entry = bySeed.get(`defaults/${path}`);
        if (entry === undefined) fail(`${id}: seed ${path} is not in the index`);
        return entry;
      });
    }

    for (const entry of members) {
      const source = entry.subject.source;
      if (source.type !== sourceType) {
        fail(`${id}: ${entry.entryId} has source type ${source.type}, not ${sourceType}`);
      }
      if (source.release !== release) {
        fail(`${id}: ${entry.entryId} is release ${source.release}, not the current release ${release}`);
      }
      if (claimed.has(entry.entryId)) {
        fail(`${entry.entryId} is a member of both ${claimed.get(entry.entryId)} and ${id}`);
      }
      claimed.set(entry.entryId, id);
    }
    return {
      id,
      owner: { package: ownerPackage },
      sourceType,
      current: { release, origin: currentOrigin },
      members: members
        .map((entry) => ({ entryId: entry.entryId, subjectDigest: entry.subject.subjectDigest }))
        .sort((a, b) => compare(a.entryId, b.entryId)),
    };
  }).sort((a, b) => compare(a.id, b.id));

  return {
    format: "aih-catalog-collections",
    version: 1,
    index: {
      path: INDEX,
      sha256: createHash("sha256").update(indexBytes).digest("hex"),
    },
    collectedSourceTypes: [...collectedSourceTypes].sort(compare),
    collections,
  };
}

/** Same canonical form as the index: the reader refuses anything else. */
export function serializeCatalogCollections(collections) {
  return `${canonical(collections)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const check = args[0] === "--check";
    if (check) args.shift();
    if (args.length > 1 || args[0]?.startsWith("-")) {
      fail("usage: node tools/generate-catalog-collections.mjs [--check] [catalog-root]");
    }
    const root = resolve(args[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    const collections = generateCatalogCollections(root);
    const bytes = serializeCatalogCollections(collections);
    const output = resolve(root, OUTPUT);
    if (check) {
      let existing = null;
      try {
        existing = readFileSync(output, "utf8");
      } catch {
        existing = null;
      }
      if (existing !== bytes) fail("collections are stale; run npm run generate:catalog-collections");
    } else {
      const temporary = `${output}.tmp`;
      writeFileSync(temporary, bytes, { flag: "wx" });
      try {
        renameSync(temporary, output);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    const summary = collections.collections
      .map((collection) => `${collection.id} ${collection.current.release} (${collection.members.length})`)
      .join(", ");
    console.log(`${check ? "Checked" : "Generated"} ${OUTPUT}: ${summary}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
