/** Portable inventory reader and freeze step: no acquisition or authentication. */
import {
  CONTENT_INVENTORY_SCHEMA_ID,
  CONTENT_PROJECTION_ID,
  type ContentInventory,
  type ContentInventoryResult,
} from "./baseline-contracts.js";
import { contentInventoryBytes } from "./baseline-wire.js";
import { exactFields } from "./boundary.js";
import { RELEASE_MAX_BYTES, RELEASE_MAX_DEPTH, RELEASE_SCHEMA_ID_1_5 } from "./contracts.js";
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
    if (
      !isRecord(value) ||
      value.schema !== CONTENT_INVENTORY_SCHEMA_ID ||
      value.projection !== CONTENT_PROJECTION_ID
    )
      return refuse("unsupported-inventory", true);
    if (
      !exactFields(value, ["schema", "projection", "release"]) ||
      !isRecord(value.release) ||
      value.release.schema !== RELEASE_SCHEMA_ID_1_5 ||
      Object.hasOwn(value.release, "baseline")
    )
      return refuse("inventory-invalid");
    const checked = checkReleaseDocument(value.release, { contentOnly: true });
    if (!checked.document) return { valid: false, diagnostics: checked.diagnostics };
    return success(bytes, value);
  } catch (error) {
    if (!(error instanceof JsonAdmissionError)) throw error;
    return refuse(error.reason);
  }
}
