# Supported Catalog V2 contract

This document is the operator and maintainer contract for the public Catalog V2
surface in `@aihq/supported` 1.0.0. Publication is deferred; publishing npm bytes
or executing the outer-attestation workflow requires separate exact-SHA
authorization.

## Purpose and authority

Catalog V2 gives administrators a maintained, signed source of exact supported
subjects. It is optional. `aih-supported` and `organization-qualified` are
different qualification provenance paths, and catalog membership is not an
admission authority. The CLI makes that boundary machine-visible as
`organizationAdmission: "not-authoritative"`.

Core does not consume Catalog V2 directly. This package emits the closed
Core-owned qualification receipt only after verifying Catalog V2; Core separately
verifies that receipt's outer attestation and exact fields. A separate Strict V3
governance decision and authority receipt must still authorize use. An
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
6. The producer emits one closed, canonical, non-authoritative qualification
   receipt for an exact verified member.
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
`e27a55dcebb635c8298aa4fd6fd871f59089bcf7` and schema SHA-256
`27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff`.
The qualification-receipt schema has a separate Core commit and SHA-256 lock;
the commit is advanced only to the merged Core receipt implementation. The
verifier and committed vectors reject drift. Unknown schema/effect versions may
be inspectable as authenticated opaque records, but cannot verify or materialize
as V2.

Resource bounds are fail-closed: 4,096 entries, 64 signer roots, 4,096 replay
identities, 64 items in bounded lists, an 8 MiB head/candidate, a 24 MiB signed
artifact, 1 MiB claims/root/replay/seed artifacts, a 64 KiB private key, and a
4 KiB qualification receipt.

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

The command prints no receipt to stdout. It writes a canonical, closed receipt
only after catalog, member, signer, claims, continuity, replay, compatibility,
and validity checks pass. The result explicitly states that it is not
organization admission. Core still requires its independent V3 organization
decision, authority verification, and fresh upstream observation.

The installed Core package exposes
`verifyAihSupportedQualificationArtifactV1({root, decisionReference, subject})`
for the target repository. Core owns the runner, environment snapshot, host
adapter, and live clock, then re-observes both protected attestations and the
exact current V3 decision. The result is only `verified` or `unverified`; no
authority, receipt bytes, qualification capability, or reusable evidence crosses
the package boundary.

The inner claims are a declaration and must exactly match independently supplied
expectations. Consumers must also verify the outer GitHub attestation against the
expected repository, workflow, commit, and artifact digest when the channel is
published. The two layers fail independently.

Replay state has the closed shape `{"acceptedIdentities":[...]}`. The verifier
checks it but never writes it. A stateful consumer records the returned replay
identity only as part of its own atomic acceptance transaction. Omitting
`--replay-state` leaves that caller-owned duplicate-identity check disabled; it
does not relax signature, validity, continuity, claim, or digest verification.

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
npm run verify:workflow-action-pins -- --online
npm audit --audit-level=high
```

Normal CI is read-only. It validates the Core lock, deterministic defaults,
package boundaries, and tests; it does not sign, attest, publish, or initialize
repository state. Contributors may propose exact sources and evidence, but
catalog signing, protected promotion approval, outer provenance, npm publication,
and any release remain separate authority decisions. V1 is removed rather than
served as a compatibility or downgrade path.
