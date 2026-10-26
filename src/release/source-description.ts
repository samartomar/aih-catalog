/**
 * Portable source descriptions and exact source identities for
 * samartomar/aih-catalog#121.
 *
 * A source description (`urn:aihq:catalog:source-description:1.0.0`) is discovery
 * data only: it says what a source is called and where it was found, keeping
 * discovery apart from the exact source. An exact source identity is a separate
 * type, produced only by resolution and acquisition (samartomar/aih-catalog#122
 * and #123): parsing or reading a description never yields one, and saved intent
 * and installs use exact identities only.
 *
 * Pure: no Node built-ins, filesystem, network or clock. Descriptions are
 * caller-supplied bytes; identities are caller-supplied values. This module
 * never fetches, installs, executes, discovers the host or selects an authority,
 * and a description — or an organization's published list of them — grants none.
 */
import {
  type CatalogDiagnostic,
  type CheckExactSourceIdentityResult,
  type ExactSourceIdentity,
  type ReadSourceDescriptionResult,
  SOURCE_DESCRIPTION_SCHEMA_ID,
  type SourceDescription,
  type SourceLocator,
} from "./contracts.js";
import { Diagnostics, fields, isId, isRecord, PACKAGE_NAME, SHA256 } from "./document.js";
import { deepFreeze, JsonAdmissionError, readCanonicalBytes } from "./json.js";
import { EXACT_VERSION } from "./version.js";

/** Published byte bound for one source description document. */
export const SOURCE_DESCRIPTION_MAX_BYTES = 64 * 1024;
/** Published nesting bound for one source description document. */
export const SOURCE_DESCRIPTION_MAX_DEPTH = 8;

const EXACT_COMMIT = /^[a-f0-9]{40}$/;
/** A git reference in discovery data: bounded text without whitespace. */
const GIT_REF = /^[^\s]{1,256}$/;
/** An npm version spec in discovery data: bounded text without whitespace. */
const VERSION_SPEC = /^[^\s]{1,128}$/;
/** npm subresource integrity spelling: an admitted algorithm and base64 text. */
const INTEGRITY = /^(?:sha1|sha256|sha512)-[A-Za-z0-9+/]+={0,2}$/;
/** The digest bytes each admitted integrity algorithm names. */
const INTEGRITY_DIGEST_BYTES: Readonly<Record<string, number>> = Object.freeze({
  sha1: 20,
  sha256: 32,
  sha512: 64,
});
const LOCATOR_KINDS = Object.freeze(["git", "npm", "local"] as const);

/**
 * One valid https repository URL, checked with the platform URL parser: an https
 * protocol, a host, no credentials and no fragment. A malformed URL — a bad or
 * out-of-range port, no host — is refused, not merely a non-https scheme.
 */
function httpsRepository(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

/** npm subresource integrity whose base64 decodes to the algorithm's digest bytes. */
function npmIntegrity(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256 || !INTEGRITY.test(value)) return false;
  const separator = value.indexOf("-");
  const expected = INTEGRITY_DIGEST_BYTES[value.slice(0, separator)] as number;
  const body = value.slice(separator + 1);
  try {
    const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
    return atob(padded).length === expected;
  } catch {
    return false;
  }
}

const invalidDescription = (
  diagnostics: readonly CatalogDiagnostic[],
): ReadSourceDescriptionResult => Object.freeze({ valid: false, diagnostics });

const invalidIdentity = (
  diagnostics: readonly CatalogDiagnostic[],
): CheckExactSourceIdentityResult => Object.freeze({ valid: false, diagnostics });

const diagnostic = (
  code: CatalogDiagnostic["code"],
  reason: string,
  message: string,
  extra: Partial<CatalogDiagnostic> = {},
): CatalogDiagnostic => Object.freeze({ code, reason, message, blocking: true, ...extra });

