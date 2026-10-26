# Release and index trust

This is preparation for the unreleased `0.1.0`. Publication remains blocked.
No production signer identity has been activated, no production root exists by
virtue of these fixtures, and the first production use has not happened. The
maintainer must separately authorize (1) the Catalog workflow's production
signer identity and (2) the offline TUF root ceremony with two of three keys
held by the maintainer. Neither authorization is requested or implied here.

## Caller-selected authority

A discovered source description names data; it never selects a root, publisher,
metadata endpoint or framework authority. The host independently configures those
values. Core's optional public trust-update route can supply the root:

```js
import { createTufTrustClient, getCatalogIndexTrust } from "@aihq/core/harness/runtime";
import { verifyReleaseIndexTuf } from "@aihq/catalog/node";
import { readReleaseIndex } from "@aihq/catalog/reader";

// The host chooses the trust-update options, transport, cache and when to update.
const snapshot = await createTufTrustClient(hostTrustUpdateOptions).update();
const trust = getCatalogIndexTrust(snapshot); // "none" or { tufRoot: Uint8Array }
// Metadata and index bytes are acquired by the host from its configured source.
const verified = verifyReleaseIndexTuf({ sourceId, trust, indexBytes,
  targetPath: "release-index.json", evaluatedAt,
  metadata: { roots: consecutiveRotatedRoots, timestamp, snapshot, targets } });
if (!verified.valid) throw new Error(verified.reason);
const result = readReleaseIndex({ evaluatedAt, state, sources: [{ sourceId,
  trust, indexBytes, verification: verified.verification, authorizedFrameworks }] });
// Persist result.sources[].state, including tufState role floors, atomically.
```

Without a selected root, call `readReleaseIndex` with `trust: "none"` and no
verification proof. It reports `unsigned`. Selecting a root switches that source
to mandatory TUF verification in one index release: missing, forged, serialized,
wrong-source, wrong-root or altered-byte proofs withhold entries, with no unsigned
fallback. A proof is process-local and cannot be saved or reconstructed as JSON;
after restart the host reacquires or reads its cached metadata and verifies again.
The host owns root selection, acquisition, bounded transport, cache and persistence.
Neither function performs network requests or discovers trust. The reader is
synchronous, portable and pure; the Node cryptographic seam uses pinned
`@tufjs/models` public APIs to create its opaque evidence, never unchecked booleans.

The supported profile is top-level TUF root/timestamp/snapshot/targets metadata,
canonical UTF-8 JSON plus LF, at most 1 MiB/depth 32 per metadata file and at most
32 consecutive root rotations. Targets must bind the selected index path by exact
length and SHA-256. Other TUF serializations or delegated targets need a future
explicit adapter; they are refused here. Root updates require the old and new
thresholds, strictly consecutive versions, and a non-expired final root. All final
roles must be unexpired at the caller's evaluation time. The reader preserves
per-role version/digest floors alongside the existing index rollback state.
Persist `revokedRootSha256` too: a verified root revocation is retained across
reads and cannot be undone by replaying older metadata.

An authenticated top-level targets document may carry the extension
`catalogRootRevocations: [{sourceId, rootSha256}]`, where the hash is the exact
host-selected bootstrap root bytes. Only after validating the complete TUF chain
can a matching source and root produce `root-revoked`; another source's statement
cannot revoke this source. Framework publishing and release revocation remain
limited by the host's `authorizedFrameworks`. A root revocation withholds the
source. An expired index or TUF proof withholds its entries. Offline reuse needs
the recorded exact index and still-valid cryptographic proof; cached metadata must
be reverified after process restart. No status deletes installed material.

Pass an admitted entry's `sha256` as `readRelease(bytes, {expectedSha256})` when
reading its acquired release. A release with changed bytes fails even when the
index is signed. An unsigned index's self-advertised hash establishes integrity
only, not publisher authenticity.

Index trust is separate from Scan evidence authenticity and policy. Scan policy
carries no signer identity; neither changing it nor omitting evidence can select
or disable an index root. Release preparation still requires the existing exactly
bound, authenticated, readable baseline with honest gaps. TUF does not replace it.

## Keyless signing preparation

`.github/workflow-templates/catalog-release-signing.yml.disabled` is an inert
manual workflow blueprint outside Actions' active workflow directory, with a
literal false job gate. Existing CI pause and publication refusal stay in force.
The prepared code calls `cosign sign-blob --yes --bundle <file>.sigstore.json
<file>` for both the release document and index. Cosign signs their SHA-256
digests using keyless Sigstore, with no stored signing key. Each bundle is a
sibling of its document, and the prepared upload retains all four files together.
There is no tag, release, npm publication or dispatch in this preparation.

Before a future reviewed activation, the maintainer must configure the protected
signing environment and its **authorized** exact certificate subject identity and
OIDC issuer. The blueprint reads `CATALOG_EXPECTED_CERTIFICATE_IDENTITY` and
`CATALOG_EXPECTED_OIDC_ISSUER` repository/environment variables. Their values are
intentionally not invented here. Consumers configure their own expected publisher
identity and issuer from that separately authorized record; a downloaded bundle
or Scan evidence policy must never choose these values. The blueprint verifies
both bundles against these configured values before retaining its output.

For a consumer with independently configured expected values and a compatible
cosign installation:

```sh
cosign verify-blob --bundle release.json.sigstore.json \
  --certificate-identity "$EXPECTED_IDENTITY" \
  --certificate-oidc-issuer "$EXPECTED_ISSUER" release.json
cosign verify-blob --bundle release-index.json.sigstore.json \
  --certificate-identity "$EXPECTED_IDENTITY" \
  --certificate-oidc-issuer "$EXPECTED_ISSUER" release-index.json
```

Verification checks the exact document bytes. A different identity, wrong issuer,
changed document or missing/invalid bundle must fail. Sigstore publisher trust
and the selected TUF source root are independent consumer inputs.

## Local proof

`node tools/verify-release-index-tuf-consumer.mjs [catalog.tgz]` installs the exact
packed package outside the checkout and uses only public exports and the public
`fixtures/release-index/tuf-local.json`. Generated fixture private keys were
discarded; these are not production roots or identities. Cases cover the unsigned
changeover, root rotation, forged roots/signatures/proofs, expiry, scoped verified
root revocation, rollback, exact cached readback, tampered index/release refusal
and independence from Scan evidence policy. No live signer or transport is used.

`tests/release/release-signing-preparation.test.ts` exercises the workflow helper
with ephemeral fixture keys and an injected fixture signer. It proves the two
command plans, digest custody and sibling layout, not Sigstore/OIDC integration
or first production use. Real keyless signing, signer activation, root ceremony
and publication remain unperformed and separately authorized future operations.
