/**
 * Portable release-index reader: `urn:aihq:catalog:release-index:1.0.0`.
 *
 * Pure: no Node built-ins, filesystem, network or clock. The host acquires and
 * persists; this reader checks caller-supplied bytes against the published
 * contract, merges sources through one schema, reports per-source diagnostics
 * and returns the state to persist. The Node verifier supplies opaque TUF
 * evidence bound to host-selected trust; this portable seam admits no claims
 * of verification from serialized data.
 */
import {
  type MergedReleaseIndexEntry,
  RELEASE_INDEX_SCHEMA_ID,
  RELEASE_MAX_BYTES,
  RELEASE_MAX_DEPTH,
  RELEASE_RECIPE_SCHEMAS,
  type ReadReleaseIndexRequest,
  type ReadReleaseIndexResult,
  type ReleaseIndexDiagnostic,
  type ReleaseIndexEntry,
  type ReleaseIndexEntryStatus,
  type ReleaseIndexSourceRef,
  type ReleaseIndexSourceResult,
  type ReleaseIndexSourceState,
} from "./contracts.js";
import { checkMaterialSource, Diagnostics, fields, isId, isRecord, SHA256 } from "./document.js";
import { type IndexVerificationRecord, indexVerification } from "./index-verification.js";
import { deepFreeze, JsonAdmissionError, readCanonicalBytes } from "./json.js";
import { sha256Hex } from "./sha256.js";
import { EXACT_VERSION } from "./version.js";

const RELEASE_SCHEMA_IDS = Object.freeze(Object.keys(RELEASE_RECIPE_SCHEMAS));
const INDEX_MAX_ENTRIES = 4096;
const STATUS_ORDER: Readonly<Record<ReleaseIndexEntryStatus, number>> = Object.freeze({
  current: 0,
  retired: 1,
  revoked: 2,
});

/** RFC 3339 instant: `YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)`. */
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.([0-9]+))?(Z|[+-][0-2][0-9]:[0-5][0-9])$/;

/** Milliseconds since the Unix epoch, or `undefined` for a malformed instant. */
function parseInstant(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = INSTANT.exec(value);
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second, fraction, offset] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (mo < 1 || mo > 12 || d < 1 || d > (days[mo - 1] as number) || h > 23 || mi > 59 || s > 59) {
    return undefined;
  }
  if (offset === undefined) return undefined;
  let millis = Date.UTC(y, mo - 1, d, h, mi, s);
  if (fraction !== undefined) millis += Number(`0.${fraction}`) * 1000;
  if (offset !== "Z") {
    const sign = offset[0] === "-" ? 1 : -1;
    const oh = Number(offset.slice(1, 3));
    const om = Number(offset.slice(4, 6));
    millis += sign * (oh * 60 + om) * 60_000;
  }
  return millis;
}

