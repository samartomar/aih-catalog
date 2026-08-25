# Supported Catalog V2 contract

This document is the operator and maintainer contract for the public Catalog V2
surface in `@aihq/catalog@0.1.2`; its command remains `aih-supported` and its V2
wire/domain names remain stable. The source package uses Apache-2.0 and has a
pinned, provenance-capable `v-catalog-X.Y.Z` release path.
Publication remains deferred; publishing npm bytes or executing the catalog/receipt
outer-attestation workflow requires separate exact-SHA authorization for that
specific effect.

## Purpose and authority

Catalog V2 gives administrators a maintained, signed source of exact supported
subjects. It is optional. `aih-supported` and `organization-qualified` are
different qualification provenance paths, and catalog membership is not an
admission authority. The CLI makes that boundary machine-visible as
`organizationAdmission: "not-authoritative"`.

Core does not consume Catalog V2 directly. This package emits the closed
Core-owned Strict Qualification Receipt V2 only after verifying Catalog V2. The
receipt carries the exact member basis and authenticated continuity facts; the
matching Core V2 consumer separately verifies its outer attestation and exact
fields. A separate Strict V2
governance decision carried by a V3 authority receipt must still authorize use. An
organization can therefore qualify a tool, skill, MCP server, package, or profile
with its own exact source and evidence even when the subject is absent from the
supported channel.

## Data flow

1. A contributor declares an exact Core-compatible subject source, capabilities,
   platforms, and seed-relative artifacts.
2. Evidence envelopes declare their own attestor and bind the derived subject
   digest. The candidate generator reads and hashes the same bounded bytes.
3. The generator derives closed, sorted entries and the domain-separated member,
   catalog, and head digests.
4. An administrator signs the exact canonical head with Ed25519 DSSE/in-toto.
5. A cold consumer verifies an out-of-band root, static expected claims, current
   validity, continuity, caller-supplied replay state when used, the signature,
   and all digest mirrors.
6. The producer emits one closed, canonical, non-authoritative Strict
   Qualification Receipt V2 for an exact verified member, including the
   authenticated head continuity and replay identity.
7. A separately authorized manual workflow may attach independent GitHub
   OIDC/keyless outer provenance to the exact catalog and receipt after their
   hashes and the exact promotion plan are approved.

Candidate generation has no signing, provider, network, repository-write, or
organization-admission authority. Signing executes no candidate code. The outer
GitHub attestation is a provenance/transparency layer, not a replacement for the
inner administrator signature.

## Exact subjects

The subject shape is `{id, kind, source, sourceDigest, subjectDigest}`. Supported
kinds are `tool`, `skill`, `mcp`, `package`, and `profile`. Supported sources are
the closed Core V2 GitHub, npm, PyPI, OCI, remote-content, and AIH variants,
including the optional OCI platform variant.

Source and subject digests use the exact Core domains:

- `aih-governance-decision-source/v2\0<canonical-source>`
- `aih-governance-decision-subject/v2\0<canonical-id-kind-sourceDigest>`

For an AIH source, `revision` must equal the SHA-256 of the profile artifact. For
other source kinds, the producer validates and binds the declaration but does not
contact the provider or claim the package was installed or executed.

## Evidence

A seed qualification contains one required report path, zero to 64 finding
paths, zero to 64 gap paths, and one to 64 rights paths. Every path is relative to
the seed, resolves through regular non-linked components, and is limited to 1
MiB. Profile, recipe, closure, and prose artifacts have the same size bound.

Each evidence file has exactly:

```json
{
  "attestor": "attestor:example/control-owner",
  "format": "aih-supported-evidence/v2",
  "id": "evidence-id",
  "kind": "report",
  "subjectDigest": "sha256:...",
  "summary": "Scoped statement about these evidence bytes"
}
```

`kind` must match its seed collection. `subjectDigest` must match the candidate
subject. `attestor` follows the locked Core attestor grammar and is not replaced
by the catalog signer. The candidate records an identity and SHA-256 of the exact
validated bytes; caller-supplied evidence hashes are rejected. The producer does
not interpret a summary as a pass, scan external content, or automatically admit
the subject.

## Head, signature, and compatibility

`CatalogHeadV2` binds:

- exact sorted entries and `aih-supported-catalog-member/v2` member digests;
- `catalogSha256`, `catalogHeadSha256`, and `candidateSha256`;
- compatible schema and effect versions;
- sequence and previous head digest;
- validity and signer identity;
- repository, workflow, issuer, ref, environment, and repository identity claims;
- DSSE payload type, in-toto subject, replay identity, and one Ed25519 signature.

The Core contract is locked to commit
`aa93128ff56b3ed978ec428e29d1b1ce8036e53b`, package
`@aihq/core@0.1.0`, package-manifest SHA-256
`af64feda4e3e57808e1a262e15a5cb8f41581f77e8f9b49eb9b459317b803ecd`,
decision-schema SHA-256
`27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff`,
and Receipt V2 schema SHA-256
`40a2522dfd05b370c537dc5d9b05ddc3fe2a1d6e1b6448fa50b97d53d2d2477f`.
Qualification Receipt V1 and its obsolete Core schema lock are removed. The
public lock export, fixture, vendored decision and receipt schemas, vector
verifier, packed proof, and CI checkout all bind that same merged Core contract;
available drift is rejected.
Unknown schema/effect versions may
be inspectable as authenticated opaque records, but cannot verify or materialize
as V2.

Resource bounds are fail-closed: 4,096 entries, 64 signer roots, 4,096 replay
identities, 64 items in bounded lists, an 8 MiB head/candidate, a 24 MiB signed
artifact, 1 MiB claims/root/replay/seed artifacts, a 64 KiB private key, a
4,096-byte complete canonical source object, and a 5,970-byte Qualification
Receipt V2. The receipt bound is the measured maximum canonical encoding
admitted by that closed grammar; exact-cap and cap+1 tests lock the producer
contract, and the packed proof requires the matching Core consumer to accept
the exact 5,970-byte ceiling and reject 5,971 bytes. The source
cap limits only this optional supported channel; organization-qualified Core
remains the path for an exact source outside it.

## Cold verification and consumption

Install the exact package or reviewed tarball in a disposable consumer. Keep the
catalog-signer root outside catalog-controlled data. Then run:

```sh
aih-supported inspect --signed-catalog ./signed-catalog.json --catalog-signer-root ./catalog-signer-root.json --expected-claims ./expected-claims.json --replay-state ./replay-state.json --now 2026-08-22T12:00:00Z --continuity genesis --qualification-basis --entry-id recipe.default
```

For a successor, supply `--last-accepted-head` instead of genesis. The caller,
not the package clock, supplies `--now`; production callers must use a live UTC
observation. `inspect` emits only a materializable head or an authenticated opaque
record. The returned qualification basis can be consumed by decision-authoring
code, but it is evidence provenance rather than effective permission.

To create the Core handoff, run the same verified inputs through the exclusive
file command:

```sh
aih-supported emit-qualification-receipt --signed-catalog ./signed-catalog.json --catalog-signer-root ./catalog-signer-root.json --expected-claims ./expected-claims.json --replay-state ./replay-state.json --now 2026-08-22T12:00:00Z --continuity genesis --entry-id recipe.default --output ./.aih/aih-supported-qualification-receipt.json
```

The command prints no receipt to stdout. It writes a canonical, closed V2
receipt only after catalog, member, signer, claims, continuity, replay,
compatibility, and validity checks pass. The producer derives its `entryId` and
`catalogContinuity` block only from the verified member and signed head. That
block binds the mirrored head digest, predecessor, sequence, signed replay
identity, Ed25519 signer key id, and head-validity window; receipt expiry equals
the head-validity ceiling. The result explicitly states that it is not
organization admission. Core still requires its independent Strict V2
organization decision, V3 authority verification, durable V2 acceptance, and
fresh upstream observation.

Receipt V1 is deliberately unsupported. The older Core V1 artifact verifier
must reject V2 bytes and is not a downgrade route. Core's matching V2 consumer
owns the runner, environment snapshot, live clock, outer-attestation roots,
administrator signer-key lineage, replay/head/member custody, and current
organization authority. Its preview-first `aih policy supported accept` route
reads the receipt only from the fixed target path, and its separate
`aih policy supported inspect` route is read-only and scrubbed. A receipt is not
accepted or effective merely because this producer emitted it.