/** Checks the locator of one source description. */
function checkLocator(d: Diagnostics, value: unknown): void {
  if (!isRecord(value)) {
    d.add("invalid-locator", "/locator", "Expected an object naming where the source was found.");
    return;
  }
  const kind = value.kind;
  if (kind !== "git" && kind !== "npm" && kind !== "local") {
    d.add("invalid-locator-kind", "/locator/kind", "Expected a supported locator kind.", {
      encountered: typeof kind === "string" ? kind.slice(0, 128) : undefined,
      supported: LOCATOR_KINDS,
    });
    return;
  }
  if (kind === "git") {
    if (!fields(d, value, "/locator", ["kind", "repository"], ["ref"])) return;
    if (!httpsRepository(value.repository)) {
      d.add(
        "repository-not-https",
        "/locator/repository",
        "A git repository locator is one valid https URL; other schemes and malformed URLs are refused.",
      );
    }
    if (value.ref !== undefined && (typeof value.ref !== "string" || !GIT_REF.test(value.ref))) {
      d.add(
        "invalid-ref",
        "/locator/ref",
        "Expected a git reference of 1 to 256 characters without whitespace.",
      );
    }
    return;
  }
  if (kind === "npm") {
    if (!fields(d, value, "/locator", ["kind", "package"], ["versionSpec"])) return;
    if (typeof value.package !== "string" || !PACKAGE_NAME.test(value.package)) {
      d.add("invalid-package", "/locator/package", "Expected an npm package name.");
    }
    if (
      value.versionSpec !== undefined &&
      (typeof value.versionSpec !== "string" || !VERSION_SPEC.test(value.versionSpec))
    ) {
      d.add(
        "invalid-version-spec",
        "/locator/versionSpec",
        "Expected a version spec of 1 to 128 characters without whitespace.",
      );
    }
    return;
  }
  if (!fields(d, value, "/locator", ["kind", "label"])) return;
  if (typeof value.label !== "string" || value.label.length === 0 || value.label.length > 256) {
    d.add("invalid-label", "/locator/label", "Expected a local label of 1 to 256 characters.");
  }
}

/**
 * Reads one source description from bounded canonical bytes, without effects.
 *
 * The result is discovery data: it carries a locator, never an exact identity.
 * A document naming another format version is refused as a whole with
 * `SCHEMA_UNSUPPORTED`, naming what was encountered and what is supported;
 * unknown fields, a non-https git repository and malformed locators are named
 * `INPUT_INVALID` refusals. An organization publishes its source list with this
 * same descriptor; the reader applies the same closed checks to every entry.
 */
export function readSourceDescription(bytes: Uint8Array): ReadSourceDescriptionResult {
  let value: unknown;
  try {
    value = readCanonicalBytes(bytes, {
      maxBytes: SOURCE_DESCRIPTION_MAX_BYTES,
      maxDepth: SOURCE_DESCRIPTION_MAX_DEPTH,
    });
  } catch (error) {
    if (!(error instanceof JsonAdmissionError)) throw error;
    return invalidDescription([
      diagnostic(
        "INPUT_INVALID",
        error.reason,
        "The source description is not bounded canonical JSON with one LF.",
      ),
    ]);
  }
  if (
    isRecord(value) &&
    Object.hasOwn(value, "schema") &&
    value.schema !== SOURCE_DESCRIPTION_SCHEMA_ID
  ) {
    return invalidDescription([
      diagnostic(
        "SCHEMA_UNSUPPORTED",
        "unsupported-schema",
        "This source description format is not supported.",
        {
          path: "/schema",
          encountered:
            typeof value.schema === "string" ? value.schema.slice(0, 128) : String(value.schema),
          supported: [SOURCE_DESCRIPTION_SCHEMA_ID],
        },
      ),
    ]);
  }
  const d = new Diagnostics();
  if (!fields(d, value, "", ["schema", "id", "label", "locator"], ["publisher"])) {
    return invalidDescription(d.list as unknown as readonly CatalogDiagnostic[]);
  }
  if (!isId(value.id)) d.add("invalid-id", "/id", "Expected a source identifier.");
  if (typeof value.label !== "string" || value.label.length === 0 || value.label.length > 256) {
    d.add("invalid-text", "/label", "Expected a label of 1 to 256 characters.");
  }
  if (
    value.publisher !== undefined &&
    (typeof value.publisher !== "string" ||
      value.publisher.length === 0 ||
      value.publisher.length > 256)
  ) {
    d.add("invalid-text", "/publisher", "Expected a publisher of 1 to 256 characters.");
  }
  checkLocator(d, value.locator);
  if (d.list.length > 0)
    return invalidDescription(d.list as unknown as readonly CatalogDiagnostic[]);
  const description: SourceDescription = {
    schema: SOURCE_DESCRIPTION_SCHEMA_ID,
    id: value.id as string,
    label: value.label as string,
    ...(value.publisher === undefined ? {} : { publisher: value.publisher as string }),
    locator: value.locator as SourceLocator,
  };
  return Object.freeze({
    valid: true,
    description: deepFreeze(description),
    diagnostics: Object.freeze([]),
  }) as ReadSourceDescriptionResult;
}

