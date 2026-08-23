# @aihq/supported

`@aihq/supported` is the public Catalog V2 producer and verifier for the
AI-Harness-supported channel. It binds exact tool, skill, MCP, package, and
profile sources to byte-addressed evidence, explicit capabilities, an
administrator Ed25519 signature, continuity, and bounded validity.

The package is release-ready at `1.0.0`, but publication is deferred and the
repository still sets `private: true`. Publishing to npm or running the manual
outer-attestation workflow requires separate authorization for an exact commit
SHA.

## Authority boundary

There are two independent governance paths:

- `aih-supported` means a catalog signer included the exact subject and evidence
  in a verified Catalog V2 head.
- `organization-qualified` means an organization bound its own exact subject to
  its own evidence and attestor through the Core Strict V3 decision contract.

The supported catalog is optional convenience. It is not an admission authority,
and its CLI reports `organizationAdmission: "not-authoritative"`. Absence from
this catalog must not block an organization-qualified subject. Evidence attestors
and catalog signers are also separate identities: catalog signing authenticates
the catalog; it does not convert an evidence declaration into an organization
approval.

Core does not consume Catalog V2 directly; it neither imports nor reverifies the
catalog. This package can emit the closed Core-owned qualification receipt after
full Catalog V2 verification; Core then independently verifies the receipt's
outer GitHub attestation and exact fields. The organization must still issue the
separately authorized Strict V3 governance decision.

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
npm install --ignore-scripts ../artifacts/aihq-supported-1.0.0.tgz
```

After publication, the equivalent version-pinned install will be:

```sh
npm install --save-exact @aihq/supported@1.0.0
```

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
canonical JSON no larger than 4 KiB. It binds the full exact subject, all seven
Core `aih-supported` basis fields, issuance and catalog-bounded expiry, and
`organizationAdmission: "not-authoritative"`. It is written with exclusive
creation and is never printed to stdout. An existing or linked output path fails
closed.

The file is not trusted merely because this command created it. The official
workflow accepts its exact SHA-256, issuance timestamp, and entry id, reproduces
the bytes at the exact main commit, and makes the receipt a separate protected
attestation subject. Core verifies that outer attestation against its dedicated
supported repository/workflow roots before using the receipt as provenance.

In the target repository, an administrator or integration can ask the installed
Core package to re-observe both protected attestations and the exact current V3
decision:

```js
import { verifyAihSupportedQualificationArtifactV1 } from "@aihq/harness";

const result = await verifyAihSupportedQualificationArtifactV1({
  root: process.cwd(),
  decisionReference: { id: decision.id, digest: exactDecisionDigest },
  subject: decision.subject,
});

if (result.state !== "verified") throw new Error(result.problem);
```

Set Core's out-of-checkout authority registry root and the dedicated supported
repository/workflow roots through `AIH_POLICY_AUTHORITY_REPOSITORY`,
`AIH_SUPPORTED_QUALIFICATION_REPOSITORY`, and
`AIH_SUPPORTED_QUALIFICATION_WORKFLOW`; none may come from the governed checkout.
The caller cannot supply Core's runner, environment snapshot, clock, authority,
or supported-target set. The return value is only an inert current-state verdict;
it contains no authority receipt, qualification capability, or reusable evidence.

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

Applications may import the bounded API from `@aihq/supported` to create,
canonicalize, sign, verify, inspect, compare, and derive qualification bases. The
package has no runtime dependencies and exports no network/provider controller.

Contributions should add exact source descriptors, seed-relative evidence,
capability declarations, and negative tests. A contribution is only a candidate;
review, administrator signing, the exact promotion-plan digest, protected
approval, CI, and separately authorized publication remain distinct steps.

See [the Catalog V2 contract](https://github.com/samartomar/aih-supported/blob/main/ai-coding/supported-catalog-v2.md)
for schemas, limits, trust boundaries, and maintainer verification commands.
