/** Internal wire checks shared by release admission and inventory construction. */

import {
  BASELINE_ARTIFACT_MAX_BYTES,
  CONTENT_INVENTORY_SCHEMA_ID,
  CONTENT_INVENTORY_SCHEMA_ID_1_1,
  CONTENT_INVENTORY_SCHEMA_ID_1_2,
  CONTENT_PROJECTION_ID,
  CONTENT_PROJECTION_ID_1_1,
  CONTENT_PROJECTION_ID_1_2,
  SCAN_BASELINE_SCHEMA_ID,
  type ScanBaseline,
} from "./baseline-contracts.js";
import { exactFields } from "./boundary.js";
import {
  RELEASE_SCHEMA_ID_1_5,
  RELEASE_SCHEMA_ID_1_6,
  RELEASE_SCHEMA_ID_1_7,
} from "./contracts.js";
import { coreArchiveUrl, isRecord, SHA256, safeMemberPath } from "./document.js";
import { canonicalJson } from "./json.js";
import { sha256Hex } from "./sha256.js";

/** Each baseline-bound release format and the inventory/projection versions describing it. */
export const INVENTORY_VERSIONS = [
  {
    release: RELEASE_SCHEMA_ID_1_5,
    inventory: CONTENT_INVENTORY_SCHEMA_ID,
    projection: CONTENT_PROJECTION_ID,
  },
  {
    release: RELEASE_SCHEMA_ID_1_6,
    inventory: CONTENT_INVENTORY_SCHEMA_ID_1_1,
    projection: CONTENT_PROJECTION_ID_1_1,
  },
  {
    release: RELEASE_SCHEMA_ID_1_7,
    inventory: CONTENT_INVENTORY_SCHEMA_ID_1_2,
    projection: CONTENT_PROJECTION_ID_1_2,
  },
] as const;

export function contentInventoryBytes(value: Record<string, unknown>): Uint8Array {
  const { baseline: _baseline, ...content } = value;
  // Earlier formats project as release 1.5 content, as inventory 1.0 always has.
  const version =
    INVENTORY_VERSIONS.find((entry) => entry.release === value.schema) ?? INVENTORY_VERSIONS[0];
  return new TextEncoder().encode(
    `${canonicalJson({
      schema: version.inventory,
      projection: version.projection,
      release: { ...content, schema: version.release },
    })}\n`,
  );
}
const hash = (value: unknown) => typeof value === "string" && SHA256.test(value);
const length = (value: unknown, max: number) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;
const paths = (value: unknown) =>
  Array.isArray(value) &&
  value.length <= 10000 &&
  value.every((path, i) => safeMemberPath(path) && (i === 0 || value[i - 1] < path));

export function validBaseline(value: unknown): value is ScanBaseline {
  if (
    !exactFields(value, ["schema", "inventory", "scanId", "artifact", "scope"]) ||
    value.schema !== SCAN_BASELINE_SCHEMA_ID ||
    typeof value.scanId !== "string" ||
    !/^scan:sha256:[0-9a-f]{64}$/.test(value.scanId)
  )
    return false;
  const { inventory, artifact, scope } = value;
  if (
    !exactFields(inventory, ["path", "sha256", "byteLength"]) ||
    !safeMemberPath(inventory.path) ||
    !hash(inventory.sha256) ||
    !length(inventory.byteLength, 16 * 1024 * 1024)
  )
    return false;
  if (
    !exactFields(artifact, ["sha256", "byteLength", "location"]) ||
    !hash(artifact.sha256) ||
    !length(artifact.byteLength, BASELINE_ARTIFACT_MAX_BYTES)
  )
    return false;
  const location = artifact.location;
  if (
    !isRecord(location) ||
    !(location.kind === "package"
      ? exactFields(location, ["kind", "path"]) &&
        safeMemberPath(location.path) &&
        location.path.toLowerCase() !== String(inventory.path).toLowerCase() &&
        (artifact.byteLength as number) <= 16 * 1024 * 1024
      : location.kind === "https" &&
        exactFields(location, ["kind", "url"]) &&
        coreArchiveUrl(location.url))
  )
    return false;
  return (
    exactFields(scope, ["namespace", "paths", "excludedPaths"]) &&
    scope.namespace === "package-relative" &&
    paths(scope.paths) &&
    paths(scope.excludedPaths) &&
    (scope.excludedPaths as string[]).every((path) => (scope.paths as string[]).includes(path))
  );
}

export function baselineMatchesContent(
  value: Record<string, unknown>,
  baseline: ScanBaseline,
): boolean {
  const bytes = contentInventoryBytes(value);
  return (
    baseline.inventory.sha256 === sha256Hex(bytes) && baseline.inventory.byteLength === bytes.length
  );
}