function checkEntry(d: Diagnostics, value: unknown, path: string, sourceId: string): void {
  if (
    !fields(
      d,
      value,
      path,
      [
        "frameworkId",
        "name",
        "version",
        "location",
        "sha256",
        "schema",
        "status",
        "evidence",
        "source",
      ],
      ["reason"],
    )
  ) {
    return;
  }
  const entry = value;
  if (!isId(entry.frameworkId)) {
    d.add("invalid-id", `${path}/frameworkId`, "Expected a framework identifier.");
  }
  if (typeof entry.name !== "string" || entry.name.length === 0 || entry.name.length > 256) {
    d.add("invalid-text", `${path}/name`, "Expected a published name of 1 to 256 characters.");
  }
  if (typeof entry.version !== "string" || !EXACT_VERSION.test(entry.version)) {
    d.add("invalid-version", `${path}/version`, "Expected one exact release version.");
  }
  if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
    d.add("invalid-sha256", `${path}/sha256`, "Expected a bare lowercase SHA-256.");
  }
  if (typeof entry.schema !== "string" || !RELEASE_SCHEMA_IDS.includes(entry.schema)) {
    d.add(
      "unsupported-release-schema",
      `${path}/schema`,
      "This index reader does not support that release format.",
      {
        encountered: typeof entry.schema === "string" ? entry.schema.slice(0, 128) : undefined,
        supported: RELEASE_SCHEMA_IDS,
      },
    );
  }
  if (entry.status !== "current" && entry.status !== "retired" && entry.status !== "revoked") {
    d.add("invalid-status", `${path}/status`, "Expected current, retired or revoked.");
  }
  if (
    entry.reason !== undefined &&
    (typeof entry.reason !== "string" || entry.reason.length === 0 || entry.reason.length > 512)
  ) {
    d.add("invalid-text", `${path}/reason`, "Expected a reason of 1 to 512 characters.");
  }
  checkMaterialSource(d, entry.location, `${path}/location`);
  if (isRecord(entry.location) && entry.location.kind === "archive") {
    if (entry.location.sha256 !== entry.sha256) {
      d.add(
        "location-digest-mismatch",
        `${path}/location/sha256`,
        "An archive location names the exact release document bytes the entry sha256 digests.",
      );
    }
  }
  if (!Array.isArray(entry.evidence) || entry.evidence.length > 64) {
    d.add("invalid-evidence", `${path}/evidence`, "Expected at most 64 evidence locations.");
  } else {
    entry.evidence.forEach((location, index) => {
      checkMaterialSource(d, location, `${path}/evidence/${index}`);
    });
  }
  if (!isRecord(entry.source)) {
    d.add("invalid-type", `${path}/source`, "Expected an object.");
    return;
  }
  if (!fields(d, entry.source, `${path}/source`, ["id", "kind"])) return;
  if (!isId(entry.source.id)) {
    d.add("invalid-id", `${path}/source/id`, "Expected a source identifier.");
  } else if (entry.source.id !== sourceId) {
    d.add(
      "source-id-mismatch",
      `${path}/source/id`,
      "Every entry names the source that published this index document.",
    );
  }
  if (
    entry.source.kind !== "public" &&
    entry.source.kind !== "organization" &&
    entry.source.kind !== "local"
  ) {
    d.add("invalid-source-kind", `${path}/source/kind`, "Expected public, organization or local.");
  }
}

interface CheckedIndexDocument {
  readonly sourceId: string;
  readonly version: number;
  readonly issuedAt: number;
  readonly expires: number;
  readonly entries: readonly ReleaseIndexEntry[];
}

/** Structural and semantic checks matching schemas/release-index/1.0.0.json. */
function checkIndexDocument(value: unknown): {
  readonly diagnostics: readonly ReleaseIndexDiagnostic[];
  readonly document?: CheckedIndexDocument;
} {
  const d = new Diagnostics();
  if (
    isRecord(value) &&
    Object.hasOwn(value, "schema") &&
    value.schema !== RELEASE_INDEX_SCHEMA_ID
  ) {
    d.list.push(
      Object.freeze({
        code: "SCHEMA_UNSUPPORTED",
        reason: "unsupported-schema",
        message: "This release index format is not supported.",
        blocking: true,
        path: "/schema",
        encountered:
          typeof value.schema === "string" ? value.schema.slice(0, 128) : String(value.schema),
        supported: [RELEASE_INDEX_SCHEMA_ID],
      }),
    );
    return { diagnostics: d.list as unknown as readonly ReleaseIndexDiagnostic[] };
  }
  if (!fields(d, value, "", ["schema", "sourceId", "version", "issuedAt", "expires", "entries"])) {
    return { diagnostics: d.list as unknown as readonly ReleaseIndexDiagnostic[] };
  }
  const sourceId = value.sourceId;
  if (!isId(sourceId)) d.add("invalid-id", "/sourceId", "Expected a source identifier.");
  let version = 0;
  if (
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  ) {
    d.add("invalid-version", "/version", "Expected a positive integer version.");
  } else version = value.version;
  const issuedAt = parseInstant(value.issuedAt);
  if (issuedAt === undefined) d.add("invalid-time", "/issuedAt", "Expected an RFC 3339 instant.");
  const expires = parseInstant(value.expires);
  if (expires === undefined) d.add("invalid-time", "/expires", "Expected an RFC 3339 instant.");
  if (issuedAt !== undefined && expires !== undefined && expires <= issuedAt) {
    d.add("invalid-times", "/expires", "The index must expire after it is issued.");
  }
  if (!Array.isArray(value.entries) || value.entries.length > INDEX_MAX_ENTRIES) {
    d.add("invalid-entries", "/entries", `Expected at most ${INDEX_MAX_ENTRIES} entries.`);
  } else {
    const keys: string[] = [];
    value.entries.forEach((entry, index) => {
      checkEntry(d, entry, `/entries/${index}`, typeof sourceId === "string" ? sourceId : "");
      if (
        isRecord(entry) &&
        typeof entry.frameworkId === "string" &&
        typeof entry.version === "string"
      ) {
        keys.push(`${entry.frameworkId}\u0000${entry.version}`);
      }
    });
    const seen = new Set<string>();
    keys.forEach((key, index) => {
      const previous = keys[index - 1];
      if (seen.has(key)) {
        d.add(
          "duplicate-entry",
          `/entries/${index}`,
          "One source publishes one entry per framework and version.",
        );
      } else if (previous !== undefined && previous > key) {
        d.add(
          "unordered-entries",
          `/entries/${index}`,
          "Entries are sorted by framework id, then version.",
        );
      }
      seen.add(key);
    });
  }
  if (d.list.length > 0)
    return { diagnostics: d.list as unknown as readonly ReleaseIndexDiagnostic[] };
  return {
    diagnostics: [],
    document: {
      sourceId: sourceId as string,
      version,
      issuedAt: issuedAt as number,
      expires: expires as number,
      entries: value.entries as unknown as readonly ReleaseIndexEntry[],
    },
  };
}