/**
 * Checks one exact source identity, without effects.
 *
 * An exact identity is produced only by resolution and acquisition: an exact
 * git commit with its reachability, an exact npm version with its integrity, or
 * the digest of captured local bytes. A mutable reference — a branch, tag,
 * range or `latest` — is refused precisely, and so is a non-https git
 * repository, an unknown kind and any unknown field.
 */
export function checkExactSourceIdentity(identity: unknown): CheckExactSourceIdentityResult {
  const d = new Diagnostics();
  if (!isRecord(identity)) {
    d.add("invalid-type", "", "Expected an exact source identity object.");
    return invalidIdentity(d.list as unknown as readonly CatalogDiagnostic[]);
  }
  const kind = identity.kind;
  if (kind !== "git" && kind !== "npm" && kind !== "local") {
    d.add("invalid-kind", "/kind", "Expected an exact source identity kind.", {
      encountered: typeof kind === "string" ? kind.slice(0, 128) : undefined,
      supported: LOCATOR_KINDS,
    });
    return invalidIdentity(d.list as unknown as readonly CatalogDiagnostic[]);
  }
  let checked: ExactSourceIdentity;
  if (kind === "git") {
    if (!fields(d, identity, "", ["kind", "repository", "commit", "reachable"])) {
      return invalidIdentity(d.list as unknown as readonly CatalogDiagnostic[]);
    }
    if (!httpsRepository(identity.repository)) {
      d.add(
        "repository-not-https",
        "/repository",
        "A git repository is one valid https URL; other schemes and malformed URLs are refused.",
      );
    }
    if (typeof identity.commit !== "string" || !EXACT_COMMIT.test(identity.commit)) {
      d.add(
        "invalid-commit",
        "/commit",
        "Expected one exact 40-character commit id; a branch, tag or other mutable reference is never an exact identity.",
      );
    }
    if (typeof identity.reachable !== "boolean" && identity.reachable !== "unchecked") {
      d.add(
        "invalid-reachable",
        "/reachable",
        'Expected true, false or "unchecked"; an unchecked identity cannot back saved intent or an install.',
      );
    }
    checked = {
      kind: "git",
      repository: identity.repository as string,
      commit: identity.commit as string,
      reachable: identity.reachable as boolean | "unchecked",
    };
  } else if (kind === "npm") {
    if (!fields(d, identity, "", ["kind", "package", "version", "integrity"])) {
      return invalidIdentity(d.list as unknown as readonly CatalogDiagnostic[]);
    }
    if (typeof identity.package !== "string" || !PACKAGE_NAME.test(identity.package)) {
      d.add("invalid-package", "/package", "Expected an npm package name.");
    }
    if (typeof identity.version !== "string" || !EXACT_VERSION.test(identity.version)) {
      d.add(
        "version-not-exact",
        "/version",
        "Expected one exact npm version; ranges, tags and other mutable specs are refused.",
      );
    }
    if (!npmIntegrity(identity.integrity)) {
      d.add(
        "invalid-integrity",
        "/integrity",
        "Expected subresource integrity over the exact package bytes: sha1, sha256 or sha512 and the base64 digest of its full byte length.",
      );
    }
    checked = {
      kind: "npm",
      package: identity.package as string,
      version: identity.version as string,
      integrity: identity.integrity as string,
    };
  } else {
    if (!fields(d, identity, "", ["kind", "captureSha256"])) {
      return invalidIdentity(d.list as unknown as readonly CatalogDiagnostic[]);
    }
    if (typeof identity.captureSha256 !== "string" || !SHA256.test(identity.captureSha256)) {
      d.add(
        "invalid-sha256",
        "/captureSha256",
        "Expected the bare lowercase SHA-256 of the captured local bytes.",
      );
    }
    checked = { kind: "local", captureSha256: identity.captureSha256 as string };
  }
  if (d.list.length > 0) return invalidIdentity(d.list as unknown as readonly CatalogDiagnostic[]);
  return Object.freeze({
    valid: true,
    identity: deepFreeze(checked),
    diagnostics: Object.freeze([]),
  }) as CheckExactSourceIdentityResult;
}
