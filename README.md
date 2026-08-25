# @aihq/catalog

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

`@aihq/catalog` is AIH Catalog, the public Catalog V2 producer and verifier for
AI Development Assurance. It binds exact tool, skill, MCP, package, and profile
sources to byte-addressed evidence, explicit capabilities, an administrator
Ed25519 signature, continuity, and bounded validity.

**Core governs. Scan produces evidence. Catalog provides AIH qualification. The
organization provides authority.**

The source package is `@aihq/catalog@0.1.0`; the command remains
`aih-supported`. It is Apache-2.0 licensed and has not been published to npm.
The pinned package-release workflow is present, but the protected environment,
first-package bootstrap, npm trusted-publisher binding, exact tag, GitHub
Release, and npm version remain owner actions documented in
[RELEASING.md](RELEASING.md). Package publication and the manual catalog/receipt
outer-attestation workflow are separate effects; each requires its own exact-SHA
authorization. Publishing remains separately authorized.

## Authority boundary

There are two independent governance paths:

- `aih-supported` means a catalog signer included the exact subject and evidence
  in a verified Catalog V2 head.
- `organization-qualified` means an organization bound its own exact subject to
  its own evidence and attestor through the Core Strict V2 decision contract and
  V3 authority receipt.

The supported catalog is optional convenience. It is not an admission authority,
and its CLI reports `organizationAdmission: "not-authoritative"`. Absence from
this catalog must not block an organization-qualified subject. Evidence attestors
and catalog signers are also separate identities: catalog signing authenticates
the catalog; it does not convert an evidence declaration into an organization
approval.

Core does not consume Catalog V2 directly; it neither imports nor reverifies the
catalog. This package emits one closed Strict Qualification Receipt V2 after
full Catalog V2 verification. The receipt carries the exact member basis plus
the authenticated catalog continuity that Core needs for its own durable
high-water custody. Core's matching V2 consumer is available through
`aih policy supported accept` and `aih policy supported inspect`. Acceptance
separately verifies the receipt's outer GitHub attestation, the current Strict
V2 organization decision carried by its V3 authority receipt, and the exact
receipt fields before writing durable signer, replay, head, and head-scoped
member custody. Inspection is read-only. Neither command turns catalog
membership into organization admission.

## Install and inspect from a clean consumer

Until npm publication is separately authorized, build a tarball from an exact
reviewed checkout and install it in a disposable consumer:

```sh
npm ci
npm run build
npm pack --pack-destination ../artifacts
mkdir ../catalog-consumer
cd ../catalog-consumer
npm init -y
npm install --ignore-scripts ../artifacts/aihq-catalog-0.1.0.tgz
```

After publication, the equivalent version-pinned install will be:

```sh
npm install --save-exact @aihq/catalog@0.1.0
npm audit signatures
gh release download v-catalog-0.1.0 --repo samartomar/aih-catalog --pattern "aihq-catalog-0.1.0.tgz"
gh attestation verify ./aihq-catalog-0.1.0.tgz --repo samartomar/aih-catalog --signer-workflow samartomar/aih-catalog/.github/workflows/release.yml --source-ref refs/tags/v-catalog-0.1.0 --deny-self-hosted-runners
./node_modules/.bin/aih-supported --help
```

The package workflow keeps candidate execution in a read-only job. Its protected
job downloads the packed candidate by immutable artifact ID, revalidates the
original tarball digest before every effect, re-observes the tag and `main`, and
runs no candidate package code. It binds npm provenance, a GitHub build
attestation, a tarball-scoped SPDX SBOM, the checksum, and a keyless cosign
checksum bundle to the exact tagged source. Do not run this block until
`npm view @aihq/catalog@0.1.0` succeeds. Those package-release records do not
sign a Catalog V2 head or Qualification Receipt and do not grant organization
authority.

Obtain these inputs through administrator-controlled channels:

- the signed catalog JSON;
- its catalog-signer root JSON, distributed out of band;
- the exact expected GitHub claims JSON;
- either the trusted last accepted head or an explicit genesis decision; and
- optionally, caller-maintained replay state for identities already accepted;
- the current UTC time supplied by the caller.

Inspect a genesis head and derive one qualification basis:

```sh
printf '{"acceptedIdentities":[]}' > ./replay-state.json
./node_modules/.bin/aih-supported inspect --signed-catalog ./signed-catalog.json --catalog-signer-root ./catalog-signer-root.json --expected-claims ./expected-claims.json --replay-state ./replay-state.json --now 2026-08-22T12:00:00Z --continuity genesis --qualification-basis --entry-id recipe.default
```