const advisory = (
  code: ReleaseIndexDiagnostic["code"],
  reason: string,
  message: string,
  extra: Partial<ReleaseIndexDiagnostic> = {},
): ReleaseIndexDiagnostic => Object.freeze({ code, reason, message, blocking: false, ...extra });

const withheld = (
  code: ReleaseIndexDiagnostic["code"],
  reason: string,
  message: string,
  extra: Partial<ReleaseIndexDiagnostic> = {},
): ReleaseIndexDiagnostic => Object.freeze({ code, reason, message, blocking: true, ...extra });

interface SourceInput {
  readonly sourceId: string;
  readonly tufSelected: boolean;
  readonly rootSha256?: string;
  readonly verification?: IndexVerificationRecord;
  readonly authorized: ReadonlySet<string>;
  readonly bytes?: Uint8Array;
  readonly offline: boolean;
  readonly state: ReleaseIndexSourceState;
}

interface AdmittedEntry {
  readonly entry: ReleaseIndexEntry;
  readonly sourceRef: ReleaseIndexSourceRef;
  readonly sourceIndex: number;
}

function requestFailure(reason: string, message: string, path?: string): ReadReleaseIndexResult {
  return Object.freeze({
    valid: false,
    entries: Object.freeze([]),
    sources: Object.freeze([]),
    diagnostics: Object.freeze([
      Object.freeze({
        code: "INPUT_INVALID",
        reason,
        message,
        blocking: true,
        ...(path === undefined ? {} : { path }),
      }),
    ]),
  });
}

