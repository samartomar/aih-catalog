import { readFileSync } from "node:fs";
import { assertStrictJsonValueV1 } from "../strict-json-v1.js";
import {
  COMMIT_SHA,
  exactKeys,
  type JsonRecord,
  list,
  literal,
  record,
  text,
} from "../validate-v1.js";
import { productionDataPathV1 } from "./upstream-inputs-v1.js";

/**
 * Facts the Core product declares about itself and that the Catalog carries
 * verbatim into the policy authoring catalog: its package identity, the hosts
 * it recognizes, its own MCP servers and controls, and its own hooks. They are
 * a hand-maintained declaration copied from the named Core release, never
 * derived by the Catalog; Core remains the authority for their meaning.
 */
export const CORE_PRODUCT_DECLARATIONS_FILE_V1 = "core-product-declarations-v1.json";

export interface CoreProductDeclarationsV1 {
  format: "aih-catalog-core-product-declarations";
  version: 1;
  source: { package: string; version: string; repository: string; commit: string };
  hosts: JsonRecord[];
  mcp: JsonRecord[];
  nonProjectableMcp: JsonRecord[];
  unavailableMcp: JsonRecord[];
  hooks: JsonRecord[];
  hookRegistry: {
    entries: JsonRecord[];
    registrations: JsonRecord[];
    overlaps: unknown[];
    spawnProjection: JsonRecord;
  };
}

function records(value: unknown, label: string, min = 0): JsonRecord[] {
  return list(value, label, min).map((item, index) => record(item, `${label}[${String(index)}]`));
}

function uniqueIds(items: readonly JsonRecord[], label: string): void {
  const ids = items.map((item, index) => text(item.id, `${label}[${String(index)}] id`));
  if (new Set(ids).size !== ids.length) throw new TypeError(`${label} has duplicate ids`);
}

export function parseCoreProductDeclarationsV1(value: unknown): CoreProductDeclarationsV1 {
  const label = "Core product declarations";
  const input = exactKeys(
    record(assertStrictJsonValueV1(value, label), label),
    [
      "format",
      "version",
      "source",
      "hosts",
      "mcp",
      "nonProjectableMcp",
      "unavailableMcp",
      "hooks",
      "hookRegistry",
    ],
    label,
  );
  literal(input.format, "aih-catalog-core-product-declarations", `${label} format`);
  literal(input.version, 1, `${label} version`);
  const source = exactKeys(
    record(input.source, `${label} source`),
    ["package", "version", "repository", "commit"],
    `${label} source`,
  );
  const registry = exactKeys(
    record(input.hookRegistry, `${label} hookRegistry`),
    ["entries", "registrations", "overlaps", "spawnProjection"],
    `${label} hookRegistry`,
  );
  const result: CoreProductDeclarationsV1 = {
    format: "aih-catalog-core-product-declarations",
    version: 1,
    source: {
      package: text(source.package, `${label} package`, /^@aihq\/core$/u),
      version: text(source.version, `${label} version`, /^[0-9]+\.[0-9]+\.[0-9]+$/u),
      repository: text(
        source.repository,
        `${label} repository`,
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
      ),
      commit: text(source.commit, `${label} commit`, COMMIT_SHA),
    },
    hosts: records(input.hosts, `${label} hosts`, 1),
    mcp: records(input.mcp, `${label} mcp`),
    nonProjectableMcp: records(input.nonProjectableMcp, `${label} nonProjectableMcp`),
    unavailableMcp: records(input.unavailableMcp, `${label} unavailableMcp`),
    hooks: records(input.hooks, `${label} hooks`),
    hookRegistry: {
      entries: records(registry.entries, `${label} hook registry entries`),
      registrations: records(registry.registrations, `${label} hook registrations`),
      overlaps: list(registry.overlaps, `${label} hook overlaps`),
      spawnProjection: record(registry.spawnProjection, `${label} spawn projection`),
    },
  };
  for (const [name, items] of [
    ["hosts", result.hosts],
    ["mcp", result.mcp],
    ["nonProjectableMcp", result.nonProjectableMcp],
    ["unavailableMcp", result.unavailableMcp],
    ["hooks", result.hooks],
    ["hook registry entries", result.hookRegistry.entries],
  ] as const)
    uniqueIds(items, `${label} ${name}`);
  for (const entry of result.hookRegistry.entries)
    if (entry.owner !== "aih")
      throw new TypeError(`${label} hook registry may only declare AIH-owned entries`);
  for (const hook of result.hooks)
    if (!result.hookRegistry.entries.some((entry) => entry.id === hook.id))
      throw new TypeError(`${label} hook ${String(hook.id)} has no registry disclosure`);
  return result;
}

export function readCoreProductDeclarationsV1(root: string): CoreProductDeclarationsV1 {
  return parseCoreProductDeclarationsV1(
    JSON.parse(readFileSync(productionDataPathV1(root, CORE_PRODUCT_DECLARATIONS_FILE_V1), "utf8")),
  );
}