For a successor, replace `--continuity genesis` with
`--last-accepted-head ./last-accepted-head.json`. A successful materializable
result includes the verified head and, when requested, a basis containing
`catalogHeadDigest`, `catalogMemberDigest`, the catalog signer identity, and the
exact subject digest. Unknown schema or effect versions are returned only as an
authenticated `unsupported-version` record; they are never materialized as V2.

Verification is deliberately caller-timed and fail-closed. Expired heads,
untrusted or duplicate roots, identities already present in supplied replay
state, skipped continuity, malformed claims, and ambiguous inputs fail without
creating an output. The verifier never mutates replay state; after its own
atomic acceptance, the caller records the returned replay identity. Omitting
`--replay-state` disables only that caller-owned duplicate-identity check.

## Emit the Core qualification receipt

After the same catalog verification succeeds, emit one receipt for an exact
entry to a new file:

```sh
mkdir -p ./.aih
./node_modules/.bin/aih-supported emit-qualification-receipt --signed-catalog ./signed-catalog.json --catalog-signer-root ./catalog-signer-root.json --expected-claims ./expected-claims.json --replay-state ./replay-state.json --now 2026-08-22T12:00:00Z --continuity genesis --entry-id recipe.default --output ./.aih/aih-supported-qualification-receipt.json
```

For a successor, use `--last-accepted-head` as for `inspect`. The receipt is
canonical JSON no larger than 5,970 bytes, the measured maximum legal V2
encoding. The Supported channel first bounds the subject's complete canonical
source object to 4,096 bytes; organization-qualified Core remains available for
exact sources outside that optional-channel limit. The receipt binds the full
exact subject, entry id, all seven Core
`aih-supported` basis fields, issuance and catalog-bounded expiry, and
`organizationAdmission: "not-authoritative"`. Its separate
`catalogContinuity` block carries the mirrored head digest, predecessor,
sequence, signed replay identity, Ed25519 signer key id, and exact head-validity
window. Every field is derived from the already verified signed head and member;
no caller flag can override it. The file is written with exclusive creation and
is never printed to stdout. An existing or linked output path fails closed.

The file is not trusted merely because this command created it. The official
workflow accepts its exact SHA-256, issuance timestamp, and entry id, reproduces
the bytes at the exact main commit, and makes the receipt a separate protected
attestation subject. Core verifies that outer attestation against its dedicated
supported repository/workflow roots before using the receipt as provenance.

Receipt V1 is not a compatibility path: an older Core V1 verifier must reject
these bytes and may not infer the new continuity fields. Core's matching V2
consumer owns the out-of-checkout supported repository/workflow roots, live
clock, outer-attestation verification, administrator signer-key lineage,
durable replay/head/member custody, and current organization decision. Place the
receipt at the fixed target path shown above; then use Core's preview-first
`aih policy supported accept` command with the exact decision reference and
target. Apply remains unavailable unless the production authority and GitHub
support attestation both verify.
`aih policy supported inspect --root <target> --json` reports only current
scrubbed custody and performs no write.

Repository CI verifies an exact clean Core checkout at
`c0324d331deffe6ca757be5ee9bbdcffb9927883`, materializes that locked revision
in a disposable detached clone, and builds and packs both packages
there. It installs both tarballs into disposable roots and proves that packed
Core accepts the emitted V2 receipt and the exact 5,970-byte legal ceiling,
rejects V1 and 5,971 bytes, reaches the production acceptance boundary, and
exercises read-only inspection. Because the real
outer-attestation workflow has not been authorized or executed, that cold proof
expects production acceptance to fail closed with `AIH_TRUST`; it does not
fabricate a successful custody write. Successful production acceptance remains
contingent on genuine organization authority and the separately authorized
GitHub attestation.

## Produce a candidate

Candidate generation is local and data-only. It performs no provider request,
network fetch, installation, repository write, or automatic qualification. A
seed names four bounded local artifacts and evidence files relative to the seed.
It also carries the exact Core-compatible source instead of a mutable package
label. For example:

```json
{
  "artifacts": {
    "closure": "artifacts/closure.json",
    "profile": "artifacts/profile.json",
    "prose": "artifacts/prose.md",
    "recipe": "artifacts/recipe.json"
  },
  "capabilities": {
    "commands": ["catalog.verify"],
    "egress": ["https://api.github.com"],
    "hooks": ["hook.catalog.verify"],
    "mcpTools": ["github.get_workflow_run"],
    "permissions": ["contents:read"]
  },
  "entryId": "recipe.default",
  "platforms": [{ "architecture": "amd64", "os": "linux" }],
  "qualification": {
    "findings": [],
    "gaps": [],
    "report": "evidence/report.json",
    "rights": ["evidence/right-catalog-read.json"]
  },
  "subject": {
    "id": "default-profile",
    "kind": "profile",
    "source": {
      "release": "1.0.0",
      "revision": "sha256:1492fa09fc057e2e3659ca5ad3d143ba5a4b529a2b18e027b5e40a75439518c9",
      "type": "aih"
    }
  }
}
```

Each evidence path contains an exact JSON envelope with
`format`, `kind`, `id`, `subjectDigest`, `attestor`, and `summary`. The generator
reads each bounded regular file once, validates its subject and attribution, and
hashes those same bytes. It rejects caller-supplied evidence digests. Empty
findings or gaps mean no declared exceptions in that evidence report; the
required report prevents that from being confused with no evidence supplied.

Generate and sign using files prepared outside the package:

```sh
./node_modules/.bin/aih-supported generate-candidate --seed ./seed.json --signer ./catalog-signer.json --claims ./claims.json --valid-from 2026-08-22T00:00:00Z --valid-until 2026-08-23T00:00:00Z --sequence 0 --previous-catalog-head-sha256 0000000000000000000000000000000000000000000000000000000000000000 --output ./candidate.json
./node_modules/.bin/aih-supported sign-candidate --candidate ./candidate.json --private-key ./catalog-signer-private.pem --output ./signed-catalog.json
```

On POSIX systems, the private key must not grant group or other access. Output
creation is exclusive, and linked seed artifacts, evidence, private keys, or
output paths are rejected. Keep signer roots outside catalog-controlled data.

## Version bumps, removal, and revocation

A successor increments `sequence` and binds the previous
`catalogHeadSha256`. Changing a source version, evidence, capability, signer,
platform, recipe, prose, schema, or effect produces deterministic promotion
facts and preserves the last-good head during automatic evaluation. Removing an
entry produces an `entry-removed` fact; that is catalog revocation for later
consumers.

The manual workflow uploads a canonical promotion plan that binds the candidate
head, last-good head, and every fact. A material change crosses the effect
boundary only when the caller supplies the exact promotion-plan, signed-catalog,
and qualification-receipt SHA-256 values plus the receipt issuance timestamp and
entry id, and the protected `catalog-signing` environment approves those exact
bytes. The independent verifier then recomputes continuity, plan bytes, inner
signature, claims, receipt bytes, and both outer provenance records.

Removal does not retroactively invalidate a Core decision already issued for a
pinned member digest. Organizations revoke those decisions through Core's
separate digest-bound revocation authority. Catalog validity is limited to 90
days, so consumers must re-observe rather than treating a cached verdict as
authority.

## Signatures and provenance

The inner administrator Ed25519 DSSE/in-toto signature binds the catalog head.
Its inner claims are a declaration checked against caller-supplied expected
repository, workflow, issuer, ref, environment, and repository identities. The
catalog-signer root remains out of band.

The separately authorized workflow adds independent GitHub OIDC/keyless
attestations for the exact signed catalog and exact qualification receipt at the
main commit. Consumers must perform GitHub attestation verification as a
separate layer. Outer transparency provenance does not replace the inner
signature, approve organization use, or publish npm bytes.

Catalog members use domain-separated `aih-supported-catalog-member/v2`, catalog,
and catalog-head digests. The Core source and subject digest formulas and
`catalogHeadSha256`/`candidateSha256` bindings are locked to the vendored Core
schema and compatibility vectors.

## Consume or contribute

Applications may import the bounded API from `@aihq/catalog` to create,
canonicalize, sign, verify, inspect, compare, and derive qualification bases. The
package has no runtime dependencies and exports no network/provider controller.

Contributions should add exact source descriptors, seed-relative evidence,
capability declarations, and negative tests. A contribution is only a candidate;
review, administrator signing, the exact promotion-plan digest, protected
approval, CI, and separately authorized publication remain distinct steps.

See [the Catalog V2 contract](https://github.com/samartomar/aih-catalog/blob/main/ai-coding/supported-catalog-v2.md)
for schemas, limits, trust boundaries, and maintainer verification commands.

## License

[Apache-2.0](LICENSE). Catalog software and qualification data are provided on
an "AS IS" basis without organization approval, admission, warranty, support,
or effect authority.