function parseRequest(
  request: ReadReleaseIndexRequest,
):
  | { readonly evaluatedAt: number; readonly sources: readonly SourceInput[] }
  | { readonly failure: ReadReleaseIndexResult } {
  if (!isRecord(request))
    return { failure: requestFailure("request-invalid", "Expected a read request.") };
  const at = parseInstant((request as { evaluatedAt?: unknown }).evaluatedAt);
  if (at === undefined) {
    return {
      failure: requestFailure(
        "invalid-time",
        "Expected an RFC 3339 evaluation instant.",
        "/evaluatedAt",
      ),
    };
  }
  const rawSources = (request as { sources?: unknown }).sources;
  if (!Array.isArray(rawSources) || rawSources.length === 0) {
    return {
      failure: requestFailure("sources-invalid", "Expected at least one source.", "/sources"),
    };
  }
  const rawState = (request as { state?: unknown }).state;
  if (!Array.isArray(rawState)) {
    return { failure: requestFailure("state-invalid", "Expected per-source state.", "/state") };
  }
  const states = new Map<string, ReleaseIndexSourceState>();
  for (const [index, item] of rawState.entries()) {
    if (!isRecord(item) || !isId(item.sourceId)) {
      return {
        failure: requestFailure(
          "state-invalid",
          "Expected a source state entry.",
          `/state/${index}`,
        ),
      };
    }
    if (states.has(item.sourceId)) {
      return {
        failure: requestFailure(
          "duplicate-source",
          "State source ids are unique.",
          `/state/${index}/sourceId`,
        ),
      };
    }
    if (
      typeof item.lastVersion !== "number" ||
      !Number.isSafeInteger(item.lastVersion) ||
      item.lastVersion < 0
    ) {
      return {
        failure: requestFailure(
          "invalid-version",
          "Expected a nonnegative integer last version.",
          `/state/${index}/lastVersion`,
        ),
      };
    }
    if (item.lastVerifiedAt !== null && parseInstant(item.lastVerifiedAt) === undefined) {
      return {
        failure: requestFailure(
          "invalid-time",
          "Expected an RFC 3339 instant or null.",
          `/state/${index}/lastVerifiedAt`,
        ),
      };
    }
    if (
      item.lastIndexSha256 !== null &&
      (typeof item.lastIndexSha256 !== "string" || !SHA256.test(item.lastIndexSha256))
    ) {
      return {
        failure: requestFailure(
          "invalid-sha256",
          "Expected a bare lowercase SHA-256 or null.",
          `/state/${index}/lastIndexSha256`,
        ),
      };
    }
    const tufRoots: Record<
      string,
      { roles: import("./contracts.js").ReleaseIndexTufState; revoked: boolean }
    > = {};
    if (item.tufRoots !== undefined) {
      if (!isRecord(item.tufRoots))
        return { failure: requestFailure("tuf-state-invalid", "Expected per-root trust history.") };
      for (const [hash, history] of Object.entries(item.tufRoots)) {
        if (
          !SHA256.test(hash) ||
          !isRecord(history) ||
          typeof history.revoked !== "boolean" ||
          !isRecord(history.roles) ||
          Object.keys(history.roles).length !== 4 ||
          ["root", "timestamp", "snapshot", "targets"].some((role) => {
            const floor = (history.roles as Record<string, unknown>)[role];
            return (
              !isRecord(floor) ||
              !Number.isSafeInteger(floor.version) ||
              (floor.version as number) < 1 ||
              typeof floor.sha256 !== "string" ||
              !SHA256.test(floor.sha256)
            );
          })
        )
          return {
            failure: requestFailure(
              "tuf-state-invalid",
              "Expected root-bound role floors and revocations.",
            ),
          };
        tufRoots[hash] = {
          revoked: history.revoked,
          roles: Object.fromEntries(
            Object.entries(history.roles).map(([role, floor]) => [
              role,
              { ...(floor as { version: number; sha256: string }) },
            ]),
          ) as import("./contracts.js").ReleaseIndexTufState,
        };
      }
    }
    states.set(item.sourceId, {
      sourceId: item.sourceId,
      lastVersion: item.lastVersion,
      lastVerifiedAt: item.lastVerifiedAt,
      lastIndexSha256: item.lastIndexSha256,
      ...(item.tufRoots === undefined ? {} : { tufRoots }),
    } as ReleaseIndexSourceState);
  }
  const seen = new Set<string>();
  const sources: SourceInput[] = [];
  for (const [index, item] of rawSources.entries()) {
    const path = `/sources/${index}`;
    if (!isRecord(item))
      return { failure: requestFailure("source-invalid", "Expected a source entry.", path) };
    if (!isId(item.sourceId)) {
      return {
        failure: requestFailure("invalid-id", "Expected a source identifier.", `${path}/sourceId`),
      };
    }
    if (seen.has(item.sourceId)) {
      return {
        failure: requestFailure("duplicate-source", "Source ids are unique.", `${path}/sourceId`),
      };
    }
    seen.add(item.sourceId);
    const state = states.get(item.sourceId);
    if (state === undefined) {
      return {
        failure: requestFailure(
          "state-mismatch",
          "Every source needs exactly one state entry.",
          `/state`,
        ),
      };
    }
    let tufSelected = false;
    if (item.trust === "none") tufSelected = false;
    else if (
      isRecord(item.trust) &&
      Object.keys(item.trust).length === 1 &&
      item.trust.tufRoot instanceof Uint8Array
    ) {
      tufSelected = true;
    } else {
      return {
        failure: requestFailure(
          "invalid-trust",
          'Expected trust "none" or a TUF root.',
          `${path}/trust`,
        ),
      };
    }
    if (!Array.isArray(item.authorizedFrameworks)) {
      return {
        failure: requestFailure(
          "authorization-invalid",
          "Expected authorized framework ids.",
          `${path}/authorizedFrameworks`,
        ),
      };
    }
    const authorized = new Set<string>();
    for (const [frameworkIndex, frameworkId] of item.authorizedFrameworks.entries()) {
      if (!isId(frameworkId)) {
        return {
          failure: requestFailure(
            "invalid-id",
            "Expected a framework identifier.",
            `${path}/authorizedFrameworks/${frameworkIndex}`,
          ),
        };
      }
      authorized.add(frameworkId);
    }
    if (item.indexBytes !== undefined && !(item.indexBytes instanceof Uint8Array)) {
      return {
        failure: requestFailure(
          "malformed-bytes",
          "Index bytes are a Uint8Array.",
          `${path}/indexBytes`,
        ),
      };
    }
    if (item.indexBytes !== undefined && item.indexBytes.byteLength > RELEASE_MAX_BYTES) {
      return {
        failure: requestFailure(
          "byte-limit",
          "The index exceeds the byte ceiling.",
          `${path}/indexBytes`,
        ),
      };
    }
    if (item.offline !== undefined && typeof item.offline !== "boolean") {
      return {
        failure: requestFailure("offline-invalid", "Expected a boolean.", `${path}/offline`),
      };
    }
    sources.push({
      sourceId: item.sourceId,
      tufSelected,
      rootSha256: tufSelected
        ? sha256Hex((item.trust as { tufRoot: Uint8Array }).tufRoot)
        : undefined,
      verification: indexVerification(item.verification),
      authorized,
      bytes: item.indexBytes,
      offline: item.offline === true,
      state,
    });
  }
  if (states.size !== rawSources.length) {
    return {
      failure: requestFailure(
        "state-mismatch",
        "State entries correspond exactly to sources.",
        "/state",
      ),
    };
  }
  return { evaluatedAt: at, sources };
}