The inner claims are a declaration and must exactly match independently supplied
expectations. Consumers must also verify the outer GitHub attestation against the
expected repository, workflow, commit, and artifact digest when the channel is
published. The two layers fail independently.

Replay state has the closed shape `{"acceptedIdentities":[...]}`. The verifier
checks it but never writes it. A stateful consumer records the returned replay
identity only as part of its own atomic acceptance transaction. Omitting
`--replay-state` leaves that caller-owned duplicate-identity check disabled; it
does not relax signature, validity, continuity, claim, or digest verification.

The cold cross-repository check takes an exact clean Core checkout through
`AIH_SUPPORTED_CORE_SOURCE`, verifies it, materializes the locked commit in a
disposable detached clone, builds and packs both packages, installs them into
disposable roots, emits the real V2 receipt at Core's fixed target path, verifies
the packed public V2 parser accepts it and the exact legal byte ceiling while
rejecting V1 and cap+1, invokes the production accept route, and exercises
read-only inspection. The real outer-attestation
workflow remains separately authorized and has not run, so the check requires
the production accept route to return its exact `AIH_TRUST` refusal rather than
simulating `gh` or fabricating authority. It therefore proves package and
contract integration, not a successful production custody write.

## Candidate, version, promotion, and revocation

Use `generate-candidate` with a seed, signer declaration, claims, validity,
sequence, previous digest, and exclusive output path. Use `sign-candidate` only
with the exact canonical candidate and an owner-protected Ed25519 private key.
Use `inspect` again before consumption.

`planCatalogPromotionV2` compares a successor with the last-good head. Changes to
findings, gaps, report, rights, signer, closure, command, hook, MCP tool, egress,
permission, effect, schema, platform, recipe, prose, source, or entry membership
produce deterministic facts and keep the last-good result. Removing an entry is
the supported-channel revocation mechanism.

The manual workflow records a canonical promotion plan binding the candidate
head, last-good head, and facts. Candidate jobs have read-only contents authority
and cannot sign. A material version bump or removal can proceed only when an
operator supplies the exact promotion-plan, signed-catalog, and qualification-
receipt SHA-256 values plus the receipt issuance timestamp and entry id, and the
protected `catalog-signing` environment approves them. The signing job runs no
candidate code; it separately attests the catalog and receipt. The final verifier
rebuilds, checks continuity and the inner signature, recomputes the plan and
receipt bytes, and verifies both outer GitHub attestations.

A catalog removal affects later catalog observation. It does not revoke a
previously issued Core decision with a pinned member digest; the organization
uses Core's digest-bound revocation authority for that decision. Heads are valid
for at most 90 days and cached data is never authority without re-verification.

## CI, contribution, and publication

Before a contribution is reviewed, run:

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run test:cov
npm run verify:core-v2-lock
npm run verify:default-evidence-chain
npm run verify:cold-external-admin
npm run verify:workflow-action-pins -- --online
npm audit --audit-level=high
```

Normal CI is read-only. It validates the Core lock, deterministic defaults,
package boundaries, and tests; it does not sign, attest, publish, or initialize
repository state. Contributors may propose exact sources and evidence, but
catalog signing, protected promotion approval, outer provenance, npm publication,
and any release remain separate authority decisions. Catalog V1 and
Qualification Receipt V1 are removed rather than served as compatibility or
downgrade paths.

The package-release workflow is separate from the protected Catalog V2
outer-provenance workflow. Only an exact `v-catalog-X.Y.Z` tag on current
`main`, matching the package version, can enter it. It repeats the repository,
Core-lock, disposable cold packed, coverage, pin, and audit gates before packing
and smoke-installing the release artifact once in a read-only job. A separate
protected job downloads that candidate by immutable artifact ID, verifies its
artifact-service and direct tarball digests, re-observes the tag and `main`, and
validates the packed identity without running candidate package code. The same
digest-revalidated tarball is the subject of its SPDX SBOM, GitHub build
attestation, keyless checksum signature, npm OIDC publication, and GitHub
Release. It cannot sign or promote a catalog head or Qualification Receipt.
First-package bootstrap, the protected `npm-publish` environment,
trusted-publisher binding, exact tag, and publication remain the owner actions
defined in [RELEASING.md](../RELEASING.md).
