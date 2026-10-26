/** Portable inventory reader and freeze step: no acquisition or authentication. */
import type { ContentInventory, ContentInventoryResult } from "./baseline-contracts.js";
import { contentInventoryBytes, INVENTORY_VERSIONS } from "./baseline-wire.js";
import { exactFields } from "./boundary.js";
import { RELEASE_MAX_BYTES, RELEASE_MAX_DEPTH, RELEASE_RECIPE_SCHEMAS } from "./contracts.js";
import { checkReleaseDocument, isRecord, SHA256 } from "./document.js";
import { deepFreeze, JsonAdmissionError, readCanonicalBytes } from "./json.js";
import { sha256Hex } from "./sha256.js";

const refuse = (reason: string, unsupported = false): ContentInventoryResult => ({
  valid: false,
  diagnostics: [
    {
      code: unsupported ? "SCHEMA_UNSUPPORTED" : "INPUT_INVALID",
      reason,
      message: "The content inventory could not be read under its versioned contract.",
      blocking: true,
    },
  ],
});
function admit(bytes: Uint8Array, options: { readonly expectedSha256: string }): unknown {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length > RELEASE_MAX_BYTES ||
    !options ||
    typeof options.expectedSha256 !== "string" ||
    !SHA256.test(options.expectedSha256)
  )
    throw new JsonAdmissionError("inventory-input-invalid");
  if (sha256Hex(bytes) !== options.expectedSha256)
    throw new JsonAdmissionError("inventory-integrity-mismatch");
  return readCanonicalBytes(bytes, { maxBytes: RELEASE_MAX_BYTES, maxDepth: RELEASE_MAX_DEPTH });
}
function success(bytes: Uint8Array, inventory: unknown): ContentInventoryResult {
  return {
    valid: true,
    bytes: bytes.slice(),
    inventory: deepFreeze(inventory) as ContentInventory,
    sha256: sha256Hex(bytes),
    byteLength: bytes.length,
    diagnostics: [],
  };
}
export function createContentInventory(
  bytes: Uint8Array,
  options: { readonly expectedSha256: string },
): ContentInventoryResult {
  try {
    const value = admit(bytes, options);
    const checked = checkReleaseDocument(value, { contentOnly: true });
    if (!checked.document) return { valid: false, diagnostics: checked.diagnostics };
    const output = contentInventoryBytes(value as Record<string, unknown>);
    return readContentInventory(output, { expectedSha256: sha256Hex(output) });
  } catch (error) {
    if (!(error instanceof JsonAdmissionError)) throw error;
    return refuse(error.reason);
  }
}
export function readContentInventory(
  bytes: Uint8Array,
  options: { readonly expectedSha256: string },
): ContentInventoryResult {
  try {
    const value = admit(bytes, options);
    const version = isRecord(value)
      ? INVENTORY_VERSIONS.find((entry) => entry.inventory === value.schema)
      : undefined;
    if (
      version === undefined ||
      !INVENTORY_VERSIONS.some(
        (entry) => entry.projection === (value as Record<string, unknown>).projection,
      )
    )
      return refuse("unsupported-inventory", true);
    if ((value as Record<string, unknown>).projection !== version.projection)
      return refuse("inventory-projection-mismatch", true);
    if (!exactFields(value, ["schema", "projection", "release"]) || !isRecord(value.release))
      return refuse("inventory-invalid");
    if (
      typeof value.release.schema === "string" &&
      !Object.hasOwn(RELEASE_RECIPE_SCHEMAS, value.release.schema)
    )
      return refuse("unsupported-release", true);
    const expectedReleaseSchema = version.release;
    if (value.release.schema !== expectedReleaseSchema || Object.hasOwn(value.release, "baseline"))
      return refuse("inventory-invalid");
    const checked = checkReleaseDocument(value.release, { contentOnly: true });
    if (!checked.document) return { valid: false, diagnostics: checked.diagnostics };
    return success(bytes, value);
  } catch (error) {
    if (!(error instanceof JsonAdmissionError)) throw error;
    return refuse(error.reason);
  }
}
