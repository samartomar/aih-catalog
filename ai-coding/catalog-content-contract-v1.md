# Catalog content and Scan result public reading (Data-owned contracts)

This is the Data worker's frozen interface for the four-hour delivery path. It
answers the two items `approved-contract.md` §6 marks **needed from Data**, and
records the real evidence inventory those interfaces were built against.

Nothing here is organization admission, qualification, approval, installation or
effect authority. Catalog content presence and scanner result presence are never
either.

## 1. Real evidence inventory (measured, not asserted)

Measured in this checkout at `feat/package-boundaries`.

| Fact | Value | How measured |
| --- | --- | --- |
| Published index | `defaults/catalog-index-v1.json`, 5,654,210 bytes | `readCatalogContentV1` |
| Index format/version | `aih-catalog-index` / `1` | same |
| Entries | 457 (`aih` 28, `github` 428, `npm` 1) | same |
| Digest-bound references | 8,149 — 457 seeds, 1,828 artifacts, 457 reports, 457 rights, 4,185 gaps, 765 findings | recomputed sha256 per reference: 8,149 ok, 0 missing, 0 mismatched |
| Canonical index digest | `sha256:912d85585071eece67f33b1164e57a636c9442a9603531c59b00ac9139406a42` | `sha256` over the exact index bytes |
| Index canonical form | bytes equal `JSON.stringify(value) + "\n"` | byte equality check |
| Non-authority marker | `organizationAdmission: "not-authoritative"` | read and surfaced verbatim |

`aih`-sourced entries are **content-addressed**: the generator enforces
`source.revision === sha256:artifacts.profile.sha256`. Measured on entry
`agent.aih.governance-quality`: `source.revision` and `artifacts.profile.sha256`
are both `32ce6e9dea74ba84fe56b71ba6516e032f18aa4132e6ef7ebca507512d8735f7`.
That is why those 28 entries can be bound to scanned content and the
`github`/`npm` ones cannot — which matches Core's binding table.

Real retained Scan evidence in the Catalog defaults (not a fixture): a retained
verified scanner report wrapper whose body is the sealed Scanner report.

| Fact | Value |
| --- | --- |
| Wrapper | `defaults/workbench/aih/source-reports/verified-report-wrapper.json` |
| Sealed report digest | `sha256:fb34b793e8b254e97695687f34818d34d5f4ec30e76d7cefa8a65e01716b0d9c` |
| Recomputed over the wrapper body | identical |
| Raw `scanner-report.json` | hashes to the same digest |
| Report format | `packaged-scanner-collection-evidence/v1`, `authority: display-only` |
| Real detector identities | `aih-native native.014fbd614a5a`; `cisco@uvx 2.0.14+uvlock.aaba1f326049`; `semgrep@uv:1.173.0 1.173.0+uvlock.77f2bf3e7525`; `skillspector@docker 2d198ab9…@sha256:c5d4a181…` |
| Real findings present | yes — e.g. `trust.external-egress` on `declarations/claude/project/github.json`, verdict `blocked`, fingerprint `trust-raw:355e76fb…` |
| Already recorded in Catalog | entry `agent.aih.governance-quality` `qualification.report.summary` names this exact sealed report digest and receipt `a1dd97db…` |

**Absent, and reported as absent:** no committed `ScanCaptureBundleV2` exists in
either repository, so no real raw annex bytes (SARIF / SBOM / provenance) are
available to read in this time box. The Scan reader is therefore tested against
in-process synthesized fixtures only, and those are unit-test evidence, not a
detector run. Do not read a passing Scan reader test as a real scan.

## 2. Catalog: `@aihq/catalog` public content reader

Module `src/content/catalog-content-v1.ts`, re-exported by name from
`src/index.ts`. Index bytes are also reachable at the subpath export
`@aihq/catalog/catalog-index.json`.

```ts
export const CATALOG_CONTENT_FORMAT_V1 = "aih-catalog-index";
export const CATALOG_CONTENT_VERSION_V1 = 1;
export const CATALOG_CONTENT_INDEX_ROOT_URL = "defaults/catalog-index-v1.json";
export const CATALOG_CONTENT_INDEX_SUBPATH_V1 = "./catalog-index.json";
export const CATALOG_CONTENT_MAX_BYTES_V1 = 64 * 1024 * 1024;

export function readCatalogContentV1(
  request: {
    bytes: Uint8Array;                 // the exact index bytes
    expectedDigest?: string;           // "sha256:<64 hex>"; a mismatch refuses
    input?: {
      root: string;                    // package root; descriptor paths are root-relative
      verifyArtifacts?: boolean;
      readArtifact?: (request: { path: string; sha256: string }) => Uint8Array | undefined;
    };
  },
): CatalogContentV1 | undefined;

export function parseCatalogContentV1Bytes(bytes: Uint8Array): CatalogContentV1 | undefined;
export function resolveCatalogContentPathV1(root: string, path: string): string | undefined;
```

Result shape:

```ts
{
  format: "aih-catalog-index"; version: 1;
  digest: "sha256:<64 hex>";                    // over the exact bytes read
  package: { name: "@aihq/catalog"; version: "0.2.0" };
  organizationAdmission: "not-authoritative";   // verbatim; never admission
  status: { structure: "valid"; artifacts: "verified" | "unverified" | "not-evaluated" };
  entries: readonly CatalogEntryV1[];           // 457, in published order
}
```

`CatalogEntryV1` preserves item identity exactly:

| Field | Shape | Owner note |
| --- | --- | --- |
| `entryId` | `"agent.aih.governance-quality"` | Catalog |
| `subject` | `{ id, kind, source, sourceDigest, subjectDigest }` | Copied verbatim; already exact `GovernanceDecisionSubjectV2` |
| `seed`, `artifacts.<name>` | `{ path, sha256 }` | **bare 64-hex, no `sha256:` prefix** — the UI must prefix for Core |
| `artifacts.<name>` (verified) | `{ state: "verified", bytes, byteLength, … }` | only when `verifyArtifacts` is on |
| `qualification.{report,findings,gaps,rights}` | `{ path, sha256, subjectDigest, format, kind, id, attestor }` | display as facts, never approval |
| `capabilities`, `platforms` | declared arrays | Catalog |

Refusals (returns `undefined`, never a partial object): unknown format or
version, missing/ill-typed fields, malformed JSON, non-canonical bytes, UTF-8
BOM, oversize bytes, duplicate `entryId`, entries out of published order, unsafe
descriptor path (absolute, `..`, backslash, empty segment), an evidence record
whose `subjectDigest` is not that entry's, or a declared index digest mismatch.
Unknown **contract versions fail closed**; `version: 2` and a missing `version`
are both refused. `index-version 1` is not reinterpreted.

## 3. Scan: `@aihq/scan` public result reader

Module `src/observation/scan-result-record-v1.ts`, re-exported by name from
`src/index.ts`.

**Blocker answer.** `verified.facts.subject.sha256` was already publicly typed
and reachable through the existing export `VerifiedScanAttestationV2`. This adds
a stable, checked accessor so Core does not have to reach into `facts`:

```ts
export const SCAN_RESULT_SUBJECT_NAME_V1 = "source-tree";

export function readScanResultSubjectBindingV1(request: { verified: unknown }):
  | { status: "bound"; subjectName: "source-tree"; subjectSha256: string }
  | { status: "unverified" };
```

`subjectSha256` is **bare 64-hex** and is taken from the verified attestation,
never from the caller. Anything that is not a value minted by
`verifyScanAttestationV2` returns `unverified` — including a structurally
identical object literal, because verification is tracked in a `WeakSet`.

```ts
export const SCAN_RESULT_RECORD_FORMAT_V1 = "aih-scan-result-record";
export const SCAN_RESULT_RECORD_VERSION_V1 = 1;

export function readScanResultRecordV1(request: {
  verified: unknown;
  annexArtifacts?: readonly { descriptorId: string; bytes: Uint8Array }[];
  envelopeBytes?: Uint8Array;
}):
  | { status: "available"; result: ScanResultRecordV1 }
  | { status: "unverified" }
  | { status: "invalid-input"; reason: string };
```

`ScanResultRecordV1` exposes only facts the attestation declares: `subject`,
`signer`, `replayIdentity`, `claims` (exactly `signedAt`, `expiresAt`,
`origin: "signer-asserted"`, `provenance: "none"`), `coreContract`, `run`
(`state`, `cleanupOutcome`, `provenance`), `platform`, `coverage`, `detector`
(identity, `adapterCapability`, `analyzerIdentity`, OCI manifest/config digests,
adapter, observation configuration, execution profile, supported platform,
`sourceSealV1`, observation coverage), `observations`/`findings`
(`rawOccurrenceFingerprint` + `multiplicity` only), `evidenceBindings`, `annexes`
(digest-bound references, bytes only when supplied), and `gaps`.

Honest states preserved verbatim, never defaulted: `sbom.state` and
`provenance.state` stay `digest-bound-unverified`; broker enforcement stays
`unverified`; SARIF stays `digest-bound-unverified` and is never parsed.

`gaps` names each absent fact explicitly: `sarif-not-interpreted`,
`finding-message-and-location-not-read-from-annex`,
`severity-not-declared-by-attestation`,
`annex-and-signing-states-are-declared-not-verified`,
`no-effect-or-qualification-authority`, `ci-claim-set-not-restated`.

Refusals: an unverified or forged value returns `unverified`; annex bytes that
do not match the verified descriptors, or envelope bytes that are not this
attestation's canonical envelope, return `invalid-input`. Detector normalization
and execution stay in Scan; Catalog never normalizes a detector result.

## 4. What remains absent

- No committed real `ScanCaptureBundleV2`, so no real annex bytes are readable.
- No signed AIH-supported qualification receipt in the tarball; the index itself
  declares `not-authoritative`. The Catalog qualification basis stays BLOCKED.
- 429 of 457 entries (`github` + `npm`) cannot be bound to scanned content at
  all, because their source identity is a commit or an SRI digest, not content.
- `aih-supported` is not run against this checkout; the subpath export and public
  entry points are proven only through a packed, installed consumer.