/** Reads, merges and advances every supplied source. Pure and portable. */
export function readReleaseIndex(request: ReadReleaseIndexRequest): ReadReleaseIndexResult {
  const parsed = parseRequest(request);
  if ("failure" in parsed) return parsed.failure;
  const { evaluatedAt, sources } = parsed;

  const results: ReleaseIndexSourceResult[] = [];
  const admitted: AdmittedEntry[] = [];
  let structuralFailure = false;

  for (const [sourceIndex, source] of sources.entries()) {
    const unchanged = source.state;
    const finish = (
      diagnostics: readonly ReleaseIndexDiagnostic[],
      entries: readonly ReleaseIndexEntry[] = [],
      state: ReleaseIndexSourceState = unchanged,
    ) => {
      results.push(Object.freeze({ sourceId: source.sourceId, diagnostics, state }));
      for (const entry of entries) {
        admitted.push({ entry, sourceRef: entry.source, sourceIndex });
      }
    };

    const proof = source.verification;
    if (source.tufSelected) {
      if (
        source.rootSha256 !== undefined &&
        unchanged.tufRoots?.[source.rootSha256]?.revoked === true
      ) {
        finish([
          withheld(
            "root-revoked",
            "root-revoked",
            "The persisted verified revocation withholds this selected root.",
          ),
        ]);
        continue;
      }
      if (
        proof === undefined ||
        proof.sourceId !== source.sourceId ||
        proof.rootSha256 !== source.rootSha256 ||
        source.bytes === undefined ||
        proof.indexSha256 !== sha256Hex(source.bytes) ||
        (!source.offline && proof.verifiedAt !== request.evaluatedAt)
      ) {
        finish([
          withheld(
            "offline",
            "tuf-unavailable",
            "TUF verification is unavailable without a cryptographically verified proof for these exact bytes, source and root.",
          ),
        ]);
        continue;
      }
      if (proof.expires <= evaluatedAt) {
        finish([
          withheld("expired", "tuf-expired", "TUF metadata has expired; its entries are withheld."),
        ]);
        continue;
      }
      const prior = unchanged.tufRoots?.[proof.rootSha256]?.roles;
      if (
        prior !== undefined &&
        Object.entries(prior).some(([role, floor]) => {
          const next = proof.tufState[role as keyof typeof prior];
          return (
            next.version < floor.version ||
            (next.version === floor.version && next.sha256 !== floor.sha256)
          );
        })
      ) {
        finish([
          withheld(
            "rollback-refused",
            "tuf-rollback-refused",
            "TUF metadata regresses or rewrites a recorded role version.",
          ),
        ]);
        continue;
      }
      if (proof.revoked) {
        finish(
          [
            withheld(
              "root-revoked",
              "root-revoked",
              "Verified metadata revokes this source's selected root; its entries are withheld.",
            ),
          ],
          [],
          {
            ...unchanged,
            tufRoots: {
              ...unchanged.tufRoots,
              [proof.rootSha256]: { roles: proof.tufState, revoked: true },
            },
          },
        );
        continue;
      }
    }

    if (source.bytes === undefined) {
      if (source.offline) {
        finish([
          withheld(
            "offline",
            "offline-no-copy",
            "The host declared this source offline and recorded no previously checked copy; no entries are used.",
          ),
        ]);
      } else {
        structuralFailure = true;
        finish([
          Object.freeze({
            code: "INPUT_INVALID",
            reason: "index-bytes-required",
            message: "Freshly acquired index bytes are required for an online read.",
            blocking: true,
            path: `/sources/${sourceIndex}/indexBytes`,
          }),
        ]);
      }
      continue;
    }

    const digest = sha256Hex(source.bytes);
    let documentValue: unknown;
    try {
      documentValue = readCanonicalBytes(source.bytes, {
        maxBytes: RELEASE_MAX_BYTES,
        maxDepth: RELEASE_MAX_DEPTH,
      });
    } catch (error) {
      if (!(error instanceof JsonAdmissionError)) throw error;
      structuralFailure = true;
      finish([
        Object.freeze({
          code: "INPUT_INVALID",
          reason: error.reason,
          message: "The index is not bounded canonical JSON with one LF.",
          blocking: true,
        }),
      ]);
      continue;
    }
    const checked = checkIndexDocument(documentValue);
    if (checked.document === undefined) {
      structuralFailure = true;
      finish(checked.diagnostics);
      continue;
    }
    const doc = checked.document;
    if (doc.sourceId !== source.sourceId) {
      structuralFailure = true;
      finish([
        Object.freeze({
          code: "INPUT_INVALID",
          reason: "source-id-mismatch",
          message: "The index document names a different source than the one it was supplied for.",
          blocking: true,
          path: "/sourceId",
        }),
      ]);
      continue;
    }

    const scopeEntries = () => {
      const kept: ReleaseIndexEntry[] = [];
      const dropped: ReleaseIndexEntry[] = [];
      for (const entry of doc.entries) {
        if (source.authorized.has(entry.frameworkId)) kept.push(entry);
        else dropped.push(entry);
      }
      return { kept, dropped };
    };

    if (source.offline) {
      if (unchanged.lastIndexSha256 === null || digest !== unchanged.lastIndexSha256) {
        finish([
          withheld(
            "offline",
            "offline-copy-mismatch",
            "The supplied bytes are not the recorded copy for this source; offline reuse never admits an unrecorded index.",
          ),
        ]);
        continue;
      }
      if (doc.expires <= evaluatedAt) {
        finish([
          withheld(
            "expired",
            "index-expired",
            "The recorded copy has expired; its entries are withheld.",
          ),
        ]);
        continue;
      }
      const { kept, dropped } = scopeEntries();
      finish(
        [
          advisory(
            "offline",
            "offline-cache",
            source.tufSelected
              ? "Acquisition failed; the last checked copy retains its TUF verification."
              : "Acquisition failed; the last checked copy is used and says so. The copy stays unsigned.",
          ),
          ...dropped.map((entry) =>
            advisory(
              "unauthorized-framework",
              "unauthorized-framework",
              "This source is not authorized for the framework; the entry is ignored.",
              {
                frameworkId: entry.frameworkId,
                version: entry.version,
              },
            ),
          ),
        ],
        kept,
      );
      continue;
    }

    if (
      doc.version < unchanged.lastVersion ||
      (doc.version === unchanged.lastVersion && digest !== unchanged.lastIndexSha256)
    ) {
      finish([
        withheld(
          "rollback-refused",
          "rollback-refused",
          "The index version does not increase beyond the recorded version; the source is refused and its entries are withheld.",
        ),
      ]);
      continue;
    }
    if (doc.expires <= evaluatedAt) {
      finish([
        withheld("expired", "index-expired", "The index has expired; its entries are withheld."),
      ]);
      continue;
    }
    const { kept, dropped } = scopeEntries();
    finish(
      [
        ...(source.tufSelected
          ? []
          : [
              advisory(
                "unsigned",
                "unsigned-index",
                "No TUF root was selected for this source; release bytes must still match the indexed digest.",
              ),
            ]),
        ...dropped.map((entry) =>
          advisory(
            "unauthorized-framework",
            "unauthorized-framework",
            "This source is not authorized for the framework; the entry is ignored.",
            {
              frameworkId: entry.frameworkId,
              version: entry.version,
            },
          ),
        ),
      ],
      kept,
      Object.freeze({
        ...unchanged,
        sourceId: source.sourceId,
        lastVersion: doc.version,
        lastVerifiedAt:
          source.tufSelected && proof !== undefined ? proof.verifiedAt : unchanged.lastVerifiedAt,
        ...(source.tufSelected && proof !== undefined
          ? {
              tufRoots: {
                ...unchanged.tufRoots,
                [proof.rootSha256]: { roles: proof.tufState, revoked: false },
              },
            }
          : {}),
        lastIndexSha256: digest,
      }),
    );
  }

  const groups = new Map<string, AdmittedEntry[]>();
  for (const item of admitted) {
    const key = `${item.entry.frameworkId}\u0000${item.entry.version}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const merged: MergedReleaseIndexEntry[] = [];
  const bySource = new Map<number, ReleaseIndexDiagnostic[]>(
    results.map((result, index) => [index, [...result.diagnostics]]),
  );
  for (const group of groups.values()) {
    const shas = new Set(group.map((item) => item.entry.sha256));
    if (shas.size > 1) {
      const { frameworkId, version } = group[0]?.entry as ReleaseIndexEntry;
      for (const item of group) {
        (bySource.get(item.sourceIndex) as ReleaseIndexDiagnostic[]).push(
          advisory(
            "conflict",
            "digest-conflict",
            "Two sources publish this framework and version with different release digests; neither is used.",
            { frameworkId, version },
          ),
        );
      }
      continue;
    }
    const winner = group.reduce((best, item) =>
      (STATUS_ORDER[item.entry.status] as number) > (STATUS_ORDER[best.entry.status] as number)
        ? item
        : best,
    );
    const sourcesRefs = group
      .slice()
      .sort((a, b) => a.sourceIndex - b.sourceIndex)
      .map((item) => item.sourceRef);
    merged.push(
      Object.freeze({
        frameworkId: winner.entry.frameworkId,
        name: winner.entry.name,
        version: winner.entry.version,
        location: winner.entry.location,
        sha256: winner.entry.sha256,
        schema: winner.entry.schema,
        status: winner.entry.status,
        ...(winner.entry.reason === undefined ? {} : { reason: winner.entry.reason }),
        evidence: winner.entry.evidence,
        sources: Object.freeze(sourcesRefs),
      }),
    );
  }
  merged.sort((a, b) => {
    if (a.frameworkId !== b.frameworkId) return a.frameworkId < b.frameworkId ? -1 : 1;
    return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
  });

  const sourceResults = results.map((result, index) =>
    Object.freeze({
      ...result,
      diagnostics: Object.freeze(bySource.get(index) as ReleaseIndexDiagnostic[]),
    }),
  );
  const structural = structuralFailure
    ? sourceResults.flatMap((result) =>
        result.diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === "INPUT_INVALID" || diagnostic.code === "SCHEMA_UNSUPPORTED",
        ),
      )
    : [];
  const value = {
    entries: Object.freeze(merged),
    sources: Object.freeze(sourceResults),
    diagnostics: Object.freeze(structural),
  };
  return deepFreeze(
    structuralFailure ? { valid: false, ...value } : { valid: true, ...value },
  ) as ReadReleaseIndexResult;
}
